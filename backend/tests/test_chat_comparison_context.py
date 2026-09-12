import json
from datetime import date, timedelta
from math import sqrt

import pytest

from app.db.models.daily_price import DailyPrice
from app.features.chat.comparison_context import collect_comparison_source


START = date(2026, 9, 7)


def add_prices(db, symbol, closes, offset=0):
    db.add_all(DailyPrice(symbol=symbol, date=START + timedelta(days=index + offset), close=close)
               for index, close in enumerate(closes))
    db.flush()


def test_comparison_computes_opposite_returns_and_excludes_outside_period(db_session):
    add_prices(db_session, "2330", [10, 100, 110, 99, 118.8, 1], offset=-1)
    add_prices(db_session, "2317", [200, 100, 90, 99, 79.2, 999], offset=-1)
    source = collect_comparison_source(db_session, ["2330", "2317"], START, START + timedelta(days=3))
    data = json.loads(source.content)
    first, second = data["stocks"]
    assert source.source == "system_comparison" and source.category == "comparison"
    assert source.stock_ids == ["2330", "2317"]
    assert source.stock_id == source.citation_id == source.url == "" and source.score == 1
    assert source.pub_time == "2026-09-10" and "2026-09-10" in source.title
    assert data["common_start_date"] == "2026-09-07" and data["common_end_date"] == "2026-09-10"
    assert data["common_price_samples"] == 4 and data["common_daily_return_samples"] == 3
    assert first["interval_return_pct"] == pytest.approx(18.8)
    assert second["interval_return_pct"] == pytest.approx(-20.8)
    assert first["max_drawdown_pct"] == -10 and second["max_drawdown_pct"] == -20.8
    expected_volatility = sqrt(7 / 300) * sqrt(252) * 100
    assert first["annualized_volatility_pct"] == pytest.approx(expected_volatility)
    assert second["annualized_volatility_pct"] == pytest.approx(expected_volatility)
    assert data["correlations"] == [{"symbols": ["2330", "2317"], "pearson_r": -1.0}]


def test_missing_dates_align_boundaries_and_do_not_become_daily_returns(db_session):
    add_prices(db_session, "2330", [100, 130, 110, 121, 150])
    add_prices(db_session, "2317", [80, None, 88, 96.8], offset=1)
    source = collect_comparison_source(db_session, ["2330", "2317"], START, START + timedelta(days=4))
    data = json.loads(source.content)
    first, second = data["stocks"]
    assert data["common_start_date"] == "2026-09-08" and data["common_end_date"] == "2026-09-11"
    assert data["common_price_samples"] == 3 and data["common_daily_return_samples"] == 1
    assert data["daily_return_start_date"] == "2026-09-10"
    assert data["daily_return_end_date"] == "2026-09-11"
    assert first["interval_return_pct"] == pytest.approx((150 / 130 - 1) * 100)
    assert second["interval_return_pct"] == 21
    assert first["available_price_samples"] == 5 and first["missing_observed_dates"] == 0
    assert second["available_price_samples"] == 3 and second["missing_observed_dates"] == 2
    assert first["annualized_volatility_pct"] is None and second["annualized_volatility_pct"] is None
    assert data["correlations"][0]["pearson_r"] is None
    assert any("missing observed date" in warning for warning in data["limitations"])


def test_missing_stock_remains_visible_and_disallows_unfair_comparison(db_session):
    add_prices(db_session, "2330", [100, 110, 120])
    source = collect_comparison_source(db_session, ["2330", "MISSING"], START, START + timedelta(days=2))
    data = json.loads(source.content)
    first, second = data["stocks"]
    assert source.stock_ids == ["2330", "MISSING"]
    assert first["available_price_samples"] == 3 and second["available_price_samples"] == 0
    assert second["missing_observed_dates"] == 3
    assert data["common_price_samples"] == data["common_daily_return_samples"] == 0
    assert data["common_start_date"] is data["common_end_date"] is None
    assert first["interval_return_pct"] is second["interval_return_pct"] is None
    assert data["correlations"][0]["pearson_r"] is None
    assert any("MISSING" in warning for warning in data["limitations"])


def test_constant_prices_have_zero_volatility_and_undefined_correlation(db_session):
    add_prices(db_session, "2330", [100, 100, 100, 100])
    add_prices(db_session, "2317", [100, 110, 100, 120])
    data = json.loads(collect_comparison_source(db_session, ["2330", "2317"], START,
                                               START + timedelta(days=3)).content)
    first = data["stocks"][0]
    assert first["interval_return_pct"] == first["annualized_volatility_pct"] == first["max_drawdown_pct"] == 0
    assert data["correlations"][0]["pearson_r"] is None


@pytest.mark.parametrize("samples", [1, 2])
def test_too_few_prices_leave_unavailable_metrics_null(db_session, samples):
    add_prices(db_session, "2330", [100, 110][:samples])
    add_prices(db_session, "2317", [100, 90][:samples])
    data = json.loads(collect_comparison_source(db_session, ["2330", "2317"], START,
                                               START + timedelta(days=2)).content)
    assert data["common_price_samples"] == samples and data["common_daily_return_samples"] == samples - 1
    assert all(stock["annualized_volatility_pct"] is None for stock in data["stocks"])
    assert data["correlations"][0]["pearson_r"] is None
    if samples == 1:
        assert all(stock["interval_return_pct"] is stock["max_drawdown_pct"] is None for stock in data["stocks"])
    else:
        assert data["stocks"][0]["interval_return_pct"] == 10
        assert data["stocks"][1]["max_drawdown_pct"] == -10


def test_empty_or_invalid_prices_produce_explicit_missing_evidence(db_session):
    add_prices(db_session, "2330", [None, 0, -1])
    source = collect_comparison_source(db_session, ["2330", "2317"], START, START + timedelta(days=2))
    data = json.loads(source.content)
    assert source.pub_time == "" and len(data["stocks"]) == 2
    assert all(stock["available_price_samples"] == 0 for stock in data["stocks"])
    assert any("No valid prices" in warning for warning in data["limitations"])
    empty = collect_comparison_source(db_session, ["2330", "2317"], START + timedelta(days=3),
                                      START + timedelta(days=4))
    assert json.loads(empty.content)["observed_union_date_count"] == 0


def test_comparison_validates_limits_and_deduplicates_symbols(db_session):
    assert collect_comparison_source(db_session, ["2330", " 2330 ", ""], START, START) is None
    with pytest.raises(ValueError, match="six"):
        collect_comparison_source(db_session, [str(index) for index in range(7)], START, START)
    with pytest.raises(ValueError, match="start_date"):
        collect_comparison_source(db_session, ["2330", "2317"], START + timedelta(days=1), START)
