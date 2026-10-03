from copy import deepcopy
from datetime import date

import pytest

from app.features.analysis.evidence import EvidenceBundle
from app.features.analysis.validation import (
    _apply_text_brief_compliance_gate,
    _grounding_issues,
)
from test_analysis_service import brief_payload


def hard_issues(item, bundle):
    return [issue for issue in _grounding_issues(item, bundle) if not issue.startswith("未核實")]


@pytest.fixture
def bundle():
    return EvidenceBundle(
        symbol="1216", as_of_date=date(2026, 10, 3),
        daily_timeline=[{"id": "d_40", "date": "2026-10-01", "close": 73.9,
                         "vs_ma20_pct": -1.7}],
        long_term_anchor=[{"id": "lt_02", "field": "low_1y", "value": 68.7},
                          {"id": "lt_04", "field": "vs_ma60_pct", "value": -3.2}],
        fundamental=[{"id": "fd_08", "field": "dividend_yield", "value": 4.06}],
        news=[{"id": "nw_18", "field": "news", "value":
               "上半年稅後淨利145.50億元，較去年同期成長36.4%，每股盈餘為2.56元"}],
    )


@pytest.mark.parametrize("text", [
    "殖利率 4.06% 提供部分支撐。",
    "有 4.06% 的現金殖利率提供部分支撐。",
    "有 4.06%殖利率提供部分支撐。",
])
def test_dividend_metric_on_either_side_of_number(bundle, text):
    item = {"stance": "neutral", "reason": text, "evidence_ids": ["fd_08"]}
    assert not hard_issues(item, bundle)
    item["reason"] = text.replace("4.06", "9.06")
    assert hard_issues(item, bundle)
    item["reason"] = text
    item["evidence_ids"] = ["lt_02"]
    assert hard_issues(item, bundle)


def test_percentage_label_does_not_leak_across_clauses(bundle):
    item = {"text": "月線乖離 -1.7%，vs_ma60_pct 為 -3.2%。",
            "evidence_ids": ["d_40", "lt_04"]}
    assert not hard_issues(item, bundle)
    item["text"] = "月線乖離 -3.2%，vs_ma60_pct 為 -1.7%。"
    assert hard_issues(item, bundle)


def test_unrecognized_percentage_is_unverified_not_a_proven_contradiction(bundle):
    issues = _grounding_issues({"text": "此指標為 12.3%。", "evidence_ids": ["fd_08"]}, bundle)
    assert issues and all(issue.startswith("未核實") for issue in issues)


def test_news_eps_uses_matching_cited_quote_without_claiming_period_verification(bundle):
    quote = bundle.news[0]["value"]
    item = {"id": "pos_01", "text": "上半年每股盈餘 2.56 元。", "evidence_ids": ["nw_18"],
            "news_support": [{"evidence_id": "nw_18", "quote": quote, "use": "reported_fact"}]}
    issues = _grounding_issues(deepcopy(item), bundle)
    assert issues and all(issue.startswith("未核實") for issue in issues)
    for invalid in [
        {**item, "text": "上半年每股盈餘 9.56 元。"},
        {**item, "evidence_ids": ["fd_08"]},
        {**item, "news_support": [{"evidence_id": "nw_18", "quote": "每股盈餘2.56元（假引文）"}]},
    ]:
        assert hard_issues(invalid, bundle)


def test_production_wording_preserves_swing_view_and_labeled_price_scenario(bundle):
    payload = brief_payload()
    for section in ("key_days", "current_status", "positive_factors", "negative_factors", "risks", "watch_points"):
        for item in payload[section]:
            item["evidence_ids"] = ["d_40"]
    for view in payload["forward_views"].values():
        view["evidence_ids"] = ["d_40"]
    swing = payload["forward_views"]["swing_6_20"]
    swing.update(stance="neutral", reason="股價已接近一年低點附近，且有 4.06% 的現金殖利率提供部分支撐，預計在低檔震盪。",
                 evidence_ids=["lt_02", "fd_08"])
    short = payload["forward_views"]["short_1_5"]
    short["invalidation"] = "成交量突然放大且收盤價站回月線（情境假設：價格 > 74.2 元）"
    removed, hard, soft, blocked = _apply_text_brief_compliance_gate(payload, bundle=bundle, allow_partial_forward_views=True)
    assert not blocked
    assert not hard
    assert "forward_views.swing_6_20" not in removed
    assert "forward_views.short_1_5.invalidation" not in removed
    assert swing["stance"] == "neutral"
    assert any("情境價位" in hit for hit in soft)
