import json
import asyncio
from datetime import date
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from crud.llm_response import create_llm_response
from models.llm_response import LlmResponse, LLM_RESPONSE_KIND_TEXT_BRIEF
from stock_behavior.history import saved_brief
from stock_behavior.orchestrator import StockBehaviorOrchestrator
from schemas.stock_behavior import StockBehaviorTextBriefRequest


def test_saved_brief_reads_public_fields_and_never_exposes_blocked_output():
    engine = create_engine("sqlite:///:memory:")
    LlmResponse.__table__.create(engine)
    with Session(engine) as db:
        def save(day="2026-09-03", **extra):
            payload = {"symbol": "2330", "as_of_date": day, "generated_by": "test",
                       "status": "verified", "brief": {"headline": "test", "overall_stance": "neutral",
                       "confidence": "low", "confidence_reason": "test",
                       "key_days": [{"id":"kd", "date":day, "ref":"d", "what":"test"}],
                       **{section: [{"id":section, "claim_type":"observation", "direction":"neutral", "text":"test"}]
                          for section in ("current_status", "positive_factors", "negative_factors")},
                       "risks": [{"id":"risk", "risk_type":"test", "description":"test", "trigger":"test"}],
                       "watch_points": [{"id":"watch", "what_to_watch":"test", "why_it_matters":"test", "when":"test"}],
                       "forward_views": {key: {"stance":"neutral", "reason":"test", "invalidation":"test"}
                                         for key in ("short_1_5", "swing_6_20", "medium_21_40")}},
                       "evidence_catalog": [], "disclaimer": {"version": "1", "text": "test"},
                       "verification": {"internal": "secret"}}
            fields = dict(symbol="2330", as_of_date=date.fromisoformat(day), kind=LLM_RESPONSE_KIND_TEXT_BRIEF,
                          config_hash="a" * 64, config_json='{"revision":"r1"}',
                          response_json=json.dumps(payload), raw_llm_text="blocked private content")
            fields.update(extra)
            return create_llm_response(db, **fields)

        row = save()
        original = row.response_json
        brief = saved_brief(row)
        assert brief is not None
        assert brief.snapshot_id == row.id and brief.analysis_revision == "r1" and brief.cached
        public = brief.model_dump_json()
        assert "secret" not in public and "blocked private" not in public
        assert db.get(LlmResponse, row.id).response_json == original

        # 損毀或跟資料列對不起來的快照不能當成有效分析回傳
        assert saved_brief(save(response_json="broken json")) is None
        assert saved_brief(save(symbol="2317")) is None

        # Read-only loading uses the newest valid snapshot across configurations.
        save(day="2026-09-10", config_hash="current")
        latest = save(day="2026-09-11", config_hash="previous")
        save(day="2026-09-11", response_json="broken json")
        save(day="2026-09-12", is_fallback=True)
        save(day="2026-09-12", kind="other")
        save(day="2026-09-13")
        orchestrator = object.__new__(StockBehaviorOrchestrator)
        orchestrator._db = db
        orchestrator._settings = SimpleNamespace(ADVISOR_LLM_MODEL="test")
        orchestrator._llm = SimpleNamespace(model_name="test")
        orchestrator._text_brief_config = lambda model: {"revision": "new"}
        result = asyncio.run(orchestrator.generate_text_brief(
            StockBehaviorTextBriefRequest(symbol="2330", as_of_date=date(2026, 9, 12), cache_only=True)
        ))
        assert result.snapshot_id == latest.id
        assert result.as_of_date == "2026-09-11" and result.cached
        assert result.config_hash == "previous"
        missing = asyncio.run(orchestrator.generate_text_brief(
            StockBehaviorTextBriefRequest(symbol="2330", as_of_date=date(2026, 9, 1), cache_only=True)
        ))
        assert missing.status == "unavailable" and missing.brief is None
