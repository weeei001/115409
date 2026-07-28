import asyncio
from copy import deepcopy
from datetime import date
import json
from types import SimpleNamespace

from fastapi import FastAPI
import httpx
import pytest

from database import get_db
from routers import stock_behavior as router_module
from schemas.stock_behavior import (
    StockBehaviorTextBrief,
    StockBehaviorTextBriefRequest,
    StockBehaviorTextBriefResponse,
)
from stock_behavior import few_shot_examples
from stock_behavior import llm as llm_module
from stock_behavior import orchestrator as orchestrator_module
from stock_behavior.compliance import (
    COMPLIANCE_POLICY_VERSION,
    scan_compliance,
    scan_compliance_hits,
)
from stock_behavior.evidence import EvidenceBundle
from stock_behavior.llm import StockBehaviorLlmService, build_text_brief_system_prompt
from stock_behavior.orchestrator import (
    TEXT_BRIEF_DISCLAIMER_TEXT,
    TEXT_BRIEF_NO_GUIDANCE_LIMITATION,
    TEXT_BRIEF_TARGET_COUNTS,
    StockBehaviorOrchestrator,
)
from stock_behavior.prompt_templates import (
    TEXT_BRIEF_PROMPT_VERSION,
    TEXT_BRIEF_SYSTEM_PROMPT,
)
from stock_behavior.utils import UpstreamModelError


AS_OF = date(2026, 7, 13)


def _settings(**overrides):
    values = {
        "NIM_API_KEY": "",
        "NIM_BASE_URL": "https://example.test/v1",
        "ADVISOR_LLM_MODEL": "test-model",
        "ADVISOR_LLM_TEMPERATURE": 0.2,
        "ADVISOR_LLM_MAX_COMPLETION_TOKENS": 8192,
        "ADVISOR_LLM_RESPONSE_FORMAT": "json_object",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _bundle(**overrides) -> EvidenceBundle:
    values = {
        "symbol": "2330",
        "as_of_date": AS_OF,
        "daily_timeline": [
            {
                "id": "d_01",
                "date": "2026-07-09",
                "close": 2415.0,
                "chg_pct": -2.03,
                "vol_lots": 34681,
                "vol_vs_ma5_pct": 19.0,
                "foreign_net_lots": -12749,
                "vs_ma20_pct": 0.2,
                "news": ["nw_01"],
            },
            {
                "id": "d_02",
                "date": "2026-07-13",
                "close": 2440.0,
                "chg_pct": 1.04,
                "vol_lots": 35310,
                "vol_vs_ma5_pct": 19.0,
                "foreign_net_lots": -2045,
                "vs_ma20_pct": 0.8,
                "news": [],
            },
        ],
        "long_term_anchor": [
            {
                "id": "lt_01",
                "field": "close_pos_in_1y_pct",
                "date": "2026-07-13",
                "value": 95.1,
            }
        ],
        "fundamental": [
            {
                "id": "fd_01",
                "field": "eps",
                "period": "2026Q1",
                "date": "2026-03-31",
                "value": 22.08,
                "yoy_pct": 58.3,
            }
        ],
        "news": [
            {
                "id": "nw_01",
                "field": "news",
                "date": "2026-07-09",
                "kind": "general",
                "title": "外資賣超台積電",
                "value": "外資單日調節部位。",
            }
        ],
        "missing_fields": [],
    }
    values.update(overrides)
    return EvidenceBundle(**values)


def _claim(claim_id: str, **overrides) -> dict:
    claim = {
        "id": claim_id,
        "claim_type": "observation",
        "text": "收盤價落在近一個月平均價位之上，短線結構仍偏穩。",
        "direction": "positive",
        "evidence_ids": ["d_02"],
        "importance": "high",
    }
    claim.update(overrides)
    return claim


def _forward_view(stance: str = "neutral") -> dict:
    return {
        "stance": stance,
        "reason": "量能與籌碼都沒有給出明確方向。",
        "invalidation": "出現量價同步放大且外資轉為買超的交易日",
        "evidence_ids": ["d_02"],
    }


def _valid_brief() -> dict:
    return {
        "key_days": [
            {
                "id": "kd_01",
                "date": "2026-07-09",
                "ref": "d_01",
                "what": "下跌 2.03%，成交量放大 19%，外資單日賣超近一萬三千張。",
                "evidence_ids": ["d_01", "nw_01"],
            },
            {
                "id": "kd_02",
                "date": "2026-07-13",
                "ref": "d_02",
                "what": "小幅反彈 1.04%，成交量同樣放大 19%，但外資仍是賣超。",
                "evidence_ids": ["d_02"],
            },
            {
                "id": "kd_03",
                "date": "2026-07-13",
                "ref": "d_02",
                "what": "收盤重新回到近一個月的平均價位之上。",
                "evidence_ids": ["d_02"],
            },
        ],
        "headline": "獲利成長強勁但外資持續調節",
        "current_status": [_claim("cs_01"), _claim("cs_02")],
        "positive_factors": [
            _claim("pos_01", claim_type="inference", evidence_ids=["fd_01"])
        ],
        "negative_factors": [
            _claim(
                "neg_01",
                claim_type="inference",
                direction="negative",
                text="外資連續調節，賣壓明顯而且持續。",
                evidence_ids=["d_01", "d_02"],
            )
        ],
        "source_divergences": [],
        "risks": [
            {
                "id": "rk_01",
                "risk_type": "籌碼",
                "description": "外資近兩週幾乎每天都是賣超，籌碼鬆動的影響會被放大。",
                "trigger": "外資單日賣超再度超過一萬張，且股價同步收黑",
                "evidence_ids": ["d_01", "d_02"],
            }
        ],
        "watch_points": [
            {
                "id": "wp_01",
                "what_to_watch": "外資連續賣超會不會中斷",
                "why_it_matters": "近兩週的壓力主要來自外資調節，這條賣超鏈沒斷就難以脫離整理。",
                "when": "接下來一到兩週",
                "evidence_ids": ["d_01", "d_02"],
            },
            {
                "id": "wp_02",
                "what_to_watch": "上漲日的成交量",
                "why_it_matters": "只有出現量價同步放大的日子，才代表買方態度真的轉變。",
                "when": "接下來的每個交易日",
                "evidence_ids": ["d_02"],
            },
        ],
        "forward_views": {
            "short_1_5": _forward_view(),
            "swing_6_20": _forward_view("mixed"),
            "medium_21_40": _forward_view("mildly_bullish"),
        },
        "overall_stance": "mixed",
        "confidence": "medium",
        "confidence_reason": "資料齊備但基本面與籌碼方向相反。",
        "limitations": [],
    }


def _run_brief(
    monkeypatch,
    payload,
    *,
    meta=None,
    bundle=None,
    cached_row=None,
    force_refresh=False,
):
    captured = {}
    bundle = bundle if bundle is not None else _bundle()

    class FakeLlm:
        model_name = "test-model"

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

    async def fake_news(*, symbol, as_of_date):
        captured["news_call"] = {"symbol": symbol, "as_of_date": as_of_date}
        return [], False

    service._fetch_text_brief_news = fake_news
    monkeypatch.setattr(
        orchestrator_module,
        "build_evidence_bundle",
        lambda db, **kwargs: bundle,
    )
    monkeypatch.setattr(
        orchestrator_module,
        "get_cached_snapshot",
        lambda db, **kwargs: cached_row,
    )
    monkeypatch.setattr(
        orchestrator_module,
        "create_snapshot",
        lambda db, **fields: captured.update(snapshot=fields),
    )
    response = asyncio.run(
        service.generate_text_brief(
            StockBehaviorTextBriefRequest(
                symbol="2330",
                as_of_date=AS_OF.isoformat(),
                force_refresh=force_refresh,
            )
        )
    )
    return response, captured


def test_happy_path_is_verified_with_backfilled_numbers_and_used_catalog(monkeypatch):
    response, captured = _run_brief(monkeypatch, _valid_brief())

    assert response.status == "verified"
    assert response.schema_version == "text-first-v2"
    assert response.cached is False
    assert response.disclaimer.text == TEXT_BRIEF_DISCLAIMER_TEXT
    assert [item.id for item in response.evidence_catalog] == [
        "d_01",
        "d_02",
        "fd_01",
        "nw_01",
    ]
    assert captured["task_packet"]["task"]["type"] == "stock_behavior_text_brief"
    assert "field_glossary" not in captured["task_packet"]
    assert captured["news_call"] == {"symbol": "2330", "as_of_date": AS_OF}
    assert captured["snapshot"]["is_fallback"] is False
    config = json.loads(captured["snapshot"]["config_json"])
    assert config["schema_version"] == "text-first-v2"
    assert config["compliance_policy_version"] == COMPLIANCE_POLICY_VERSION


def test_key_day_numbers_are_backfilled_from_timeline_not_from_model(monkeypatch):
    brief = _valid_brief()
    brief["key_days"][0]["move_pct"] = 99.9
    brief["key_days"][0]["volume_ratio"] = 42.0

    response, _ = _run_brief(monkeypatch, brief)

    first = response.brief.key_days[0]
    assert first.move_pct == -2.03
    assert first.volume_ratio == 1.19


def test_key_day_with_unknown_reference_is_discarded_and_marks_limited(monkeypatch):
    brief = _valid_brief()
    brief["key_days"][2]["ref"] = "d_99"
    brief["key_days"][2]["date"] = "2026-07-10"

    response, _ = _run_brief(monkeypatch, brief)

    assert response.status == "limited"
    assert [item.id for item in response.brief.key_days] == ["kd_01", "kd_02"]


def test_future_dated_key_day_is_removed_and_recorded(monkeypatch):
    brief = _valid_brief()
    brief["key_days"][2]["date"] = "2026-07-14"

    response, _ = _run_brief(monkeypatch, brief)

    assert response.status == "limited"
    assert response.verification.future_dated_items == ["kd_03"]
    assert [item.id for item in response.brief.key_days] == ["kd_01", "kd_02"]


def test_key_day_without_backfillable_numbers_is_flagged(monkeypatch):
    """回填不到數字代表那天缺價量資料，沉默通過會讓 status 假性 verified。"""
    bundle = _bundle(
        daily_timeline=[
            {"id": "d_01", "date": "2026-07-09", "close": 2415.0, "news": []},
            {"id": "d_02", "date": "2026-07-13", "close": 2440.0, "news": []},
        ]
    )
    brief = _valid_brief()
    for item in brief["key_days"]:
        item["what"] = "當天沒有可用的漲跌幅資料。"

    response, _ = _run_brief(monkeypatch, brief, bundle=bundle)

    assert response.status == "limited"
    assert response.verification.unverified_numbers == [
        "kd_01: 該日缺少漲跌幅資料",
        "kd_02: 該日缺少漲跌幅資料",
        "kd_03: 該日缺少漲跌幅資料",
    ]


def test_key_day_number_not_present_in_payload_is_flagged(monkeypatch):
    brief = _valid_brief()
    brief["key_days"][0]["what"] = "下跌 7.77%，成交量放大 19%。"

    response, _ = _run_brief(monkeypatch, brief)

    assert response.status == "limited"
    assert response.verification.unverified_numbers == ["kd_01: 7.77%"]


def test_oversized_sections_are_truncated_instead_of_discarding_the_brief(monkeypatch):
    """實測 nemotron 會多給一項；因為多寫一項就整份丟掉是把好結果當垃圾。"""
    brief = _valid_brief()
    brief["positive_factors"] = [
        _claim(f"pos_0{index}", claim_type="inference", evidence_ids=["fd_01"])
        for index in range(1, 5)
    ]
    brief["watch_points"] = [
        {
            "id": f"wp_0{index}",
            "what_to_watch": "外資連續賣超會不會中斷",
            "why_it_matters": "近兩週的壓力主要來自外資調節。",
            "when": "接下來一到兩週",
            "evidence_ids": ["d_01"],
        }
        for index in range(1, 6)
    ]

    response, _ = _run_brief(monkeypatch, brief)

    assert response.status == "limited"
    assert response.brief is not None
    assert len(response.brief.positive_factors) == 3
    assert len(response.brief.watch_points) == 4
    assert set(response.verification.truncated_sections) == {
        "positive_factors>3",
        "watch_points>4",
    }


def test_jargon_is_recorded_but_does_not_change_status(monkeypatch):
    brief = _valid_brief()
    brief["current_status"][0]["text"] = "MACD 柱狀圖轉負，股價貼著月線整理。"

    response, _ = _run_brief(monkeypatch, brief)

    assert response.status == "verified"
    assert set(response.verification.jargon_hits) == {"MACD", "月線"}


def test_undercount_marks_limited_without_discarding_the_brief(monkeypatch):
    brief = _valid_brief()
    brief["key_days"] = brief["key_days"][:1]

    response, _ = _run_brief(monkeypatch, brief)

    assert response.status == "limited"
    assert response.verification.undercount_sections == [
        f"key_days<{TEXT_BRIEF_TARGET_COUNTS['key_days']}"
    ]
    assert response.brief is not None


def test_invalid_claim_enum_discards_only_that_item_and_marks_limited(monkeypatch):
    brief = _valid_brief()
    brief["current_status"][1]["direction"] = "sideways"

    response, _ = _run_brief(monkeypatch, brief)

    assert response.status == "limited"
    assert [item.id for item in response.brief.current_status] == ["cs_01"]


def test_unknown_evidence_id_is_filtered_and_marks_limited(monkeypatch):
    brief = _valid_brief()
    brief["current_status"][0]["evidence_ids"].append("d_99")

    response, _ = _run_brief(monkeypatch, brief)

    assert response.status == "limited"
    assert response.brief.current_status[0].evidence_ids == ["d_02"]
    assert response.verification.filtered_evidence_ids == ["d_99"]


def test_item_compliance_hard_gate_removes_claim_and_ignores_historical_close(
    monkeypatch,
):
    brief = _valid_brief()
    brief["current_status"][0]["text"] = "建議買進，後續上看 3000 元。"

    response, _ = _run_brief(monkeypatch, brief)

    assert response.status == "limited"
    assert [item.id for item in response.brief.current_status] == ["cs_02"]
    assert response.verification.removed_item_ids == ["cs_01"]
    assert any(
        item.startswith("操作指令-hard:")
        for item in response.verification.compliance_violations
    )
    historical = scan_compliance_hits("七月十三日收在 2440 元，上漲 1.04%")
    assert historical == []


def test_item_compliance_removal_below_required_minimum_is_unavailable(monkeypatch):
    brief = _valid_brief()
    brief["positive_factors"][0]["text"] = "建議買進。"

    response, captured = _run_brief(monkeypatch, brief)

    assert response.status == "unavailable"
    assert response.brief is None
    assert "簡報內容未通過合規檢查，本次無法提供。" in response.limitations
    assert response.verification.removed_item_ids == ["pos_01"]
    assert captured["snapshot"]["is_fallback"] is True


def test_core_compliance_hard_gate_preserves_blocked_payload_for_research(monkeypatch):
    brief = _valid_brief()
    brief["headline"] = "股價上看 3000 元"

    response, captured = _run_brief(monkeypatch, brief)

    assert response.status == "unavailable"
    assert response.brief is None
    blocked = json.loads(captured["snapshot"]["normalized_payload_json"])
    assert blocked["blocked_by_compliance"] is True
    assert blocked["headline"] == "股價上看 3000 元"


def test_forward_view_is_scanned_by_the_core_compliance_gate(monkeypatch):
    brief = _valid_brief()
    brief["forward_views"]["short_1_5"]["reason"] = "預期上漲 8% 以上。"

    response, _ = _run_brief(monkeypatch, brief)

    assert response.status == "unavailable"
    assert any(
        item.startswith("前瞻報酬-hard:")
        for item in response.verification.compliance_violations
    )


def test_price_in_a_risk_trigger_is_a_hard_violation(monkeypatch):
    """實測模型會寫「跌破 2400 元關鍵支撐」；數字在前，文字型規則的語序抓不到。"""
    brief = _valid_brief()
    brief["risks"][0]["trigger"] = "股價跌破 2400 元關鍵支撐"

    response, _ = _run_brief(monkeypatch, brief)

    assert response.verification.removed_item_ids == ["rk_01"]
    assert any(
        item.startswith("前瞻價位-hard:")
        for item in response.verification.compliance_violations
    )


def test_price_in_a_forward_view_invalidation_blocks_the_whole_brief(monkeypatch):
    brief = _valid_brief()
    brief["forward_views"]["short_1_5"]["invalidation"] = "跌破 2380 元近期整理低點"

    response, _ = _run_brief(monkeypatch, brief)

    assert response.status == "unavailable"
    assert any(
        item.startswith("前瞻價位-hard:")
        for item in response.verification.compliance_violations
    )


def test_non_price_forward_conditions_are_allowed(monkeypatch):
    brief = _valid_brief()
    brief["risks"][0]["trigger"] = "外資單日賣超再度超過一萬張，且成交量放大三成"
    brief["forward_views"]["short_1_5"]["invalidation"] = "跌破近期整理區間的下緣"

    response, _ = _run_brief(monkeypatch, brief)

    assert response.status == "verified"
    assert response.verification.compliance_violations == []


def test_soft_compliance_hit_marks_limited_without_removing_item(monkeypatch):
    brief = _valid_brief()
    brief["current_status"][0]["text"] = "消息有助於吸引技術性買盤進場。"

    response, _ = _run_brief(monkeypatch, brief)

    assert response.status == "limited"
    assert [item.id for item in response.brief.current_status] == ["cs_01", "cs_02"]
    assert response.verification.compliance_violations == []
    assert any(
        item.startswith("操作詞-descriptive-soft:")
        for item in response.verification.soft_compliance_hits
    )


def test_truncated_output_is_unavailable_and_creates_fallback_snapshot(monkeypatch):
    response, captured = _run_brief(
        monkeypatch,
        {},
        meta={"finish_reason": "length", "completion_tokens": 8192, "truncated": True},
    )

    assert response.status == "unavailable"
    assert response.brief is None
    assert "模型輸出無法解析，本次無法提供簡報。" in response.limitations
    snapshot = captured["snapshot"]
    assert snapshot["is_fallback"] is True
    assert snapshot["prompt_version"] == TEXT_BRIEF_PROMPT_VERSION
    config = json.loads(snapshot["config_json"])
    assert config["schema_version"] == "text-first-v2"


def test_missing_guidance_news_is_reported_as_a_limitation(monkeypatch):
    response, _ = _run_brief(monkeypatch, _valid_brief())
    assert TEXT_BRIEF_NO_GUIDANCE_LIMITATION in response.limitations

    guidance_bundle = _bundle(
        news=[
            {
                "id": "nw_01",
                "field": "news",
                "date": "2026-07-09",
                "kind": "guidance",
                "title": "法說會展望",
                "value": "管理層對下一季展望轉趨保守。",
            }
        ]
    )
    response, _ = _run_brief(monkeypatch, _valid_brief(), bundle=guidance_bundle)
    assert TEXT_BRIEF_NO_GUIDANCE_LIMITATION not in response.limitations


def test_cache_hit_returns_stored_response_without_calling_the_model(monkeypatch):
    stored = StockBehaviorTextBriefResponse(
        symbol="2330",
        as_of_date=AS_OF.isoformat(),
        generated_by="test-model",
        status="verified",
        brief=StockBehaviorTextBrief.model_validate(_valid_brief()),
        evidence_catalog=[],
        verification={},
        disclaimer={"version": "v1", "text": TEXT_BRIEF_DISCLAIMER_TEXT},
        limitations=[],
    )
    row = SimpleNamespace(
        public_projection_json=json.dumps(stored.model_dump(mode="json"))
    )

    response, captured = _run_brief(monkeypatch, _valid_brief(), cached_row=row)

    assert response.cached is True
    assert response.status == "verified"
    assert "task_packet" not in captured
    assert "snapshot" not in captured


def test_force_refresh_bypasses_the_cache(monkeypatch):
    row = SimpleNamespace(public_projection_json=json.dumps({"broken": True}))

    response, captured = _run_brief(
        monkeypatch, _valid_brief(), cached_row=row, force_refresh=True
    )

    assert response.cached is False
    assert "task_packet" in captured


def test_unparsable_cached_row_falls_back_to_a_fresh_run(monkeypatch):
    row = SimpleNamespace(public_projection_json="not json")

    response, captured = _run_brief(monkeypatch, _valid_brief(), cached_row=row)

    assert response.cached is False
    assert "task_packet" in captured


def test_upstream_model_failure_becomes_a_503_instead_of_an_unhandled_500(monkeypatch):
    """NIM 對長請求會回 504（實測 deepseek-v4-pro 在 14 分鐘後 504）。

    openai.InternalServerError 不是 RuntimeError，沒接住會變成未處理的 500。
    """

    class ExplodingLlm:
        model_name = "test-model"

        async def generate_text_brief_from_evidence(self, *, task_packet):
            raise RuntimeError.__base__("Error code: 504")  # 任意非 RuntimeError 例外

    service = StockBehaviorOrchestrator(
        db=SimpleNamespace(rollback=lambda: None), settings=_settings()
    )
    service._llm = ExplodingLlm()

    async def fake_news(*, symbol, as_of_date):
        return [], False

    service._fetch_text_brief_news = fake_news
    monkeypatch.setattr(
        orchestrator_module, "build_evidence_bundle", lambda db, **kwargs: _bundle()
    )
    monkeypatch.setattr(
        orchestrator_module, "get_cached_snapshot", lambda db, **kwargs: None
    )

    with pytest.raises(UpstreamModelError) as excinfo:
        asyncio.run(
            service.generate_text_brief(
                StockBehaviorTextBriefRequest(symbol="2330", as_of_date=AS_OF)
            )
        )
    assert excinfo.value.to_detail()["code"] == "upstream_model_error"

    app = FastAPI()
    app.include_router(router_module.router)

    class FailingOrchestrator:
        async def generate_text_brief(self, req):
            raise UpstreamModelError("模型服務暫時無法回應，請稍後重試")

    monkeypatch.setattr(
        router_module, "_build_orchestrator", lambda db: FailingOrchestrator()
    )

    async def fake_db():
        return SimpleNamespace()

    app.dependency_overrides[get_db] = fake_db

    async def post_text_brief():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as client:
            return await client.post(
                "/analyze/stock-behavior/text-brief", json={"symbol": "2330"}
            )

    response = asyncio.run(post_text_brief())
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "upstream_model_error"


def test_stale_news_outside_the_lookback_window_is_dropped():
    sources = [
        {"id": "a", "timestamp": "2024-06-19T09:00:00"},
        {"id": "b", "timestamp": "2026-07-01T09:00:00"},
        {"id": "c", "timestamp": ""},
    ]

    kept = StockBehaviorOrchestrator._drop_stale_news(sources, as_of_date=AS_OF)

    assert [item["id"] for item in kept] == ["b"]


@pytest.mark.parametrize(
    ("text", "severity"),
    [
        ("吸引技術性買盤進場", "soft"),
        ("可能引發技術性停損賣壓", "soft"),
        ("呈現單日承接、波段減碼的拉扯格局", "soft"),
        ("未來三週有機會上漲 5%", "soft"),
        ("三週內還有 5% 的空間", "soft"),
        ("預期上看 5%", "hard"),
        ("建議逢低進場", "hard"),
        ("應設停損以控制風險", "hard"),
        ("可考慮加碼持股", "hard"),
    ],
)
def test_compliance_false_positive_regressions(text, severity):
    hits = scan_compliance_hits(text)

    assert any(hit.severity == severity for hit in hits)
    if severity == "soft":
        assert not any(hit.severity == "hard" for hit in hits)


@pytest.mark.parametrize(
    "text",
    [
        "七月十五日上漲 3.07%，成交量放大 78%",
        "二月營收年減 15.6%",
        "毛利率 66.2%、營業利益率 58.1%",
    ],
)
def test_historical_percentages_are_no_longer_flagged(text):
    assert scan_compliance_hits(text) == []


@pytest.mark.parametrize(
    ("text", "rule"),
    [
        ("目標價為 1200 元", "目標價型-hard"),
        ("支撐區落在 100 元", "未來價位型-hard"),
        ("建議持有", "操作指令-hard"),
        ("預期上漲 5%", "前瞻報酬-hard"),
        ("保證獲利", "承諾詞-hard"),
        ("投入三成資金", "資金配置-hard"),
    ],
)
def test_each_hard_compliance_rule_is_classified(text, rule):
    assert any(
        hit.rule == rule and hit.severity == "hard"
        for hit in scan_compliance_hits(text)
    )
    assert scan_compliance(text)


def test_text_brief_route_returns_v2_envelope(monkeypatch):
    expected = StockBehaviorTextBriefResponse(
        symbol="2330",
        as_of_date=AS_OF.isoformat(),
        generated_by="mock",
        status="verified",
        brief=StockBehaviorTextBrief.model_validate(_valid_brief()),
        evidence_catalog=[],
        verification={},
        disclaimer={"version": "v1", "text": TEXT_BRIEF_DISCLAIMER_TEXT},
        limitations=[],
    )

    class FakeOrchestrator:
        async def generate_text_brief(self, req):
            assert isinstance(req, StockBehaviorTextBriefRequest)
            return expected

    monkeypatch.setattr(
        router_module, "_build_orchestrator", lambda db: FakeOrchestrator()
    )
    app = FastAPI()
    app.include_router(router_module.router)

    async def fake_db():
        return SimpleNamespace()

    app.dependency_overrides[get_db] = fake_db

    async def post_text_brief():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as client:
            return await client.post(
                "/analyze/stock-behavior/text-brief",
                json={"symbol": "2330", "as_of_date": AS_OF.isoformat()},
            )

    response = asyncio.run(post_text_brief())
    body = response.json()

    assert response.status_code == 200
    assert body["schema_version"] == "text-first-v2"
    assert body["brief"]["forward_views"]["short_1_5"]["stance"] == "neutral"
    assert body["brief"]["positive_factors"]
    assert body["brief"]["negative_factors"]
    assert "thesis" not in body["brief"]
    assert "events" not in body["brief"]


def test_llm_uses_multi_turn_few_shot_messages(monkeypatch):
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
    examples = [
        {
            "scenario": "第一例",
            "input_payload": {"task": {"symbol": "2317"}},
            "output_brief": {"headline": "第一例輸出"},
        },
        {
            "scenario": "第二例",
            "input_payload": {"task": {"symbol": "2454"}},
            "output_brief": {"headline": "第二例輸出"},
        },
    ]
    monkeypatch.setattr(llm_module.few_shot_examples, "FEW_SHOT_EXAMPLES", examples)

    parsed, raw_text, meta = asyncio.run(
        StockBehaviorLlmService(
            _settings(NIM_API_KEY="token")
        ).generate_text_brief_from_evidence(task_packet={"task": {"symbol": "2330"}})
    )

    roles = [role for role, _ in captured["messages"]]
    assert roles == ["system", "human", "ai", "human", "ai", "human"]
    system_prompt = captured["messages"][0][1]
    assert system_prompt.startswith(TEXT_BRIEF_SYSTEM_PROMPT.rstrip()[:40])
    assert "<field_glossary>" in system_prompt
    assert "<output_schema>" in system_prompt
    assert '"2317"' in captured["messages"][1][1]
    assert captured["messages"][2][1] == '{"headline": "第一例輸出"}'
    assert '"2330"' in captured["messages"][-1][1]
    assert parsed == {"headline": "ok"}
    assert meta["truncated"] is False


def test_system_prompt_keeps_the_fact_consistency_rules():
    prompt = build_text_brief_system_prompt()

    assert TEXT_BRIEF_PROMPT_VERSION == "v5-timeline-01"
    assert "此日期之後的任何資訊視為不存在" in prompt
    assert "不得改寫成其他公司" in prompt
    assert "不得因為當天上漲就說量能放大" in prompt
    assert "不得把單日買超講成趨勢翻多" in prompt
    assert "不得寫出任何未來的價格數字" in prompt
    assert "不要寫 KD、MACD、RSI" in prompt


def test_bundled_few_shot_examples_satisfy_every_output_rule():
    """few-shot 是模型唯一的風格範本，本身違規就會被學起來。"""
    assert len(few_shot_examples.FEW_SHOT_EXAMPLES) == 3

    for example in few_shot_examples.FEW_SHOT_EXAMPLES:
        payload = example["input_payload"]
        brief = example["output_brief"]
        label = example["scenario"]

        StockBehaviorTextBrief.model_validate(brief)

        bundle = EvidenceBundle(
            symbol=payload["task"]["symbol"],
            as_of_date=date.fromisoformat(payload["task"]["as_of_date"]),
            daily_timeline=payload["daily_timeline"],
            long_term_anchor=payload["long_term_anchor"],
            fundamental=payload["fundamental"],
            news=payload["news"],
        )

        referenced = StockBehaviorOrchestrator._text_brief_referenced_ids(brief)
        assert not referenced - bundle.evidence_ids(), f"{label}: 引用了不存在的證據 id"

        timeline_ids = {row["id"] for row in payload["daily_timeline"]}
        assert all(
            item["ref"] in timeline_ids for item in brief["key_days"]
        ), f"{label}: key_days.ref 不在時間軸內"

        # 照真實流程先回填再對帳；範例的數字欄位本來就留空給後端填。
        backfilled = deepcopy(brief)
        discarded: list[str] = []
        future_dated: list[str] = []
        StockBehaviorOrchestrator._backfill_key_days(
            backfilled,
            bundle=bundle,
            as_of_date=bundle.as_of_date,
            discarded=discarded,
            future_dated=future_dated,
        )
        assert not discarded and not future_dated, f"{label}: key_days 回填失敗"
        assert not StockBehaviorOrchestrator._check_key_day_numbers(
            backfilled, known_percentages=bundle.known_percentages()
        ), f"{label}: key_days 出現對不上 payload 的百分比"

        assert not StockBehaviorOrchestrator._undercount_sections(
            brief
        ), f"{label}: 區塊數量低於目標"

        # 走完整的 gate（含欄位級的前瞻價位規則），不是只跑文字型 regex
        hits = StockBehaviorOrchestrator._scan_text_brief_compliance(brief)
        assert not hits, f"{label}: 命中法遵規則 {hits}"

        assert not any(
            item.get("move_pct") is not None or item.get("volume_ratio") is not None
            for item in brief["key_days"]
        ), f"{label}: key_days 不該自帶數字欄位，那是後端回填的"

        assert not StockBehaviorOrchestrator._collect_jargon_hits(
            brief
        ), f"{label}: 出現技術指標代號，模型會照抄"
