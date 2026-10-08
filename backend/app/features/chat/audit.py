"""Bounded, best-effort capture of visible answers for administrator debugging.

Only one terminal record is written. Process crashes can lose an in-flight record;
the public conversation's placeholder/status remains the source for that case.
"""
from __future__ import annotations

import asyncio
import logging
import math
import re
from datetime import datetime, timedelta, timezone
from threading import BoundedSemaphore
from time import perf_counter
from uuid import uuid4

from app.db.models.chat_audit import ChatValidationRun

from . import audit_repository


RETENTION_DAYS = 14
MAX_QUERY_CHARS = 6000
MAX_ANSWER_CHARS = 32000
MAX_SOURCE_CHARS = 24000
MAX_SOURCES = 64
MAX_SOURCE_SNAPSHOT_CHARS = 160000
SAVE_TIMEOUT_SECONDS = 0.5
_SAVE_SLOTS = BoundedSemaphore(4)
_LOG = logging.getLogger(__name__)
_SAFE_CODE = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")
_FINISH_REASONS = {"stop", "length", "content_filter", "tool_calls", "function_call"}


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _number(value):
    return value if (isinstance(value, (int, float)) and not isinstance(value, bool)
                     and 0 <= value <= 10**15 and math.isfinite(value)) else None


def _code(value):
    return value if isinstance(value, str) and _SAFE_CODE.fullmatch(value) else None


def _clip(value, limit):
    value = value if isinstance(value, str) else ""
    return value[:limit], len(value) > limit, len(value)


def _debug_text(value, limit):
    text, clipped, _ = _clip(value, limit)
    marker = "\n[除錯紀錄已截短]"
    return text[:limit - len(marker)] + marker if clipped else text


def _tokens(metadata):
    def count(value):
        return _number(value) if isinstance(value, int) else None
    return {
        "input": count(metadata.get("prompt_tokens")),
        "output": count(metadata.get("completion_tokens")),
        "thinking": count(metadata.get("reasoning_tokens", metadata.get("thinking_tokens"))),
    }


class _SnapshotBudget:
    def __init__(self):
        self.remaining = MAX_SOURCE_SNAPSHOT_CHARS
        self.nodes = 12000
        self.clipped = False

    def value(self, value, depth=0, *, string_limit=2000):
        if self.nodes <= 0:
            self.clipped = True
            return None
        self.nodes -= 1
        if isinstance(value, str):
            size = min(len(value), string_limit, self.remaining)
            self.remaining -= size
            self.clipped |= size < len(value)
            return value[:size]
        if value is None or isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            if abs(value) <= 10**20 and math.isfinite(value):
                return value
            self.clipped = True
            return None
        if depth >= 5:
            self.clipped = True
            return None
        if isinstance(value, list):
            self.clipped |= len(value) > 64
            result = []
            for item in value[:64]:
                if self.nodes <= 0:
                    self.clipped = True
                    break
                result.append(self.value(item, depth + 1))
            return result
        if isinstance(value, dict):
            self.clipped |= len(value) > 64
            result = {}
            for key, item in list(value.items())[:64]:
                if self.nodes <= 0:
                    self.clipped = True
                    break
                result[str(key)[:80]] = self.value(item, depth + 1)
            return result
        self.clipped = True
        return None


class ChatAudit:
    def __init__(self, request, *, llm, timeout_seconds, repair_max_tokens):
        self.id = str(uuid4())
        self.created_at = utcnow()
        self.started = perf_counter()
        self.user_id = request._user_id
        self.conversation_id = request._conversation_id
        self.turn_id = request._turn_id
        self.query, query_truncated, query_original_chars = _clip(request.query, MAX_QUERY_CHARS)
        model = getattr(llm, "model_name", None) or getattr(getattr(llm, "settings", None), "LLM_MODEL", "")
        self.outcome = "interrupted"
        self.reason = None
        self._attempt_started = None
        self._saved = False
        self._preparation_tokens = {"input": None, "output": None, "thinking": None}
        self.data = {
            "schema_version": 1,
            "model": model[:160] if isinstance(model, str) else "",
            "duration_ms": 0,
            "attempt_count": 0,
            "source_count": 0,
            "sources_truncated": False,
            "query_truncated": query_truncated,
            "query_original_chars": query_original_chars,
            "final_answer": "",
            "final_answer_truncated": False,
            "final_answer_original_chars": 0,
            "attempts": [],
            "sources": [],
            "tokens": {"input": None, "output": None, "thinking": None},
            "request_timeout_seconds": _number(timeout_seconds),
            "repair_max_tokens": _number(repair_max_tokens),
            "requires_portfolio": False,
            "answer_detail": request.answer_detail,
            "error_type": None,
            "reasons": [],
            # Means the service returned/yielded the terminal response, not a
            # browser receipt acknowledgment (HTTP/SSE offers no such guarantee).
            "publication_completed": False,
        }

    def prepared(self, response):
        budget = _SnapshotBudget()
        self.data["source_count"] = len(response.sources)
        snapshots = []
        any_clipped = False
        for source in response.sources[:MAX_SOURCES]:
            original = source.model_dump(mode="json")
            content = original.pop("content", "")
            budget.clipped = False
            # IDs and titles remain readable even when the evidence budget is
            # exhausted; their per-field and source-count limits still bound size.
            snapshot = {}
            for name, size in (("citation_id", 32), ("title", 300), ("source", 160), ("source_name", 160),
                               ("category", 64), ("stock_id", 32), ("pub_time", 80), ("url", 2000)):
                value, clipped, _ = _clip(original.pop(name, ""), size)
                snapshot[name] = value
                budget.clipped |= clipped
            snapshot.update(budget.value(original) or {})
            snapshot["content"] = budget.value(content, string_limit=MAX_SOURCE_CHARS) or ""
            snapshot["original_chars"] = len(content)
            snapshot["content_truncated"] = len(snapshot["content"]) < len(content)
            snapshot["snapshot_truncated"] = budget.clipped
            any_clipped |= budget.clipped
            snapshots.append(snapshot)
        self.data["sources"] = snapshots
        self.data["sources_truncated"] = any_clipped or len(response.sources) > MAX_SOURCES
        self.data["requires_portfolio"] = bool(response._requires_portfolio)
        self.update_usage(response)

    def update_usage(self, response):
        if not self.data["attempts"]:
            self._preparation_tokens = {
                key: _number(response.tokens.get(key)) for key in ("input", "output", "thinking")
            }
        self._refresh_usage()

    def _refresh_usage(self):
        # Include usage reported before a provider error/disconnect as well as
        # completed attempts. Each attempt's latest report is counted once.
        for key in ("input", "output", "thinking"):
            values = [self._preparation_tokens.get(key), *(attempt["tokens"].get(key)
                       for attempt in self.data["attempts"])]
            known = [value for value in values if value is not None]
            self.data["tokens"][key] = sum(known) if known else None

    def start_attempt(self, stage, client):
        self._attempt_started = perf_counter()
        self.data["attempts"].append({
            "number": len(self.data["attempts"]) + 1, "stage": stage,
            "text": "", "text_truncated": False, "original_chars": 0,
            "finish_reason": None, "truncated": False, "validation": "not_checked",
            "reason": None, "hint": "", "claim": "", "detail": "", "duration_ms": 0,
            "diagnostics_truncated": False,
            "tokens": {"input": None, "output": None, "thinking": None},
            "max_tokens": _number(getattr(getattr(client, "settings", None), "LLM_MAX_TOKENS", None)),
        })
        self.data["attempt_count"] = len(self.data["attempts"])

    def append_text(self, text):
        if not self.data["attempts"] or not isinstance(text, str):
            return
        attempt = self.data["attempts"][-1]
        attempt["original_chars"] += len(text)
        attempt["text"] += text[:max(0, MAX_ANSWER_CHARS - len(attempt["text"]))]
        attempt["text_truncated"] = attempt["original_chars"] > len(attempt["text"])

    def metadata(self, metadata):
        if not self.data["attempts"]:
            return
        attempt = self.data["attempts"][-1]
        if "finish_reason" in metadata:
            value = metadata.get("finish_reason")
            attempt["finish_reason"] = (value if isinstance(value, str) and value in _FINISH_REASONS
                                        else "unknown" if value is not None else None)
        attempt["truncated"] = bool(metadata.get("truncated")) or attempt["finish_reason"] == "length"
        incoming = _tokens(metadata)
        attempt["tokens"].update({key: value for key, value in incoming.items() if value is not None})
        self._refresh_usage()

    def complete_attempt(self, text, metadata):
        self.append_text(text)
        self.metadata(metadata)
        self._finish_attempt_time()

    def _finish_attempt_time(self):
        if self._attempt_started is not None and self.data["attempts"]:
            self.data["attempts"][-1]["duration_ms"] = int((perf_counter() - self._attempt_started) * 1000)
            self._attempt_started = None

    def rejected(self, exc):
        self._finish_attempt_time()
        attempt = self.data["attempts"][-1]
        reason = _code(exc.reason) or "invalid_answer"
        attempt.update({"validation": "rejected", "reason": reason,
                        "hint": _debug_text(getattr(exc, "hint", ""), 3000),
                        "claim": _debug_text(getattr(exc, "claim", ""), 3000),
                        "detail": _debug_text(getattr(exc, "detail", ""), 1000),
                        "diagnostics_truncated": any(_clip(getattr(exc, key, ""), limit)[1]
                            for key, limit in (("hint", 3000), ("claim", 3000), ("detail", 1000)))})
        self.reason = reason
        if reason not in self.data["reasons"]:
            self.data["reasons"].append(reason)

    def passed(self):
        self._finish_attempt_time()
        self.data["attempts"][-1]["validation"] = "passed"
        self.outcome = "repaired" if len(self.data["attempts"]) > 1 else "passed"

    def publish(self, response, *, completed=False):
        answer, clipped, original_chars = _clip(response.answer, MAX_ANSWER_CHARS)
        self.data.update(final_answer=answer, final_answer_truncated=clipped,
                         final_answer_original_chars=original_chars, publication_completed=completed)
        self.update_usage(response)

    def failed(self, exc):
        self.outcome = "error"
        self.data["error_type"] = type(exc).__name__[:100]
        self._finish_attempt_time()

    def _write(self, session_factory):
        try:
            with session_factory() as db, db.begin():
                audit_repository.delete_expired(db, utcnow() - timedelta(days=RETENTION_DAYS))
                audit_repository.add_if_owner_exists(db, ChatValidationRun(
                    id=self.id, created_at=self.created_at, user_id=self.user_id,
                    conversation_id=self.conversation_id, turn_id=self.turn_id, outcome=self.outcome,
                    query=self.query, reason=self.reason, data=self.data,
                ))
        except Exception as exc:
            # SQL errors can embed private draft text/parameters. Never log str(exc).
            _LOG.warning("Chat diagnostics unavailable: %s", type(exc).__name__)
        finally:
            _SAVE_SLOTS.release()

    async def persist(self, session_factory):
        if self._saved or session_factory is None:
            return
        self._saved = True
        self._finish_attempt_time()
        self.data["duration_ms"] = int((perf_counter() - self.started) * 1000)
        if not self.data["publication_completed"] and self.outcome != "error":
            self.outcome = "interrupted"
        if not _SAVE_SLOTS.acquire(blocking=False):
            _LOG.warning("Chat diagnostics unavailable: writer_busy")
            return
        # Bound response-side waiting and outstanding writers. A timed-out write
        # can finish in its own session; it still rechecks owner deletion there.
        task = asyncio.create_task(asyncio.to_thread(self._write, session_factory))
        try:
            await asyncio.wait_for(asyncio.shield(task), SAVE_TIMEOUT_SECONDS)
        except TimeoutError:
            _LOG.warning("Chat diagnostics unavailable: write_timeout")
        except asyncio.CancelledError:
            # The independent bounded write continues without delaying disconnect.
            raise
