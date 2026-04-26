from __future__ import annotations

import asyncio
import logging
import re
import uuid
from datetime import date
from typing import Any

from schemas.advisor import AdvisorOverviewRequest
from services.advisor.advisor_report import AdvisorReportService
from services.advisor.backtest_snapshot import BacktestSnapshotService
from services.advisor.core_decision import CoreDecisionService
from services.advisor.market_snapshot import MarketSnapshotService
from services.advisor.rule_summary import RuleSummaryBuilder
from services.advisor.runtime import AdvisorRuntimeStore

logger = logging.getLogger(__name__)


class AdvisorOrchestrator:
    def __init__(
        self,
        *,
        runtime_store: AdvisorRuntimeStore,
        market_snapshot_service: MarketSnapshotService,
        core_decision_service: CoreDecisionService,
        backtest_snapshot_service: BacktestSnapshotService,
        advisor_report_service: AdvisorReportService,
        rule_summary_builder: RuleSummaryBuilder,
    ) -> None:
        self._runtime_store = runtime_store
        self._market_snapshot_service = market_snapshot_service
        self._core_decision_service = core_decision_service
        self._backtest_snapshot_service = backtest_snapshot_service
        self._advisor_report_service = advisor_report_service
        self._rule_summary_builder = rule_summary_builder

    @staticmethod
    def _resolve_lookback_days(window_spec: str) -> int:
        token = (window_spec or "1y").strip().lower()
        match = re.fullmatch(r"(\d+)([dmy])", token)
        if not match:
            return 365
        amount = max(1, int(match.group(1)))
        unit = match.group(2)
        if unit == "d":
            return amount
        if unit == "m":
            return amount * 30
        return amount * 365

    async def overview(self, req: AdvisorOverviewRequest) -> dict[str, Any]:
        symbol = req.symbol.strip().upper()
        if not symbol:
            raise ValueError("symbol 為必填")
        as_of_date = req.as_of_date or date.today()

        snapshot = await self._market_snapshot_service.get_snapshot(
            symbol=symbol,
            as_of_date=as_of_date,
            lookback_days=self._resolve_lookback_days(req.window_spec),
        )
        decision = self._core_decision_service.build_decision(
            snapshot=snapshot,
            as_of_date=as_of_date,
            preset_id=req.preset_id,
            use_active_preset=req.use_active_preset,
        )

        cached_backtest = self._backtest_snapshot_service.get_cached_snapshot(
            symbol=symbol,
            as_of_date=as_of_date,
            preset_id=decision.get("preset_id"),
            use_active_preset=False,
            window_spec=req.window_spec,
            validation_mode=req.validation_mode,
        )

        request_id = uuid.uuid4().hex
        pending_tasks = 1 + (0 if cached_backtest else 1)
        self._runtime_store.create_request(request_id, pending_tasks=pending_tasks)

        rule_summary = self._rule_summary_builder.build(
            symbol=symbol,
            as_of_date=as_of_date,
            core_decision=decision,
            snapshot=snapshot,
            credibility_summary=(cached_backtest or {}).get("credibility_summary") if cached_backtest else None,
        )

        async def _report_event_handler(event: str, payload: dict[str, Any]) -> None:
            event_payload = {"request_id": request_id, **payload}
            self._runtime_store.append_request_event(request_id, event=event, data=event_payload)

        report_job = self._advisor_report_service.create_job(
            symbol=symbol,
            as_of_date=as_of_date,
            snapshot=snapshot,
            core_decision=decision,
            rule_summary=rule_summary,
            credibility_summary=(cached_backtest or {}).get("credibility_summary") if cached_backtest else None,
            event_handler=_report_event_handler,
        )
        report_task = self._runtime_store.get_report_task(report_job["job_id"])
        if report_task:
            report_task.add_done_callback(lambda task: self._mark_request_task_done(request_id, task))
        else:
            self._runtime_store.mark_request_task_done(request_id, failed=False)

        if not cached_backtest:
            cache_key, backtest_task = self._backtest_snapshot_service.enqueue_snapshot(
                symbol=symbol,
                as_of_date=as_of_date,
                preset_id=decision.get("preset_id"),
                use_active_preset=False,
                window_spec=req.window_spec,
                validation_mode=req.validation_mode,
                rolling_settings=req.rolling_settings.model_dump(mode="json") if req.rolling_settings else None,
                holdout_settings=req.holdout_settings.model_dump(mode="json") if req.holdout_settings else None,
                on_ready=lambda payload: self._runtime_store.append_request_event(
                    request_id,
                    event="core_backtest_ready",
                    data={"request_id": request_id, "cache_key": cache_key, "snapshot": payload},
                ),
                on_failed=lambda message: self._runtime_store.append_request_event(
                    request_id,
                    event="failed",
                    data={
                        "request_id": request_id,
                        "stage": "core_backtest",
                        "message": message,
                    },
                ),
            )
            if backtest_task is not None:
                backtest_task.add_done_callback(lambda task: self._mark_request_task_done(request_id, task))
            else:
                self._runtime_store.mark_request_task_done(request_id, failed=False)

        technical_history = list(snapshot.get("indicators") or [])[-30:]
        institutional_history = list(snapshot.get("institutional") or [])[-30:]

        return {
            "request_id": request_id,
            "job_id": report_job["job_id"],
            "advisor_report_status": report_job["status"],
            "symbol": symbol,
            "as_of_date": decision.get("as_of_date"),
            "active_preset": decision.get("active_preset"),
            "trend_conclusion": decision.get("trend_conclusion"),
            "confidence_level": decision.get("confidence_level"),
            "condition_checks": decision.get("condition_checks"),
            "reason_points": decision.get("reason_points"),
            "rule_summary": rule_summary,
            "technical_snapshot": decision.get("technical_snapshot"),
            "institutional_snapshot": decision.get("institutional_snapshot"),
            "technical_history": technical_history,
            "institutional_history": institutional_history,
            "price_chart": decision.get("price_chart"),
            "credibility_summary": (cached_backtest or {}).get("credibility_summary") if cached_backtest else None,
            "backtest_snapshot_status": "ready" if cached_backtest else "pending",
            "advisor_report_job": {
                "job_id": report_job["job_id"],
                "status": report_job["status"],
            },
        }

    def _mark_request_task_done(self, request_id: str, task: asyncio.Task[bool]) -> None:
        failed = False
        try:
            failed = not bool(task.result())
        except Exception:
            failed = True
            logger.exception("background task failed request_id=%s", request_id)
        self._runtime_store.mark_request_task_done(request_id, failed=failed)
