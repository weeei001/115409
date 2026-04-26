from __future__ import annotations

from pathlib import Path

from services.advisor.advisor_report import AdvisorReportService
from services.advisor.backtest_snapshot import BacktestSnapshotService
from services.advisor.core_decision import CoreDecisionService
from services.advisor.llm_service import AdvisorLLMService
from services.advisor.market_snapshot import MarketSnapshotService
from services.advisor.news_context import NewsContextService
from services.advisor.orchestrator import AdvisorOrchestrator
from services.advisor.runtime import AdvisorRuntimeStore
from services.advisor.rule_summary import RuleSummaryBuilder

_PRESET_STORE_PATH = Path(__file__).resolve().parents[2] / "data" / "core_mode_presets.json"

_runtime_store = AdvisorRuntimeStore(backtest_cache_ttl_seconds=1800)
_market_snapshot_service = MarketSnapshotService()
_core_decision_service = CoreDecisionService(preset_store_path=_PRESET_STORE_PATH)
_rule_summary_builder = RuleSummaryBuilder()
_advisor_llm_service = AdvisorLLMService(timeout_sec=180)
_news_context_service = NewsContextService()
_backtest_snapshot_service = BacktestSnapshotService(
    preset_store_path=_PRESET_STORE_PATH,
    runtime_store=_runtime_store,
)
_advisor_report_service = AdvisorReportService(
    runtime_store=_runtime_store,
    news_context_service=_news_context_service,
    market_snapshot_service=_market_snapshot_service,
    core_decision_service=_core_decision_service,
    rule_summary_builder=_rule_summary_builder,
    llm_service=_advisor_llm_service,
)
_advisor_orchestrator = AdvisorOrchestrator(
    runtime_store=_runtime_store,
    market_snapshot_service=_market_snapshot_service,
    core_decision_service=_core_decision_service,
    backtest_snapshot_service=_backtest_snapshot_service,
    advisor_report_service=_advisor_report_service,
    rule_summary_builder=_rule_summary_builder,
)


def get_runtime_store() -> AdvisorRuntimeStore:
    return _runtime_store


def get_market_snapshot_service() -> MarketSnapshotService:
    return _market_snapshot_service


def get_core_decision_service() -> CoreDecisionService:
    return _core_decision_service


def get_backtest_snapshot_service() -> BacktestSnapshotService:
    return _backtest_snapshot_service


def get_advisor_report_service() -> AdvisorReportService:
    return _advisor_report_service


def get_advisor_orchestrator() -> AdvisorOrchestrator:
    return _advisor_orchestrator

