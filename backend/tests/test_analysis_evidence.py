from datetime import date, datetime
from types import SimpleNamespace

import pytest

from app.features.analysis.evidence import (
    EvidenceBundle,
    _eps_items,
    _financial_is_published,
    _IdGen,
    _revenue_is_published,
    _revenue_items,
    build_chip_summary,
    build_daily_timeline,
    build_news_items,
)
from app.clients.rag import _is_on_or_before_as_of

def _price(day: str, close, volume=1_000_000):
    return SimpleNamespace(
        date=date.fromisoformat(day), close=close, volume_shares=volume
    )

def _tech(day: str, **fields):
    defaults = {
        "volume_ma5": 1_000_000,
        "ma20": None,
        "rsi5": None,
        "kd_k9": None,
        "macd_hist": None,
    }
    defaults.update(fields)
    return SimpleNamespace(date=date.fromisoformat(day), **defaults)

def _statement(day: str, item_type: str, value):
    return SimpleNamespace(date=date.fromisoformat(day), item_type=item_type, value=value)

def _revenue(day: str, year: int, month: int, value):
    return SimpleNamespace(
        date=date.fromisoformat(day), revenue_year=year, revenue_month=month, revenue=value
    )

@pytest.mark.parametrize(
    ("period_end", "as_of", "published"),
    [
        ("2026-03-31", "2026-05-19", False),
        ("2026-03-31", "2026-05-20", True),
        ("2025-12-31", "2026-04-04", False),
        ("2025-12-31", "2026-04-05", True),
    ],
)
def test_financial_publish_lag_boundaries(period_end, as_of, published):
    assert (
        _financial_is_published(date.fromisoformat(period_end), date.fromisoformat(as_of))
        is published
    )

@pytest.mark.parametrize(
    ("row_date", "as_of", "published"),
    [
        ("2026-07-01", "2026-07-09", False),
        ("2026-07-01", "2026-07-10", True),
    ],
)
def test_revenue_publish_deadline_boundaries(row_date, as_of, published):
    assert (
        _revenue_is_published(_revenue(row_date, 2026, 6, 100), date.fromisoformat(as_of))
        is published
    )

def test_eps_growth_is_skipped_when_the_previous_quarter_is_missing():
    rows = [
        _statement("2025-06-30", "EPS", 10.0),
        _statement("2025-12-31", "EPS", 12.0),
    ]
    items = _eps_items(rows, date(2026, 6, 30), _IdGen("fd"))

    assert items[0]["value"] == 12.0
    assert "qoq_pct" not in items[0]
    assert "yoy_pct" not in items[0]

def test_eps_growth_is_computed_for_adjacent_quarters():
    rows = [
        _statement("2025-03-31", "EPS", 8.0),
        _statement("2025-06-30", "EPS", 10.0),
        _statement("2025-09-30", "EPS", 11.0),
        _statement("2025-12-31", "EPS", 12.0),
        _statement("2026-03-31", "EPS", 16.0),
    ]
    items = _eps_items(rows, date(2026, 9, 30), _IdGen("fd"))

    assert items[0]["period"] == "2026Q1"
    assert items[0]["qoq_pct"] == pytest.approx(33.3, abs=0.1)
    assert items[0]["yoy_pct"] == pytest.approx(100.0)

def test_negative_base_periods_do_not_produce_growth_percentages():
    rows = [
        _statement("2025-09-30", "EPS", -0.63),
        _statement("2025-12-31", "EPS", 8.41),
    ]
    items = _eps_items(rows, date(2026, 6, 30), _IdGen("fd"))

    assert items[0]["value"] == 8.41
    assert "qoq_pct" not in items[0]

def test_revenue_streak_stops_at_a_missing_month():
    rows = [
        _revenue("2025-02-01", 2025, 1, 100),
        _revenue("2026-02-01", 2026, 1, 150),
        _revenue("2025-04-01", 2025, 3, 100),
        _revenue("2026-04-01", 2026, 3, 150),
    ]
    items = _revenue_items(rows, date(2026, 6, 30), _IdGen("fd"))

    assert items[0]["period"] == "2026-03"
    assert "mom_pct" not in items[0]
    streak = [item for item in items if item["field"] == "revenue_yoy_positive_streak"]
    assert streak[0]["value"] == 1

def test_timeline_merges_sources_and_computes_derived_fields():
    price_rows = [
        _price("2026-07-09", 100.0, volume=1_000_000),
        _price("2026-07-10", 103.0, volume=2_000_000),
    ]
    technical_rows = [_tech("2026-07-10", volume_ma5=1_000_000, ma20=100.0)]
    chip_rows = [
        SimpleNamespace(
            date=date(2026, 7, 10),
            foreign_net=12_345_000,
            investment_trust_net=None,
            dealer_net=-1_000,
        )
    ]
    news = [{"id": "nw_01", "date": "2026-07-10"}]

    timeline, missing = build_daily_timeline(
        price_rows=price_rows,
        chip_rows=chip_rows,
        technical_rows=technical_rows,
        news_items=news,
        trading_days=2,
    )

    latest = timeline[-1]
    assert latest["chg_pct"] == pytest.approx(3.0)
    assert latest["vol_lots"] == 2000
    assert latest["vol_vs_ma5_pct"] == pytest.approx(100.0)
    assert latest["vs_ma20_pct"] == pytest.approx(3.0)
    assert latest["foreign_net_lots"] == 12345
    assert latest["news"] == ["nw_01"]
    assert "trust_net_lots" not in latest
    assert "交易日不足（僅 2 個交易日）" not in missing

def _timeline_rows(foreign_net_lots: list[int | None]) -> list[dict]:
    rows = []
    for offset, lots in enumerate(foreign_net_lots):
        row = {"id": f"d_{offset + 1:02d}", "date": f"2026-07-{offset + 1:02d}"}
        if lots is not None:
            row["foreign_net_lots"] = lots
        rows.append(row)
    return rows

def test_chip_summary_accumulates_the_last_ten_trading_days():
    timeline = _timeline_rows([-5000] * 9 + [1000])

    items, missing = build_chip_summary(timeline=timeline)

    assert missing == []
    calculation = items[0].pop("calculation")
    assert calculation["unit"] == "張"
    assert len(calculation["inputs"]) == 10
    assert sum(entry["value"] for entry in calculation["inputs"]) == items[0]["value"]
    assert [entry["date"] for entry in calculation["inputs"]] == [row["date"] for row in timeline]
    assert items == [
        {
            "id": "ch_01",
            "field": "foreign_net_10d_lots",
            "date": "2026-07-10",
            "value": -44000,
        }
    ]

def test_chip_summary_only_sums_the_most_recent_ten_days():
    timeline = _timeline_rows([999_999] * 3 + [100] * 10)

    items, _ = build_chip_summary(timeline=timeline)

    assert items[0]["value"] == 1000
    assert items[0]["date"] == "2026-07-13"

@pytest.mark.parametrize(
    "foreign_net_lots",
    [
        [-5000] * 9,
        [-5000] * 4 + [None] + [-5000] * 5,
    ],
)
def test_chip_summary_is_reported_missing_instead_of_undercounted(foreign_net_lots):
    items, missing = build_chip_summary(timeline=_timeline_rows(foreign_net_lots))

    assert items == []
    assert missing == ["外資近 10 個交易日累計買賣超"]

def test_known_percentages_only_collects_percentage_fields():
    bundle = EvidenceBundle(
        symbol="2330",
        as_of_date=date(2026, 7, 13),
        daily_timeline=[{"id": "d_01", "date": "2026-07-13", "chg_pct": -2.03, "rsi5": 50.2}],
        fundamental=[
            {"id": "fd_01", "field": "per", "value": 32.8, "pct_rank_1y": 91},
            {"id": "fd_02", "field": "gross_margin_pct", "value": 66.2},
        ],
    )

    values = bundle.known_percentages()

    assert -2.03 in values and 2.03 not in values  # Preserve direction.
    assert 91 in values  # 百分位
    assert 66.2 in values  # 欄位名以 _pct 結尾
    assert 32.8 not in values  # 本益比不是百分比
    assert 50.2 not in values  # 指標數值不是百分比

def test_news_summary_keeps_the_full_rag_text_when_no_limit_is_set():
    long_summary = "集中市場加權指數上漲946.67點。" * 8 + "台積電(2330-TW) 上漲 3.32%。"
    items = build_news_items(
        [{"title": "盤中速報", "summary": long_summary, "timestamp": "2026-07-01T11:29:32"}],
        summary_chars=None,
    )

    assert items[0]["value"] == long_summary
    assert "台積電" in items[0]["value"]
    assert not items[0]["value"].endswith("…")

def test_news_summary_preserves_exact_passage_whitespace():
    items = build_news_items(
        [{"title": "速報", "summary": "第一段\n\n第二段   第三段", "timestamp": "2026-07-01T11:29:32"}],
        summary_chars=None,
    )

    assert items[0]["value"] == "第一段\n\n第二段   第三段"

def test_news_summary_is_truncated_and_kind_defaults_to_general():
    items = build_news_items(
        [
            {"title": "標題", "summary": "內容" * 100, "timestamp": "2026-07-13T09:00:00"},
            {"title": "展望", "summary": "法說會", "timestamp": "2026-07-12T09:00:00", "kind": "guidance"},
            {"title": "", "summary": "沒有標題的要丟掉", "timestamp": "2026-07-11T09:00:00"},
        ],
        summary_chars=20,
    )

    assert [item["id"] for item in items] == ["nw_01", "nw_02"]
    assert items[0]["kind"] == "general"
    assert items[0]["value"].endswith("…")
    assert len(items[0]["value"]) == 21
    assert items[1]["kind"] == "guidance"

def test_same_day_news_with_subsecond_timestamp_is_kept():
    assert _is_on_or_before_as_of(
        datetime(2026, 7, 13, 23, 59, 59, 500000), date(2026, 7, 13)
    )
    assert not _is_on_or_before_as_of(datetime(2026, 7, 14, 0, 0, 0), date(2026, 7, 13))

def test_news_source_metadata_reaches_catalog_and_llm_payload():
    items = build_news_items(
        [
            {
                "title": "法說會",
                "summary": "毛利率展望",
                "timestamp": "2026-07-17T09:00:00",
                "url": "https://news.cnyes.com/news/id/1234567",
                "publisher": "鉅亨網",
                "kind": "guidance",
            },
            {
                "title": "沒有出處的那則",
                "summary": "系統彙整",
                "timestamp": "2026-07-16T09:00:00",
            },
        ],
        summary_chars=None,
    )
    bundle = EvidenceBundle(symbol="2330", as_of_date=date(2026, 7, 17), news=items)

    catalog = {row["id"]: row for row in bundle.catalog()}
    assert catalog["nw_01"]["url"] == "https://news.cnyes.com/news/id/1234567"
    assert catalog["nw_01"]["publisher"] == "鉅亨網"
    assert catalog["nw_01"]["published_at"] == "2026-07-17T09:00:00"
    assert catalog["nw_01"]["collected_at"] == bundle.collected_at
    assert bundle.catalog()[0]["collected_at"] == bundle.collected_at
    assert "url" not in catalog["nw_02"]
    assert "publisher" not in catalog["nw_02"]

    payload_news = bundle.as_payload_sections()["news"]
    assert payload_news[0]["url"] == catalog["nw_01"]["url"]
    assert payload_news[0]["publisher"] == catalog["nw_01"]["publisher"]
    assert payload_news[0]["published_at"] == "2026-07-17T09:00:00"
    assert [row["id"] for row in payload_news] == ["nw_01", "nw_02"]


def test_revenue_period_and_issue_date_prevent_lookahead():
    from app.features.analysis.evidence import revenue_availability
    official = _revenue("2026-08-01", 2026, 8, 100)
    official.create_time = "2026-09-10"
    assert _revenue_items([official], date(2026, 8, 10), _IdGen("fd")) == []
    assert _revenue_items([official], date(2026, 9, 9), _IdGen("fd")) == []
    item = _revenue_items([official], date(2026, 9, 10), _IdGen("fd"))[0]
    assert item["period"] == "2026-08" and item["available_at"] == "2026-09-10"
    legacy_revenue = _revenue("2026-09-01", 2026, 8, 100)
    assert revenue_availability(legacy_revenue)[0] == date(2026, 9, 10)
    official.create_time = "2026-09-15"
    assert not _revenue_is_published(official, date(2026, 9, 14))
    assert revenue_availability(_revenue("2025-12-01", 2025, 12, 100))[0] == date(2026, 1, 10)
    assert not _revenue_is_published(SimpleNamespace(date=date(2026, 8, 1)), date(2026, 9, 10))


def test_anchor_does_not_combine_new_close_with_old_moving_average():
    from app.features.analysis.evidence import build_long_term_anchor, _valuation_items
    items, missing = build_long_term_anchor(price_rows=[_price("2026-07-10", 100), _price("2026-07-13", 120)],
        technical_rows=[_tech("2026-07-10", ma60=100, ma240=100)], as_of_date=date(2026, 7, 14))
    assert "vs_ma60_pct" in missing
    assert not any(item["field"] == "vs_ma60_pct" for item in items)
    assert next(item for item in items if item["field"] == "close_pos_in_1y_pct")["date"] == "2026-07-13"
    valuations = _valuation_items([SimpleNamespace(date=date(2026, 7, 13), per=10)], date(2026, 7, 13), _IdGen("fd"))
    assert valuations[0]["sample_count"] == 1 and "pct_rank_1y" not in valuations[0]

