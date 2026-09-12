from datetime import datetime, timedelta
from decimal import Decimal
import json
from itertools import groupby
from pathlib import Path
from time import perf_counter
from uuid import uuid4

from sqlalchemy import and_, select

from app.clients.llm import LlmClient
from app.core.errors import AppError
from app.db.models.news_article import NewsArticle
from app.db.models.news_sentiment import NewsSentiment
from app.features.news.sentiment import (
    MAX_INPUT_TOKENS, PROMPT_VERSION, SYSTEM_PROMPT, SentimentOutput, TARGET_STOCKS, active_config_hash,
    article_input_hash,
)
from .rules import TAIPEI_TZ, clean_text, estimate_token_count, extract_candidate_stocks, parse_news_pub_time, validate_sentiment_payload


def _decimal(value) -> Decimal:
    return Decimal(str(value))


def calculate_cost(input_tokens: int | None, output_tokens: int | None, settings) -> Decimal | None:
    if input_tokens is None or output_tokens is None:
        return None
    return (input_tokens * _decimal(settings.LLM_INPUT_PRICE_PER_M)
            + output_tokens * _decimal(settings.LLM_OUTPUT_PRICE_PER_M)) / 1_000_000


def _error_code(error: AppError) -> str:
    status = getattr(error, "upstream_status_code", None)
    upstream_code = getattr(error, "upstream_code", None)
    if error.status_code == 504:
        return "timeout"
    if status in {401, 403} or upstream_code == "invalid_api_key":
        return "auth_error_401"
    if status == 404 or upstream_code in {"model_not_found", "invalid_model"}:
        return "model_not_found"
    if status == 429 or upstream_code == "rate_limit_exceeded":
        return "rate_limit_429"
    if isinstance(error.detail, dict) and error.detail.get("code") == "llm_unavailable":
        return "client_uninitialized"
    return "upstream_model_error"


class SentimentBatchRunner:
    """Sequential CLI worker; commits one validated result or failure per article/stock pair."""
    def __init__(self, *, db_session, settings, http=None, llm=None, max_cost_usd=0.50,
                 limit=100, execute=False, work_dir: Path, run_id: str | None = None):
        self.db = db_session
        # Explicit retries are accounted for individually; provider SDK retries must not hide costs.
        self.settings = settings.model_copy(update={"LLM_MAX_RETRIES": 0, "LLM_STREAMING": False})
        self.llm = llm or LlmClient(self.settings, http)
        self.model = self.settings.LLM_MODEL
        self.config_hash = active_config_hash(self.settings)
        self.budget = _decimal(max_cost_usd)
        self.limit, self.execute, self.work_dir = limit, execute, work_dir
        self.run_id = run_id or f"{datetime.now():%Y%m%d_%H%M%S}_{uuid4().hex[:8]}"
        if Path(self.run_id).name != self.run_id or self.run_id in {".", ".."}:
            raise ValueError("run_id must be a filename component")
        for rate in (self.settings.LLM_INPUT_PRICE_PER_M, self.settings.LLM_OUTPUT_PRICE_PER_M,
                     self.settings.SENTIMENT_USD_TWD_RATE):
            if not _decimal(rate).is_finite() or _decimal(rate) < 0:
                raise ValueError("Sentiment cost estimates require finite nonnegative rates")
        self.reserved_per_call = calculate_cost(MAX_INPUT_TOKENS, self.settings.LLM_MAX_TOKENS, self.settings)
        if (not self.budget.is_finite() or self.budget < 0 or limit < 1 or self.settings.LLM_MAX_TOKENS < 1
                or not self.reserved_per_call.is_finite() or self.reserved_per_call < 0):
            raise ValueError("Invalid sentiment budget or token limits")
        self.spent, self.known_cost = Decimal(0), Decimal(0)
        self.counts = dict(total_items=0, success=0, failed=0, skipped=0, reused=0, api_calls=0,
                           total_input_tokens=0, total_output_tokens=0, total_reasoning_tokens=0)
        self.skip_reasons, self.latencies = {}, []
        self.consecutive_failures = 0
        self.stopped_reason = None

    def _skip(self, reason):
        self.counts["skipped"] += 1
        self.skip_reasons[reason] = self.skip_reasons.get(reason, 0) + 1

    def _save_record(self, article_id, symbol, input_hash, status, **values):
        record = self.db.get(NewsSentiment, (article_id, symbol))
        if record is None:
            record = NewsSentiment(article_id=article_id, target_stock_id=symbol)
            self.db.add(record)
        fields = dict(input_hash=input_hash, config_hash=self.config_hash, status=status, label=None,
                      reason=None, evidence=None, model=self.model, prompt_version=PROMPT_VERSION,
                      input_tokens=None, output_tokens=None, reasoning_tokens=None, estimated_cost_usd=None,
                      analyzed_at=datetime.now(TAIPEI_TZ).replace(tzinfo=None), error_code=None)
        fields.update(values)
        if fields["error_code"]:
            fields["error_code"] = str(fields["error_code"])[:250]
        for field, value in fields.items():
            setattr(record, field, value)
        try:
            self.db.commit()
        except BaseException:
            self.db.rollback()
            raise

    def _audit(self, article_id, symbol, input_hash, attempt, output, error, usage, latency):
        self.work_dir.mkdir(parents=True, exist_ok=True)
        record = {"run_id": self.run_id, "timestamp": datetime.now(TAIPEI_TZ).isoformat(),
                  "article_id": article_id, "target_stock_id": symbol, "attempt": attempt,
                  "model": self.model, "config_hash": self.config_hash, "input_hash": input_hash,
                  "latency_ms": round(latency, 2), "usage": usage, "error": error,
                  "raw_preview": output.raw_text[:200] if output else ""}
        with (self.work_dir / f"{self.run_id}.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    async def _process(self, article_id, symbol, input_hash, title, content, payload):
        last_error, last_usage = None, {}
        for attempt in range(1, 3):
            if self.spent + self.reserved_per_call > self.budget:
                self.stopped_reason = "budget_exhausted"
                if attempt == 1:
                    self._skip("budget_exhausted")
                    return None, "budget_exhausted"
                break
            self.counts["api_calls"] += 1
            start = perf_counter()
            output, error = None, None
            try:
                output = await self.llm.generate(system_prompt=SYSTEM_PROMPT, payload=payload, schema=SentimentOutput)
            except AppError as exc:
                error = _error_code(exc)
            latency = (perf_counter() - start) * 1000
            self.latencies.append(latency)
            metadata = output.metadata if output else {}
            usage = {"input_tokens": metadata.get("prompt_tokens"), "output_tokens": metadata.get("completion_tokens"),
                     "reasoning_tokens": metadata.get("reasoning_tokens")}
            for key in usage:
                value = usage[key]
                if type(value) is not int or value < 0:
                    usage[key] = None
            cost = calculate_cost(usage["input_tokens"], usage["output_tokens"], self.settings)
            self.spent += cost if cost is not None else self.reserved_per_call
            self.known_cost += cost or Decimal(0)
            usage["estimated_cost_usd"] = float(cost) if cost is not None else None
            last_usage = usage
            for key in ("input_tokens", "output_tokens", "reasoning_tokens"):
                self.counts[f"total_{key}"] += usage[key] or 0
            if not error:
                if metadata.get("truncated"):
                    error = "truncated_output"
                else:
                    validation = validate_sentiment_payload(output.payload, cleaned_title=title, cleaned_content=content)
                    if not validation.is_valid:
                        error = f"validation_failed: {validation.error_message}"
            self._audit(article_id, symbol, input_hash, attempt, output, error, usage, latency)
            if not error:
                result = validation.output
                self._save_record(article_id, symbol, input_hash, "success", label=result.label, reason=result.reason,
                    evidence=json.dumps([quote.model_dump() for quote in result.evidence], ensure_ascii=False), **usage)
                return True, None
            last_error = error
            if error in {"timeout", "auth_error_401", "model_not_found", "client_uninitialized"}:
                break
            if error.startswith("validation_failed:") or error == "truncated_output":
                payload = {**payload, "validation_feedback": error[:500],
                           "retry_instruction": "Check exact source quotes and label/evidence rules; return only the specified JSON object."}
            if error == "rate_limit_429" and attempt < 2:
                import asyncio
                await asyncio.sleep(2)
        self._save_record(article_id, symbol, input_hash, "failed", error_code=last_error, **last_usage)
        return False, last_error

    def incremental_manifest(self, stocks):
        stocks = set(stocks)
        if not stocks or not stocks <= TARGET_STOCKS.keys():
            raise ValueError("--stocks must contain supported stock symbols")
        retry_before = datetime.now(TAIPEI_TZ).replace(tzinfo=None) - timedelta(hours=1)
        # ponytail: a caught-up batch scans all hashes; add an article revision column if scans become expensive.
        query = select(NewsArticle, NewsSentiment).outerjoin(NewsSentiment, and_(
            NewsSentiment.article_id == NewsArticle.article_id, NewsSentiment.target_stock_id.in_(stocks),
        )).order_by(NewsArticle.pub_time.desc(), NewsArticle.article_id).execution_options(yield_per=200)
        items = []
        with self.db.execute(query) as rows:
            for _, grouped in groupby(rows, key=lambda row: row[0].article_id):
                group = list(grouped)
                article = group[0][0]
                existing = {row.target_stock_id: row for _, row in group if row is not None}
                for symbol in extract_candidate_stocks(article.stock_id, article.tags):
                    if symbol not in stocks:
                        continue
                    previous = existing.get(symbol)
                    if (previous is not None and previous.config_hash == self.config_hash
                            and previous.input_hash == article_input_hash(article, symbol)
                            and (previous.status in {"success", "skipped"}
                                 or previous.status == "failed" and (
                                     previous.error_code not in {"timeout", "rate_limit_429", "upstream_model_error",
                                         "client_uninitialized", "auth_error_401", "model_not_found"}
                                     or previous.analyzed_at is not None and previous.analyzed_at > retry_before))):
                        # Retry transient failures hourly; explicit manifests can retry unchanged invalid output.
                        continue
                    items.append({"article_id": article.article_id, "symbol": symbol})
                    if len(items) == self.limit:
                        return items
        return items

    async def run_manifest(self, manifest_items):
        seen = set()
        for item in manifest_items[:self.limit]:
            if not isinstance(item, dict):
                self._skip("missing_id_or_symbol")
                continue
            article_id, symbol = item.get("article_id"), item.get("symbol") or item.get("target_stock_id")
            if not isinstance(article_id, str) or not article_id or not isinstance(symbol, str) or not symbol:
                self._skip("missing_id_or_symbol")
                continue
            if symbol not in TARGET_STOCKS:
                self._skip("not_in_target_stocks")
                continue
            if (article_id, symbol) in seen:
                self._skip("duplicate_pair")
                continue
            seen.add((article_id, symbol))
            self.counts["total_items"] += 1
            article = self.db.get(NewsArticle, article_id)
            if article is None:
                self._skip("article_not_found_in_db")
                continue
            title, content = clean_text(article.title), clean_text(article.content)
            timestamp, canonical_time = parse_news_pub_time(article.pub_time)
            input_hash = article_input_hash(article, symbol)
            payload = {"target_stock_id": symbol, "target_stock_name": TARGET_STOCKS[symbol],
                       "pub_time": canonical_time, "title": title, "content": content}
            input_text = SYSTEM_PROMPT + json.dumps(payload, ensure_ascii=False) + json.dumps(SentimentOutput.model_json_schema(), ensure_ascii=False)
            skip = ("skipped_empty_content" if not content else "skipped_invalid_date" if timestamp is None
                    else "skipped_input_too_long" if estimate_token_count(input_text) > MAX_INPUT_TOKENS else None)
            if skip:
                self._skip(skip)
                if self.execute:
                    self._save_record(article_id, symbol, input_hash, "skipped", error_code=skip)
                continue
            cached = self.db.scalar(select(NewsSentiment).where(NewsSentiment.input_hash == input_hash,
                NewsSentiment.config_hash == self.config_hash, NewsSentiment.status == "success").limit(1))
            if cached:
                try:
                    validation = validate_sentiment_payload({"label": cached.label, "reason": cached.reason,
                        "evidence": json.loads(cached.evidence or "[]")}, cleaned_title=title, cleaned_content=content)
                except (ValueError, TypeError):
                    validation = None
                if validation and validation.is_valid:
                    self.counts["reused"] += 1
                    self.counts["success"] += 1
                    self.consecutive_failures = 0
                    if self.execute:
                        self._save_record(article_id, symbol, input_hash, "success", label=cached.label,
                            reason=cached.reason, evidence=cached.evidence, model=cached.model,
                            prompt_version=cached.prompt_version, input_tokens=0, output_tokens=0,
                            reasoning_tokens=0, estimated_cost_usd=0.0)
                    continue
            if not self.execute:
                continue
            success, error = await self._process(article_id, symbol, input_hash, title, content, payload)
            if success is None:
                break
            self.counts["success" if success else "failed"] += 1
            self.consecutive_failures = 0 if success else self.consecutive_failures + 1
            if error in {"auth_error_401", "model_not_found", "client_uninitialized"}:
                self.stopped_reason = error
            elif self.consecutive_failures >= 3:
                self.stopped_reason = "consecutive_failures"
            if self.stopped_reason:
                break
        return self.get_summary()

    def get_summary(self):
        latencies = sorted(self.latencies)
        return {"run_id": self.run_id, "mode": "execute" if self.execute else "preview", "model": self.model,
                "config_hash": self.config_hash, **self.counts, "skip_reasons": self.skip_reasons,
                "total_cost_usd": round(float(self.known_cost), 6),
                "total_cost_twd": round(float(self.known_cost * _decimal(self.settings.SENTIMENT_USD_TWD_RATE)), 2),
                "budget_spent_usd": round(float(self.spent), 6), "stopped_reason": self.stopped_reason,
                "latency_p50_ms": round(latencies[int(len(latencies) * 0.5)], 1) if latencies else 0.0,
                "latency_p95_ms": round(latencies[int(len(latencies) * 0.95)], 1) if latencies else 0.0}
