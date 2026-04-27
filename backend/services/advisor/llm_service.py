from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

from agent.llm_client import LLMClient
from config import get_settings

logger = logging.getLogger(__name__)

_DEFAULT_TIMEOUT_SEC = 180.0
_MAX_LIST_ITEMS = 6


class AdvisorLLMService:
    """Single-model LLM service for advisor full report narration only."""

    def __init__(self, *, timeout_sec: float = _DEFAULT_TIMEOUT_SEC) -> None:
        self._timeout_sec = max(5.0, float(timeout_sec))
        self._llm: LLMClient | None = None
        self._model_name: str | None = None

    def _get_llm(self) -> LLMClient:
        if self._llm is None:
            settings = get_settings()
            model = settings.ADVISOR_LLM_MODEL
            self._model_name = model
            self._llm = LLMClient(settings, model=model)
        return self._llm

    @staticmethod
    def _normalize_str_list(value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        out: list[str] = []
        seen: set[str] = set()
        for item in value:
            text = " ".join(str(item).strip().split())
            if not text or text in seen:
                continue
            seen.add(text)
            out.append(text)
            if len(out) >= _MAX_LIST_ITEMS:
                break
        return out

    @staticmethod
    def _normalize_source_highlights(value: Any) -> list[dict[str, str]]:
        if not isinstance(value, list):
            return []
        out: list[dict[str, str]] = []
        for item in value:
            if not isinstance(item, dict):
                continue
            title = " ".join(str(item.get("title", "")).strip().split())
            summary = " ".join(str(item.get("summary", "")).strip().split())
            url = " ".join(str(item.get("url", "")).strip().split())
            if not title and not summary:
                continue
            out.append({"title": title, "summary": summary, "url": url})
            if len(out) >= _MAX_LIST_ITEMS:
                break
        return out

    def _fallback(self, *, context: dict[str, Any], error: str) -> dict[str, Any]:
        core = dict(context.get("core_decision") or {})
        rule_summary = [str(x) for x in (context.get("rule_summary") or []) if str(x).strip()]
        news = dict(context.get("news_context") or {})
        reason_points = [str(x) for x in (core.get("reason_points") or []) if str(x).strip()]
        source_items = list(news.get("source_items") or [])

        final_summary = " ".join(rule_summary[:2]) or f"核心判斷為「{core.get('trend_conclusion') or '尚無結論'}」。"
        recommendation_basis = reason_points[:4] or rule_summary[:3]
        risk_points = [str(x) for x in (core.get("risk_notes") or []) if str(x).strip()]
        if not risk_points:
            risk_points = ["請留意訊號可能因震盪而反覆，建議搭配風險控管。"]
        source_highlights = []
        for item in source_items[:3]:
            source_highlights.append(
                {
                    "title": str(item.get("title") or ""),
                    "summary": str(item.get("summary") or ""),
                    "url": str(item.get("url") or ""),
                }
            )

        return {
            "final_summary": final_summary,
            "recommendation_basis": recommendation_basis[:_MAX_LIST_ITEMS],
            "risk_points": risk_points[:_MAX_LIST_ITEMS],
            "source_highlights": source_highlights,
            "fallback_mode": True,
            "error": error,
            "model": self._model_name or "",
        }

    async def generate_full_report(self, *, context: dict[str, Any]) -> dict[str, Any]:
        started_at = time.perf_counter()
        system_prompt = (
            "你是台股投資顧問報告撰寫助手。"
            "你只能用輸入資料補充可讀說明，不可推翻 core_decision 的 trend_conclusion 與 confidence_level。"
            "回覆必須是 JSON，且只能包含 final_summary、recommendation_basis、risk_points、source_highlights。"
            "final_summary 請用繁體中文，2~4 句。"
            "recommendation_basis 與 risk_points 為陣列，每項 8~60 字。"
            "source_highlights 每項需含 title、summary、url。"
        )
        user_prompt = "以下是統一 context，請輸出 JSON：\n" + json.dumps(context, ensure_ascii=False)

        try:
            raw = await asyncio.wait_for(
                self._get_llm().complete_json(
                    system_prompt,
                    user_prompt,
                    temperature=0.2,
                    max_tokens=900,
                    retries=2,
                ),
                timeout=self._timeout_sec,
            )
            result = {
                "final_summary": " ".join(str(raw.get("final_summary") or "").strip().split()),
                "recommendation_basis": self._normalize_str_list(raw.get("recommendation_basis")),
                "risk_points": self._normalize_str_list(raw.get("risk_points")),
                "source_highlights": self._normalize_source_highlights(raw.get("source_highlights")),
                "fallback_mode": False,
                "model": self._model_name or "",
            }
            if not result["final_summary"]:
                raise ValueError("missing final_summary")
            if not result["recommendation_basis"]:
                result["recommendation_basis"] = self._normalize_str_list(
                    list((context.get("core_decision") or {}).get("reason_points") or [])
                )[:4]
            if not result["risk_points"]:
                result["risk_points"] = self._normalize_str_list(
                    list((context.get("core_decision") or {}).get("risk_notes") or [])
                )[:4] or ["請留意市場波動與風險控管。"]
            result["ready_ms"] = round((time.perf_counter() - started_at) * 1000, 1)
            return result
        except Exception as exc:
            logger.warning("advisor llm full report fallback", exc_info=True)
            fallback = self._fallback(context=context, error=str(exc))
            fallback["ready_ms"] = round((time.perf_counter() - started_at) * 1000, 1)
            return fallback
