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


def hard(item, bundle):
    """Hard findings from both the grounding and the compliance scan, as the gate sees them."""
    issues = [issue for issue in gate._grounding_issues(dict(item), bundle) if not issue.startswith("未核實")]
    hits = gate._scan_text_brief_compliance(dict(item), prices=gate._historical_prices(bundle))
    return issues + [hit.rule for hit in hits if hit.severity == "hard"]


@pytest.mark.parametrize("text", [
    "收盤低於季線 4.1%，短線偏弱。",
    "股價較季線下降 4.1%，短線偏弱。",
    "10/1 成交量低於五日均量 20%，追價意願不足。",
])
def test_negative_deviation_written_as_magnitude_is_supported(bundle, text):
    assert not hard({"stance": "mildly_bearish", "reason": text, "evidence_ids": ["d_40", "lt_04"]}, bundle)


@pytest.mark.parametrize("text", [
    "收盤低於季線 9.0%，短線偏弱。",
    "收盤相對季線 +4.1%，短線偏強。",
    "成交量高於五日均量 20%。",
])
def test_wrong_magnitude_or_explicit_sign_remains_blocked(bundle, text):
    assert hard({"stance": "mildly_bearish", "reason": text, "evidence_ids": ["d_40", "lt_04"]}, bundle)


@pytest.mark.parametrize("field", ["trigger", "invalidation"])
@pytest.mark.parametrize("text", [
    "若單日跌幅超過 5% 且外資續賣。",
    "若股價再下跌 3%，弱勢延續。",
    "一旦營收年增率降到 10% 以下。",
])
def test_conditional_percentage_threshold_is_an_unverified_assumption(bundle, field, text):
    item = {field: text, "evidence_ids": ["d_40"]}
    assert not hard(item, bundle)
    assert any(issue.startswith("未核實情境百分比") for issue in gate._grounding_issues(item, bundle))


@pytest.mark.parametrize("field,text", [
    ("trigger", "目前單日跌幅已達 5%。"),
    ("reason", "若單日跌幅超過 5%，短線轉弱。"),
    ("description", "若單日跌幅超過 5%，籌碼轉弱。"),
])
def test_percentage_outside_a_condition_still_needs_evidence(bundle, field, text):
    assert hard({field: text, "evidence_ids": ["d_40"]}, bundle)


@pytest.mark.parametrize("text", [
    "情境假設：若收盤跌破 950 元，代表弱勢延續。",
    "情境假設：若收盤價站回 1,050 元，弱勢解除。",
])
def test_scenario_may_condition_on_a_future_close(bundle, text):
    assert not hard({"trigger": text, "evidence_ids": ["d_40"]}, bundle)


@pytest.mark.parametrize("text", [
    "情境假設：以收盤 950 元為門檻。",
    "情境假設：若跌破實際收盤 950 元。",
    "若收盤跌破 950 元。",
])
def test_scenario_cannot_claim_an_unobserved_close(bundle, text):
    assert hard({"trigger": text, "evidence_ids": ["d_40"]}, bundle)


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


@pytest.mark.parametrize("text", ["股價上漲 3%。", "外資買超 1.2 萬張。", "外資買超 12,345 張。"])
def test_values_rounded_to_their_written_precision_are_supported(flows, text):
    assert not hard({"text": text, "evidence_ids": ["d_41"]}, flows)


@pytest.mark.parametrize("text", ["股價上漲 4%。", "股價上漲 3.0%。", "外資買超 2 萬張。", "外資買超 1.3 萬張。"])
def test_values_outside_their_written_precision_remain_blocked(flows, text):
    assert hard({"text": text, "evidence_ids": ["d_41"]}, flows)


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
