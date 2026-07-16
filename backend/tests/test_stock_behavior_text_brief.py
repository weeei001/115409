import ast
import asyncio
from copy import deepcopy
import json
from pathlib import Path
import re
from types import SimpleNamespace

from fastapi import FastAPI
import httpx
import pytest

from database import get_db
from routers import stock_behavior as router_module
from schemas.stock_behavior import (
    StockBehaviorAiRequest,
    StockBehaviorTextBriefResponse,
)
from stock_behavior import llm as llm_module
from stock_behavior import orchestrator as orchestrator_module
from stock_behavior.compliance import COMPLIANCE_POLICY_VERSION, scan_compliance
from stock_behavior.llm import StockBehaviorLlmService
from stock_behavior.orchestrator import (
    TEXT_BRIEF_DISCLAIMER_TEXT,
    StockBehaviorOrchestrator,
)
from stock_behavior.prompt_templates import (
    TEXT_BRIEF_PROMPT_VERSION,
    TEXT_BRIEF_SYSTEM_PROMPT,
)


def _settings(**overrides):
    values = {
        "NIM_API_KEY": "",
        "NIM_BASE_URL": "https://example.test/v1",
        "ADVISOR_LLM_MODEL": "deepseek-ai/deepseek-v4-pro",
        "ADVISOR_LLM_TEMPERATURE": 0.2,
        "ADVISOR_LLM_MAX_COMPLETION_TOKENS": 8192,
        "ADVISOR_LLM_RESPONSE_FORMAT": "json_object",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _inventory():
    return {
        "price_volume": [
            {"id": "pv_01", "field": "close", "date": "2026-07-15", "value": 1085},
            {
                "id": "pv_02",
                "field": "volume_shares",
                "date": "2026-07-15",
                "value": 30000000,
            },
        ],
        "chip": [
            {
                "id": "ch_01",
                "field": "foreign_net",
                "date": "2026-07-15",
                "value": 1000000,
            }
        ],
        "technical": [
            {"id": "tc_01", "field": "ma20", "date": "2026-07-15", "value": 1070},
            {"id": "tc_02", "field": "rsi_5", "date": "2026-07-15", "value": 58},
        ],
        "news": [],
        "missing_fields": [],
    }


def _valid_brief():
    claim = {
        "claim_type": "observation",
        "text": "收盤位於月線之上，短線價格結構偏強。",
        "direction": "positive",
        "evidence_ids": ["pv_01"],
        "importance": "high",
    }
    return {
        "headline": "價量偏強但籌碼仍待確認",
        "current_status": [
            {"id": "cs_01", **claim},
            {
                "id": "cs_02",
                **claim,
                "text": "成交量維持近期水準，追價力道仍待觀察。",
            },
        ],
        "key_reasons": [
            {
                "id": "why_01",
                **claim,
                "claim_type": "inference",
                "text": "價格位於月線之上，使短線承接較有依據。",
            },
            {
                "id": "why_02",
                **claim,
                "claim_type": "inference",
                "text": "外資單日買超提供承接，但仍需觀察延續性。",
                "evidence_ids": ["ch_01"],
            },
        ],
        "events": [],
        "potential_impacts": [],
        "source_divergences": [],
        "watch_conditions": [
            {
                "id": "cond_01",
                "kind": "confirmation",
                "trigger": {
                    "metric": "close_vs_ma20",
                    "operator": "stays_above",
                    "persistence_sessions": 2,
                    "event_ref": None,
                },
                "then": {
                    "effect_on_view": "strengthens",
                    "direction": "mildly_bullish",
                    "within_trading_days": 5,
                    "text": "若收盤持續位於月線之上，短線偏強看法獲得確認。",
                },
                "rationale": "月線可用來觀察價格承接是否延續。",
                "evidence_ids": ["tc_01"],
                "scorable": False,
            }
        ],
        "forward_views": [
            {
                "horizon": "short_1_5",
                "text": "短線價格結構偏強，但量能仍需確認。",
                "stance": "mildly_bullish",
                "confidence": "medium",
                "basis_item_ids": ["why_01"],
                "evidence_ids": ["pv_01"],
                "confirmation_condition_ids": ["cond_01"],
                "invalidation_condition_ids": [],
            },
            {
                "horizon": "swing_6_20",
                "text": "波段表現取決於外資承接能否延續。",
                "stance": "neutral",
                "confidence": "medium",
                "basis_item_ids": ["why_02"],
                "evidence_ids": ["ch_01"],
                "confirmation_condition_ids": ["cond_01"],
                "invalidation_condition_ids": [],
            },
            {
                "horizon": "medium_21_40",
                "text": "中期資料仍有限，方向判斷保留不確定性。",
                "stance": "uncertain",
                "confidence": "low",
                "basis_item_ids": ["why_01", "why_02"],
                "evidence_ids": ["pv_01", "ch_01"],
                "confirmation_condition_ids": ["cond_01"],
                "invalidation_condition_ids": [],
            },
        ],
        "thesis": {
            "statement": "價格結構偏強，籌碼延續性是後續核心觀察。",
            "status": "new",
            "evidence_ids": ["pv_01", "ch_01"],
        },
        "overall_stance": "mildly_bullish",
        "confidence": "medium",
        "confidence_reason": "價量與籌碼資料可供判斷，但訊號尚未完全一致。",
        "limitations": [],
    }


def _run_brief(monkeypatch, payload, *, meta=None):
    captured = {}

    class FakeLlm:
        model_name = "deepseek-ai/deepseek-v4-pro"

        async def generate_text_brief_from_evidence(self, *, task_packet):
            captured["task_packet"] = task_packet
            return (
                deepcopy(payload),
                json.dumps(payload, ensure_ascii=False),
                meta
                or {
                    "finish_reason": "stop",
                    "completion_tokens": 100,
                    "truncated": False,
                },
            )

    service = StockBehaviorOrchestrator(
        db=SimpleNamespace(rollback=lambda: None),
        settings=_settings(),
    )
    service._llm = FakeLlm()
    service._collect_llm_evidence_from_crud = lambda **kwargs: {
        "price_window": {"data": []},
        "chip_window": {"data": []},
        "technical_window": {"data": []},
    }
    service._build_data_inventory = lambda **kwargs: deepcopy(_inventory())
    monkeypatch.setattr(
        orchestrator_module,
        "create_snapshot",
        lambda db, **fields: captured.update(snapshot=fields),
    )
    response = asyncio.run(
        service.generate_text_brief(
            StockBehaviorAiRequest(symbol="2330", as_of_date="2026-07-15")
        )
    )
    return response, captured


def test_schema_happy_path_is_verified_with_fixed_disclaimer_and_used_catalog(
    monkeypatch,
):
    response, captured = _run_brief(monkeypatch, _valid_brief())

    assert response.status == "verified"
    assert response.disclaimer.version == "v1"
    assert response.disclaimer.text == TEXT_BRIEF_DISCLAIMER_TEXT
    assert [item.id for item in response.evidence_catalog] == [
        "pv_01",
        "ch_01",
        "tc_01",
    ]
    assert captured["task_packet"]["task"]["type"] == "stock_behavior_text_brief"
    assert captured["snapshot"]["is_fallback"] is False


@pytest.mark.parametrize("variant", ["missing", "duplicate"])
def test_forward_views_missing_or_duplicate_horizon_falls_back(
    monkeypatch,
    variant,
):
    brief = _valid_brief()
    if variant == "missing":
        brief["forward_views"].pop()
    else:
        brief["forward_views"][2]["horizon"] = "short_1_5"

    response, _ = _run_brief(monkeypatch, brief)

    assert response.status == "unavailable"
    assert response.brief is None


def test_invalid_claim_enum_discards_only_that_item_and_marks_limited(monkeypatch):
    brief = _valid_brief()
    brief["current_status"][1]["direction"] = "sideways"

    response, _ = _run_brief(monkeypatch, brief)

    assert response.status == "limited"
    assert [item.id for item in response.brief.current_status] == ["cs_01"]


def test_unknown_evidence_id_is_filtered_and_marks_limited(monkeypatch):
    brief = _valid_brief()
    brief["current_status"][0]["evidence_ids"].append("pv_99")

    response, _ = _run_brief(monkeypatch, brief)

    assert response.status == "limited"
    assert response.brief.current_status[0].evidence_ids == ["pv_01"]
    assert response.verification.filtered_evidence_ids == ["pv_99"]


def test_future_event_is_removed_and_marks_limited(monkeypatch):
    brief = _valid_brief()
    brief["events"] = [
        {
            "id": "event_01",
            "event_date": "2026-07-16",
            "recency": "today",
            "title": "未來事件",
            "description": "此事件日期晚於分析基準日。",
            "information_type": "event",
            "evidence_ids": ["pv_01"],
            "materiality": "high",
        }
    ]

    response, _ = _run_brief(monkeypatch, brief)

    assert response.status == "limited"
    assert response.brief.events == []
    assert response.verification.future_dated_items == ["event_01"]


def test_compliance_scan_is_observational_and_ignores_historical_close(monkeypatch):
    brief = _valid_brief()
    brief["current_status"][0]["text"] = "建議買進，後續上看 1200 元。"

    response, _ = _run_brief(monkeypatch, brief)

    assert response.status == "limited"
    assert any(item.startswith("操作指令詞:") for item in response.verification.compliance_violations)
    assert any(item.startswith("目標價型:") for item in response.verification.compliance_violations)
    historical = scan_compliance("收盤 1085 元站上月線")
    assert not any(item.startswith(("操作指令詞:", "目標價型:")) for item in historical)


def test_truncated_output_is_unavailable_and_creates_fallback_snapshot(monkeypatch):
    response, captured = _run_brief(
        monkeypatch,
        {},
        meta={
            "finish_reason": "length",
            "completion_tokens": 8192,
            "truncated": True,
        },
    )

    assert response.status == "unavailable"
    assert response.brief is None
    assert response.limitations == ["模型輸出無法解析，本次無法提供簡報。"]
    snapshot = captured["snapshot"]
    assert snapshot["is_fallback"] is True
    assert snapshot["prompt_version"] == "v3-text-first-01"
    config = json.loads(snapshot["config_json"])
    assert config["prompt_version"] == TEXT_BRIEF_PROMPT_VERSION
    assert config["schema_version"] == "text-first-v1"
    assert config["compliance_policy_version"] == COMPLIANCE_POLICY_VERSION


def test_text_brief_route_returns_response_envelope(monkeypatch):
    expected = StockBehaviorTextBriefResponse.model_validate(
        {
            "symbol": "2330",
            "as_of_date": "2026-07-15",
            "generated_by": "mock",
            "status": "verified",
            "brief": _valid_brief(),
            "evidence_catalog": [],
            "verification": {
                "filtered_evidence_ids": [],
                "compliance_violations": [],
                "simplified_chars": [],
                "future_dated_items": [],
            },
            "disclaimer": {"version": "v1", "text": TEXT_BRIEF_DISCLAIMER_TEXT},
            "limitations": [],
        }
    )

    class FakeOrchestrator:
        async def generate_text_brief(self, req):
            return expected

    monkeypatch.setattr(
        router_module,
        "_build_orchestrator",
        lambda db: FakeOrchestrator(),
    )
    app = FastAPI()
    app.include_router(router_module.router)

    async def fake_db():
        return SimpleNamespace()

    app.dependency_overrides[get_db] = fake_db

    async def post_text_brief():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            return await client.post(
                "/analyze/stock-behavior/text-brief",
                json={"symbol": "2330", "as_of_date": "2026-07-15"},
            )

    response = asyncio.run(post_text_brief())

    assert response.status_code == 200
    assert response.json()["schema_version"] == "text-first-v1"
    assert response.json()["status"] == "verified"
    assert response.json()["brief"]["forward_views"][2]["horizon"] == "medium_21_40"


def test_llm_text_brief_uses_v3_prompt_static_schema_and_strict_root_json(
    monkeypatch,
):
    captured = {}

    class FakeChatOpenAI:
        def __init__(self, **kwargs):
            pass

        async def ainvoke(self, messages):
            captured["messages"] = messages
            return SimpleNamespace(
                content='{"headline":"ok"}',
                response_metadata={
                    "finish_reason": "stop",
                    "token_usage": {"completion_tokens": 5},
                },
            )

    monkeypatch.setattr(llm_module, "ChatOpenAI", FakeChatOpenAI)
    parsed, raw_text, meta = asyncio.run(
        StockBehaviorLlmService(
            _settings(NIM_API_KEY="token")
        ).generate_text_brief_from_evidence(task_packet={"task": {"symbol": "2330"}})
    )

    assert captured["messages"][0] == ("system", TEXT_BRIEF_SYSTEM_PROMPT)
    user_prompt = captured["messages"][1][1]
    assert user_prompt.startswith("<prefetched_evidence_payload>\n")
    assert "<output_schema>\n" in user_prompt
    assert user_prompt.endswith("請依 system 指示產出文字簡報 JSON。")
    assert parsed == {"headline": "ok"}
    assert raw_text == '{"headline":"ok"}'
    assert meta["truncated"] is False


def test_v3_prompt_matches_wave1_spec_verbatim():
    spec = (
        Path(__file__).resolve().parents[2] / "docs" / "wave1_spec.md"
    ).read_text(encoding="utf-8")
    block = re.search(
        r'\x60\x60\x60python\n(TEXT_BRIEF_PROMPT_VERSION = "v3-text-first-01"\n\n'
        r'TEXT_BRIEF_SYSTEM_PROMPT = """.*?"""\n)\x60\x60\x60',
        spec,
        re.DOTALL,
    )
    assert block is not None
    expected = {
        node.targets[0].id: ast.literal_eval(node.value)
        for node in ast.parse(block.group(1)).body
        if isinstance(node, ast.Assign)
    }
    assert TEXT_BRIEF_PROMPT_VERSION == expected["TEXT_BRIEF_PROMPT_VERSION"]
    assert TEXT_BRIEF_SYSTEM_PROMPT == expected["TEXT_BRIEF_SYSTEM_PROMPT"]
