import json
from datetime import date, timedelta

from app.features.chat.dashboard import build_dashboard
from app.features.chat.schemas import SourceChunk


def source(category, payload, *, symbol="2330", citation="S1", **extra):
    return SourceChunk(category=category, title="Example source", source="system_market", source_name="資料庫",
                       stock_id=symbol, citation_id=citation, pub_time="2026-09-11", url="", score=1,
                       content=payload if isinstance(payload, str) else json.dumps(payload), **extra)


def market():
    return {"columns": ["date", "close", "chg_pct", "volume_shares", "kd_k9", "kd_d9", "rsi5", "rsi10",
                        "macd_dif", "macd_dea", "macd_hist"],
            "rows": [["2026-09-10", 100, -1, 0, 40, 50, 60, 55, 1.2, 0.5, 0.7],
                     ["2026-09-11", None, None, None, 55, 50, 65, 58, 1.5, 0.6, 0.9]]}


def test_price_and_technical_display_keep_independent_dates_and_nulls():
    result = build_dashboard([source("market_technical", market())], ["2330"], "查看股價及KD")
    metrics = next(block for block in result.blocks if block.kind == "metrics")
    assert {item.date for item in metrics.items} == {"2026-09-10"}
    values = {item.label: item.value for item in metrics.items}
    assert values["收盤價"] == 100 and values["成交量"] == 0
    assert values["最高價"] is None
    kd = next(block for block in result.blocks if block.title == "2330 KD")
    assert kd.dates == ["2026-09-10", "2026-09-11"]
    assert [series.values for series in kd.series] == [[40, 55], [50, 50]]
    assert "2026-09-11" in kd.description and kd.unit == "指數點"
    prices = next(block for block in result.blocks if block.title == "收盤價走勢")
    assert prices.series[0].values == [100, None] and prices.unit == "元"
    assert all(block.source_ids == ["S1"] for block in result.blocks)


def test_requested_rsi_and_macd_stay_separate_and_nonfinite_values_become_null():
    payload = market()
    payload["rows"][1][6] = float("nan")
    payload["rows"][1][7] = float("inf")
    payload["rows"][0][8] = True
    result = build_dashboard([source("market_technical", payload)], ["2330"], "顯示RSI及MACD", ["technical"])
    assert [block.title for block in result.blocks] == ["2330 RSI", "2330 MACD"]
    rsi, macd = result.blocks
    assert rsi.unit == "指數點" and macd.unit == "元"
    assert rsi.series[0].values == [60, None] and rsi.series[1].values == [55, None]
    assert macd.series[0].values == [None, 1.5]
    json.dumps(result.model_dump(mode="json"), allow_nan=False)


def test_explicit_missing_indicator_remains_visible_without_fabricated_values():
    item = source("market_technical", {"columns": ["date", "close", "kd_k9", "kd_d9"],
                                       "rows": [["2026-09-10", 100, None, None],
                                                ["2026-09-11", 101, None, None]]})
    explicit = build_dashboard([item], ["2330"], "查看KD", ["technical"])
    assert len(explicit.blocks) == 1 and explicit.blocks[0].title == "2330 KD"
    assert all(series.values == [None, None] for series in explicit.blocks[0].series)
    assert "沒有有效" in explicit.blocks[0].description
    broad = build_dashboard([item], ["2330"], "股價概況")
    assert all(block.title != "2330 KD" for block in broad.blocks)


def test_requested_stocks_with_only_availability_remain_visible_for_price_and_technical():
    available = source("market_technical", market())
    missing = source("data_availability", {"limitations": ["No observations available."]},
                     symbol="2317", citation="S2")
    prices = build_dashboard([available, missing], ["2330", "2317"], "股價", ["price"])
    chart = next(block for block in prices.blocks if block.kind == "chart")
    assert [(series.name, series.values) for series in chart.series] == [
        ("2330", [100, None]), ("2317", [None, None])]
    assert chart.source_ids == ["S1", "S2"] and "沒有有效收盤價資料：2317" in chart.description
    technical = build_dashboard([available, missing], ["2330", "2317"], "KD", ["technical"])
    assert [block.title for block in technical.blocks] == ["2330 KD", "2317 KD"]
    missing_kd = technical.blocks[1]
    assert missing_kd.dates == [] and all(series.values == [] for series in missing_kd.series)
    assert missing_kd.source_ids == ["S2"] and "沒有有效的 KD" in missing_kd.description
    for focus in ("price", "technical"):
        only_missing = build_dashboard([missing], ["2317"], "顯示資料", [focus])
        assert len(only_missing.blocks) == 1 and only_missing.blocks[0].source_ids == ["S2"]
        assert "2317" in (only_missing.blocks[0].title + only_missing.blocks[0].description)


def test_comparison_reuses_supplied_metrics_and_keeps_missing_stocks():
    payload = {"requested_start_date": "2026-09-07", "requested_end_date": "2026-09-11",
               "common_start_date": "2026-09-08", "common_end_date": "2026-09-11",
               "common_price_samples": 3, "common_daily_return_samples": 1,
               "daily_return_start_date": "2026-09-10", "daily_return_end_date": "2026-09-11",
               "stocks": [{"symbol": "2330", "first_common_close": 100, "last_common_close": 118.812345,
                           "interval_return_pct": 18.812345, "annualized_volatility_pct": None,
                           "max_drawdown_pct": -10, "available_price_samples": 5, "missing_observed_dates": 0},
                          {"symbol": "2317", "interval_return_pct": 21, "available_price_samples": 3}],
               "correlations": [{"symbols": ["2330", "2317"], "pearson_r": None}]}
    result = build_dashboard([source("comparison", payload, symbol="", citation="S8")],
                             ["2330", "2317"], "比較報酬和相關係數", ["comparison"])
    comparison, correlation = result.blocks
    assert comparison.rows[0][3:6] == ["18.812345", "無資料", "-10"]
    assert "2026-09-08" in comparison.description and "1 筆相鄰日報酬" in comparison.description
    assert "相鄰日報酬區間：2026-09-10 至 2026-09-11" in comparison.description
    assert "少於20筆" in comparison.description and comparison.source_ids == ["S8"]
    assert correlation.rows == [["2330／2317", "無資料"]]
    combined = build_dashboard([source("market_technical", market()), source("comparison", payload, symbol="")],
                               ["2330", "2317"], "比較股價及相關係數", ["price", "comparison"])
    assert [block.title for block in combined.blocks[:2]] == ["多股比較", "日報酬相關係數"]
    payload.update(common_start_date=None, common_end_date=None, common_price_samples=0,
                   common_daily_return_samples=0,
                   stocks=[{"symbol": "2330", "available_price_samples": 5},
                           {"symbol": "MISSING", "available_price_samples": 0}])
    missing = build_dashboard([source("comparison", payload, symbol="")],
                              ["2330", "MISSING"], "比較", ["comparison"]).blocks[0]
    assert [row[0] for row in missing.rows] == ["2330", "MISSING"]
    assert missing.rows[1][1:6] == ["無資料"] * 5 and missing.rows[1][6] == "0"
    assert "無法公平比較" in missing.description


def test_financial_periods_and_institutional_share_units_are_preserved_with_focus():
    fundamentals = source("fundamental", {"items": [
        {"field": "eps", "value": 2.5, "period": "2026Q1", "date": "2026-03-31"},
        {"field": "revenue_monthly", "value": 0, "period": "2026-08", "date": "2026-09-10"},
        {"field": "per", "value": 20, "date": "2026-09-11"},
        {"field": "pbr", "value": None},
    ]}, citation="S2")
    chips = source("institutional", {"columns": ["date", "foreign_net", "investment_trust_net", "dealer_net", "total_institutional_net"],
                                    "rows": [["2026-09-10", 0, None, -1250, None],
                                             ["2026-09-11", None, None, None, None]]}, citation="S3")
    result = build_dashboard([source("market_technical", market()), fundamentals, chips],
                             ["2330", "2317"], "基本面與法人", ["fundamental", "institutional"])
    assert [block.kind for block in result.blocks] == ["metrics", "table"]
    metrics = {item.label: item for item in result.blocks[0].items}
    assert (metrics["每股盈餘"].value, metrics["每股盈餘"].date, metrics["每股盈餘"].unit) == (2.5, "2026Q1", "元／股")
    assert metrics["月營收"].value == 0 and metrics["月營收"].date == "2026-08"
    assert metrics["本益比"].date == "2026-09-11" and metrics["股價淨值比"].value is None
    table = result.blocks[1]
    assert table.rows[0] == ["2330", "2026-09-10", "0", "無資料", "-1250", "無資料"]
    assert table.rows[1] == ["2317", *(["無資料"] * 5)] and "股" in table.description


def news(citation, url, *, article=None, title="News", in_range=True, content="News evidence"):
    return SourceChunk(title=title, source="publisher", source_name="<b>新聞來源</b>", stock_id="2330",
                       citation_id=citation, content=content, pub_time="2026-09-11 10:00:00",
                       url=url, score=1, category="news", article_id=article, in_time_range=in_range)


def test_news_deduplicates_articles_and_urls_and_filters_unsafe_links():
    sources = [news("S1", "https://news.example/one", article="a"),
               news("S2", "https://news.example/duplicate", article="a"),
               news("S3", "https://news.example/one", article="different"),
               news("S4", "https://news.example/background", title="<b>背景消息</b>", in_range=False)]
    unsafe = ["javascript:alert(1)", "data:text/html,test", "//news.example/path", "ftp://news.example/path",
              "https://user:password@news.example/path", "https://news.example/has space",
              "https://news.example\\@evil.example/path", "https://news.example:invalid/path"]
    sources.extend(news(f"S{index + 5}", url, title=f"Plain news {index}") for index, url in enumerate(unsafe))
    sources.extend([news("S14", "", title="純文字新聞"),
                    news("S15", "javascript:ignored", title="純文字新聞"),
                    news("S16", "", title="", content="")])
    result = build_dashboard(sources, ["2330"], "新聞", ["news"])
    block = result.blocks[0]
    expected_ids = ["S1", *(f"S{index + 5}" for index in range(len(unsafe))), "S14", "S4"]
    assert block.source_ids == expected_ids
    assert [item.source_id for item in block.items] == expected_ids
    assert block.items[-1].title == "【區間外背景】背景消息"
    assert all(item.url == "" for item in block.items[1:-1])
    assert block.items[-2].title == "純文字新聞" and block.items[-2].published_at == "2026-09-11 10:00:00"
    assert block.items[0].publisher == "新聞來源" and "不屬於指定期間" in block.description
    assert len(build_dashboard([news(f"S{i + 1}", f"https://news.example/{i}") for i in range(15)],
                              [], "新聞", ["news"]).blocks[0].items) == 12


def test_dashboard_limits_dates_and_symbols_and_skips_unsuitable_data():
    symbols = [str(2330 + index) for index in range(7)]
    rows = [[(date(2026, 7, 1) + timedelta(days=index)).isoformat(), 100 + index] for index in range(45)]
    sources = [source("market_technical", {"columns": ["date", "close"], "rows": rows},
                      symbol=symbol, citation=f"S{index + 1}") for index, symbol in enumerate(symbols)]
    result = build_dashboard(sources, symbols, "股價", ["price"])
    chart = next(block for block in result.blocks if block.kind == "chart")
    assert len(chart.dates) == 40 and chart.dates[0] == rows[5][0]
    assert [series.name for series in chart.series] == symbols[:6]
    assert len([block for block in result.blocks if block.kind == "metrics"]) == 6
    assert build_dashboard(sources, symbols, "新聞", ["news"]) is None
    assert build_dashboard([source("analysis_snapshot", "<script>bad()</script>")], [], "摘要") is None
    assert build_dashboard([source("market_technical", "{broken")], [], "股價") is None
    assert build_dashboard([source("fundamental", {"items": [{"field": [], "value": 100}]})], [], "基本面") is None
