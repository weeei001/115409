"""核對公開證據類別與個人資料缺漏，不讓缺漏說明冒充實際資料。"""
import json
from types import SimpleNamespace

import pytest

from app.features.chat.evidence import assess_evidence


def source(category, payload):
    return SimpleNamespace(category=category, content=json.dumps(payload))


@pytest.mark.parametrize("category,payload", [
    ("market_technical", {"columns": ["date", "close"], "rows": [["2026-10-01", 100]]}),
    ("institutional", {"columns": ["date", "foreign_net"], "rows": [["2026-10-01", 500]]}),
    ("fundamental", {"items": [{"field": "eps", "value": 2}], "reported_income": []}),
    ("comparison", {"common_price_samples": 2, "stocks": [{"symbol": "2330", "interval_return_pct": 5}]}),
])
def test_each_supported_market_source_satisfies_market_requirement(category, payload):
    result = assess_evidence({"market"}, [source(category, payload)])
    assert result == {"requested": ["market"], "available": ["market"], "missing": [],
                      "blocked": False, "status": "ready"}


@pytest.mark.parametrize("category", ["availability", "data_availability", "market_availability", "market_unknown"])
def test_availability_or_unknown_category_cannot_satisfy_market_requirement(category):
    result = assess_evidence({"market", "news"}, [
        source(category, {"status": "unavailable", "limitation": "No observations"}),
        source("news", {"text": "Company reported earnings"}),
    ])
    assert result["available"] == ["news"]
    assert result["missing"] == ["market"]
    assert result["status"] == "partial" and result["blocked"] is False


@pytest.mark.parametrize("scope,payload", [
    ("portfolio", {"favorites": []}),
    ("favorites", {"portfolio": {"initialized": False, "positions": []}}),
    ("portfolio", {"portfolio": []}),
    ("favorites", {"favorites": {}}),
    ("portfolio", []),
    ("favorites", None),
])
def test_other_scope_or_malformed_personal_container_blocks_required_scope(scope, payload):
    result = assess_evidence({scope}, [source("personal", payload), source("news", "Account allocation article")])
    assert result["missing"] == [scope]
    assert result["blocked"] is True and result["status"] == "blocked"


def test_invalid_personal_json_does_not_replace_missing_account_with_news():
    sources = [SimpleNamespace(category="personal", content="invalid JSON"), source("news", "Public news")]
    result = assess_evidence({"portfolio", "favorites", "news"}, sources)
    assert result["available"] == ["news"]
    assert result["missing"] == ["favorites", "portfolio"]
    assert result["blocked"] is True


def test_empty_favorites_and_uninitialized_account_are_available_not_missing():
    sources = [source("personal", {
        "favorites": [], "portfolio": {"initialized": False, "positions": [], "available_cash": 0},
    })]
    result = assess_evidence({"portfolio", "favorites", "news"}, sources)
    assert result["available"] == ["favorites", "portfolio"]
    assert result["missing"] == ["news"]
    assert result["blocked"] is False and result["status"] == "partial"


def test_no_sources_blocks_private_requirements_but_marks_public_requirements_partial():
    assert assess_evidence({"portfolio"}, [])["status"] == "blocked"
    assert assess_evidence({"market", "news"}, [])["status"] == "partial"
