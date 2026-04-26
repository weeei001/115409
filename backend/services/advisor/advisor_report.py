from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import date, datetime
from typing import Any, Awaitable, Callable

from services.advisor.core_decision import CoreDecisionService
from services.advisor.llm_service import AdvisorLLMService
from services.advisor.market_snapshot import MarketSnapshotService
from services.advisor.news_context import NewsContextService
from services.advisor.rule_summary import RuleSummaryBuilder
from services.advisor.runtime import AdvisorRuntimeStore

logger = logging.getLogger(__name__)

_FALLBACK_LOOKBACK_DAYS = 365

EventHandler = Callable[[str, dict[str, Any]], Awaitable[None] | None]


class AdvisorReportService:
    """
    Background advisor report jobs.
    - News context can fail without blocking.
    - Full report calls LLM exactly once (single model).
    """

    def __init__(
        self,
        *,
        runtime_store: AdvisorRuntimeStore,
        news_context_service: NewsContextService,
        market_snapshot_service: MarketSnapshotService,
        core_decision_service: CoreDecisionService,
        rule_summary_builder: RuleSummaryBuilder,
        llm_service: AdvisorLLMService,
    ) -> None:
        self._runtime_store = runtime_store
        self._news_context_service = news_context_service
        self._market_snapshot_service = market_snapshot_service
        self._core_decision_service = core_decision_service
        self._rule_summary_builder = rule_summary_builder
        self._llm_service = llm_service

    @staticmethod
    def _utc_now() -> str:
        return datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

    @staticmethod
    async def _emit(handler: EventHandler | None, event: str, payload: dict[str, Any]) -> None:
        if handler is None:
            return
        result = handler(event, payload)
        if asyncio.iscoroutine(result):
            await result

    async def _resolve_context(
        self,
        *,
        symbol: str,
        as_of_date: date,
        snapshot: dict[str, Any] | None,
        core_decision: dict[str, Any] | None,
        rule_summary: list[str] | None,
        credibility_summary: dict[str, Any] | None,
    ) -> tuple[dict[str, Any], dict[str, Any], list[str], dict[str, Any] | None]:
        resolved_snapshot = snapshot
        resolved_decision = core_decision
        if not resolved_snapshot or not resolved_decision:
            resolved_snapshot = await self._market_snapshot_service.get_snapshot(
                symbol=symbol,
                as_of_date=as_of_date,
                lookback_days=_FALLBACK_LOOKBACK_DAYS,
            )
            resolved_decision = self._core_decision_service.build_decision(
                snapshot=resolved_snapshot,
                as_of_date=as_of_date,
                preset_id=None,
                use_active_preset=True,
            )

        resolved_rule_summary = list(rule_summary or [])
        if not resolved_rule_summary:
            resolved_rule_summary = self._rule_summary_builder.build(
                symbol=symbol,
                as_of_date=as_of_date,
                core_decision=resolved_decision,
                snapshot=resolved_snapshot,
                credibility_summary=credibility_summary,
            )
        return resolved_snapshot, resolved_decision, resolved_rule_summary, credibility_summary

    @staticmethod
    def _build_market_snapshot_for_llm(snapshot: dict[str, Any]) -> dict[str, Any]:
        latest_price = dict(snapshot.get("latest_price") or {})
        latest_technical = dict(snapshot.get("latest_technical") or {})
        latest_institutional = dict(snapshot.get("latest_institutional") or {})
        prices = list(snapshot.get("prices") or [])
        return {
            "latest_price": {
                "date": latest_price.get("date"),
                "close": latest_price.get("close"),
                "change": latest_price.get("change"),
                "volume": latest_price.get("volume"),
            },
            "latest_technical": {
                "date": latest_technical.get("date"),
                "ma5": latest_technical.get("ma5"),
                "ma20": latest_technical.get("ma20"),
                "ma60": latest_technical.get("ma60"),
                "rsi14": latest_technical.get("rsi14"),
                "macd_hist": latest_technical.get("macd_hist"),
            },
            "latest_institutional": {
                "date": latest_institutional.get("date"),
                "foreign_net": latest_institutional.get("foreign_net"),
                "trust_net": latest_institutional.get("trust_net"),
                "dealer_net": latest_institutional.get("dealer_net"),
                "total_net": latest_institutional.get("total_net"),
            },
            "series_sizes": {
                "prices": len(prices),
                "indicators": len(list(snapshot.get("indicators") or [])),
                "institutional": len(list(snapshot.get("institutional") or [])),
            },
        }

    async def _build_full_report(
        self,
        *,
        symbol: str,
        as_of_date: date,
        snapshot: dict[str, Any],
        core_decision: dict[str, Any],
        rule_summary: list[str],
        credibility_summary: dict[str, Any] | None,
        news_payload: dict[str, Any],
    ) -> dict[str, Any]:
        llm_context = {
            "symbol": symbol,
            "as_of_date": as_of_date.isoformat(),
            "market_snapshot": self._build_market_snapshot_for_llm(snapshot),
            "core_decision": {
                "trend_conclusion": core_decision.get("trend_conclusion"),
                "confidence_level": core_decision.get("confidence_level"),
                "condition_checks": core_decision.get("condition_checks"),
                "reason_points": core_decision.get("reason_points"),
                "risk_notes": core_decision.get("risk_notes"),
            },
            "rule_summary": rule_summary,
            "credibility_summary": credibility_summary or {},
            "news_context": {
                "count": news_payload.get("count"),
                "rag_summary": news_payload.get("rag_summary"),
                "source_items": list(news_payload.get("source_items") or [])[:8],
            },
        }

        llm_report = await self._llm_service.generate_full_report(context=llm_context)
        return {
            "symbol": symbol,
            "as_of_date": as_of_date.isoformat(),
            "trend_conclusion": core_decision.get("trend_conclusion"),
            "confidence_level": core_decision.get("confidence_level"),
            "rule_summary": rule_summary,
            "final_summary": llm_report.get("final_summary") or "",
            "recommendation_basis": list(llm_report.get("recommendation_basis") or []),
            "risk_points": list(llm_report.get("risk_points") or []),
            "source_highlights": list(llm_report.get("source_highlights") or []),
            "news_fallback_mode": bool(news_payload.get("fallback_mode")),
            "llm_fallback_mode": bool(llm_report.get("fallback_mode")),
            "status": "done",
        }

    def create_job(
        self,
        *,
        symbol: str,
        as_of_date: date,
        snapshot: dict[str, Any] | None = None,
        core_decision: dict[str, Any] | None = None,
        rule_summary: list[str] | None = None,
        credibility_summary: dict[str, Any] | None = None,
        event_handler: EventHandler | None = None,
    ) -> dict[str, Any]:
        normalized_symbol = symbol.strip().upper()
        if not normalized_symbol:
            raise ValueError("symbol 不可為空")

        job_id = uuid.uuid4().hex
        now = self._utc_now()
        job = {
            "job_id": job_id,
            "symbol": normalized_symbol,
            "as_of_date": as_of_date.isoformat(),
            "status": "queued",
            "created_at": now,
            "updated_at": now,
            "rule_summary": rule_summary,
            "news": None,
            "full_report": None,
            "error": None,
        }
        self._runtime_store.create_report_job(job)

        task = asyncio.create_task(
            self._run_job(
                job_id=job_id,
                symbol=normalized_symbol,
                as_of_date=as_of_date,
                snapshot=snapshot,
                core_decision=core_decision,
                rule_summary=rule_summary,
                credibility_summary=credibility_summary,
                event_handler=event_handler,
            )
        )
        self._runtime_store.attach_report_task(job_id, task)
        task.add_done_callback(lambda _: self._runtime_store.clear_report_task(job_id))
        return job

    async def _run_job(
        self,
        *,
        job_id: str,
        symbol: str,
        as_of_date: date,
        snapshot: dict[str, Any] | None,
        core_decision: dict[str, Any] | None,
        rule_summary: list[str] | None,
        credibility_summary: dict[str, Any] | None,
        event_handler: EventHandler | None,
    ) -> bool:
        self._runtime_store.update_report_job(job_id, status="running")
        try:
            resolved_snapshot, resolved_decision, resolved_rule_summary, resolved_credibility = await self._resolve_context(
                symbol=symbol,
                as_of_date=as_of_date,
                snapshot=snapshot,
                core_decision=core_decision,
                rule_summary=rule_summary,
                credibility_summary=credibility_summary,
            )
        except Exception as exc:
            message = str(exc) or "建立 Advisor 報告上下文失敗"
            self._runtime_store.update_report_job(job_id, status="failed", error=message)
            await self._emit(event_handler, "failed", {"job_id": job_id, "stage": "advisor_context", "message": message})
            return False

        try:
            news_payload = await self._news_context_service.build_context(
                symbol=symbol,
                as_of_date=as_of_date,
                core_decision=resolved_decision,
            )
            self._runtime_store.update_report_job(job_id, status="news_ready", news=news_payload)
            await self._emit(event_handler, "news_ready", {"job_id": job_id, "news": news_payload})

            full_report = await self._build_full_report(
                symbol=symbol,
                as_of_date=as_of_date,
                snapshot=resolved_snapshot,
                core_decision=resolved_decision,
                rule_summary=resolved_rule_summary,
                credibility_summary=resolved_credibility,
                news_payload=news_payload,
            )
            self._runtime_store.update_report_job(job_id, status="completed", full_report=full_report)
            await self._emit(event_handler, "advisor_full_report_ready", {"job_id": job_id, "full_report": full_report})
            return True
        except Exception as exc:
            logger.exception("advisor report job failed job_id=%s symbol=%s", job_id, symbol)
            message = str(exc) or "AI 報告生成失敗"
            self._runtime_store.update_report_job(job_id, status="failed", error=message)
            await self._emit(event_handler, "failed", {"job_id": job_id, "stage": "advisor_report", "message": message})
            return False

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        return self._runtime_store.get_report_job(job_id)
