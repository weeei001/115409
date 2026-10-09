"""Brief items that are supported by their citations must not be removed by the gate.

Each accepted case was rejected before and left 「情境風險」 or the 1–5 day view as
「本節沒有通過檢查的依據」／「內容未通過檢查」; each rejected case keeps a guard.
"""
from datetime import date

import pytest

from app.features.analysis import validation as gate
from app.features.analysis.compliance import scan_compliance_hits
from app.features.analysis.evidence import EvidenceBundle
from test_analysis_service import brief_payload


@pytest.fixture
def bundle():
    return EvidenceBundle(
        symbol="2330", as_of_date=date(2026, 10, 3),
        daily_timeline=[{"id": "d_40", "date": "2026-10-01", "close": 1000.0, "chg_pct": -1.0,
                         "vol_vs_ma5_pct": -20.0, "vs_ma20_pct": -2.1}],
        long_term_anchor=[{"id": "lt_02", "field": "low_1y", "date": "2025-11-20", "value": 780.0},
                          {"id": "lt_04", "field": "vs_ma60_pct", "date": "2026-10-01", "value": -4.1}],
    )


@pytest.mark.parametrize("text", [
    "外資賣超不必然代表基本面轉差。",
    "法人賣超並非必然反映營運變化。",
    "股價下跌時融資戶可能面臨保證金追繳壓力。",
    "法人相應賣出，籌碼偏空。",
    "需求效應減弱後，外資持續賣出。",
])
def test_hedges_and_trading_vocabulary_are_not_promises_or_instructions(text):
    assert not [hit for hit in scan_compliance_hits(text) if hit.severity == "hard"]


@pytest.mark.parametrize("text", ["必然上漲。", "保證上漲。", "應賣出持股。", "建議停損。"])
def test_promises_and_instructions_remain_blocked(text):
    assert any(hit.severity == "hard" for hit in scan_compliance_hits(text))


@pytest.mark.parametrize("text", [
    "台積電宣布投入千億資金興建新廠。",
    "本簡報不提供目標價或買賣建議。",
    "本分析未涉及買點與目標價。",
    "外資可說是大舉買進，投信則站在賣方。",
    "公司提供履約保證，相關負債已入帳。",
    "股價上攻至年線附近。",
    "股價跌破季線後一路下殺。",
])
def test_company_actions_negated_scope_and_past_moves_are_not_advice(text):
    assert not [hit for hit in scan_compliance_hits(text) if hit.severity == "hard"]


@pytest.mark.parametrize("text", [
    "建議投入 30% 資金。", "可配置部分資金布局。", "配置全部資金。", "宜全押。",
    "可進一步上攻。", "有機會進一步下探。",
    "不提供目標價，但上看 1,200 元。", "保證獲利。",
])
def test_reader_advice_forward_moves_and_targets_remain_blocked(text):
    assert any(hit.severity == "hard" for hit in scan_compliance_hits(text))


def test_named_speaker_view_is_a_report_only_when_the_item_cites_news():
    def rules(text, refs):
        return [hit.rule for hit in gate._scan_text_brief_compliance({"text": text, "evidence_ids": refs})]

    assert rules("報導指出法人看好 AI 需求延續。", ["nw_01"]) == ["投資觀點-attributed-soft"]
    # Without cited news, or with a vague subject, the view is still the brief's own.
    assert "投資觀點-hard" in rules("報導指出法人看好 AI 需求延續。", ["d_40"])
    assert "投資觀點-hard" in rules("市場看好 AI 需求延續。", ["nw_01"])


@pytest.fixture
def flows():
    return EvidenceBundle(symbol="2330", as_of_date=date(2026, 10, 3), daily_timeline=[
        {"id": "d_41", "date": "2026-10-02", "close": 1085.0, "chg_pct": 3.33, "foreign_net_lots": 12345}])


def _gate(payload, bundle):
    for section in ("key_days", "current_status", "positive_factors", "negative_factors", "watch_points"):
        for item in payload[section]:
            item["evidence_ids"] = ["d_40"]
    for view in payload["forward_views"].values():
        view["evidence_ids"] = ["d_40"]
    return gate._apply_text_brief_compliance_gate(payload, bundle=bundle, allow_partial_forward_views=True)


def test_invalid_trigger_keeps_the_supported_risk(bundle):
    payload = brief_payload()
    payload["risks"] = [{"id": "rk_01", "risk_type": "籌碼", "description": "外資持續賣超，籌碼偏弱。",
                         "trigger": "若收盤跌破 950 元。", "evidence_ids": ["d_40"]}]
    removed, hard_hits, _, blocked = _gate(payload, bundle)
    assert not blocked and hard_hits
    assert removed == ["rk_01.trigger"]
    assert payload["risks"][0]["description"] == "外資持續賣超，籌碼偏弱。"
    assert payload["risks"][0]["trigger"] == gate.TEXT_BRIEF_MISSING_TRIGGER


def test_invalid_risk_description_still_removes_the_risk(bundle):
    payload = brief_payload()
    payload["risks"] = [{"id": "rk_01", "risk_type": "籌碼", "description": "外資賣超，建議停損。",
                         "trigger": "若外資續賣。", "evidence_ids": ["d_40"]}]
    removed, _, _, _ = _gate(payload, bundle)
    assert removed == ["rk_01"] and payload["risks"] == []
