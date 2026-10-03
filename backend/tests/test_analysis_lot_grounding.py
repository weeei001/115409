from datetime import date

import pytest

from app.features.analysis.evidence import EvidenceBundle
from app.features.analysis.validation import _grounding_issues


@pytest.fixture
def bundle():
    return EvidenceBundle(
        symbol="1216", as_of_date=date(2026, 10, 3),
        daily_timeline=[{
            "id": "d_01", "date": "2026-10-02", "vol_lots": 9000,
            "foreign_net_lots": -1303, "trust_net_lots": 250,
            "dealer_net_lots": -100,
        }],
        chip_summary=[{
            "id": "c_01", "field": "foreign_net_10d_lots", "value": -2000,
        }],
    )


def issues(bundle, text, *, key="reason", refs=None):
    return _grounding_issues({
        "stance": "neutral", key: text,
        "evidence_ids": refs if refs is not None else ["d_01", "c_01"],
    }, bundle)


@pytest.mark.parametrize("text", [
    "成交量 9,000 張，量能仍低。",
    "外資賣超 1,303 張，短線承壓。",
    "投信買超 250 張，自營商賣超 100 張。",
    "近十個交易日外資累計賣超 2,000 張。",
    "外資賣超 1,303 張但成交量 9,000 張。",
])
def test_lots_follow_their_own_metric(bundle, text):
    assert issues(bundle, text) == []


@pytest.mark.parametrize("text", [
    "成交量 1,303 張。",
    "投信買超 9,000 張。",
    "外資買超 1,303 張。",
    "近十日外資累計賣超 1,303 張。",
    "近五日外資累計賣超 1,303 張。",
    "近十日投信買超 250 張。",
])
def test_wrong_metric_sign_or_period_remains_blocked(bundle, text):
    assert any(not issue.startswith("未核實") for issue in issues(bundle, text))


def test_unidentified_lot_subject_is_unverified(bundle):
    result = issues(bundle, "累計 2,000 張。")
    assert result and all(issue.startswith("未核實") for issue in result)


def test_labeled_condition_uses_context_without_claiming_historical_equality(bundle):
    result = issues(bundle, "情境假設：若成交量突破 10,000 張，重新評估。", key="invalidation")
    assert result and all(issue.startswith("未核實") for issue in result)


def test_lot_condition_requires_label_and_corresponding_evidence(bundle):
    for text, refs in [
        ("若成交量突破 10,000 張，重新評估。", ["d_01"]),
        ("情境假設：若成交量突破 10,000 張，重新評估。", ["c_01"]),
    ]:
        result = issues(bundle, text, key="invalidation", refs=refs)
        assert any(not issue.startswith("未核實") for issue in result)


def test_condition_can_reuse_a_cited_observation(bundle):
    assert not issues(bundle, "若成交量低於 9,000 張，重新評估。", key="invalidation")
