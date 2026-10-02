"""Read bounded stock evidence for chat without generating another analysis."""
from __future__ import annotations

import json
from datetime import date

from sqlalchemy.orm import Session

from app.features.analysis import repository
from app.features.analysis.evidence import (
    ANNUAL_PUBLISH_LAG_DAYS, FINANCIAL_PUBLISH_LAG_DAYS, REVENUE_PUBLISH_DAY,
    TIMELINE_TRADING_DAYS, _financial_is_published, _revenue_is_published, build_evidence_bundle,
)

from .schemas import SourceChunk


_PRICE_FIELDS = ("open", "high", "low", "close", "volume_shares")
_TECH_FIELDS = ("ma5", "ma20", "ma60", "rsi5", "rsi10", "kd_k9", "kd_d9",
                "macd_dif", "macd_dea", "macd_signal", "macd_hist", "volume_ma5")
_DERIVED_FIELDS = ("chg_pct", "vol_vs_ma5_pct")
_CHIP_FIELDS = ("foreign_net", "investment_trust_net", "dealer_net", "total_institutional_net")
_FUNDAMENTAL_FIELDS = ("eps", "gross_margin_pct", "operating_margin_pct", "revenue_monthly",
                       "revenue_yoy_positive_streak", "per", "pbr", "dividend_yield")


def _source(symbol: str, category: str, title: str, as_of: date, content: dict,
            observed_at: str | None = None) -> SourceChunk:
    return SourceChunk(
        title=f"{symbol} {title}", source="system_market", source_name="系統個股資料庫",
        pub_time=observed_at or as_of.isoformat(), stock_id=symbol, stock_ids=[symbol],
        content=json.dumps({"symbol": symbol, "as_of_date": as_of.isoformat(),
                            "source_date_basis": ("Stored observation or generation timestamp; "
                                                  "later revisions are not tracked." if observed_at else
                                                  "Query cutoff, not a verified publication date."),
                            "category": category, **content},
                           ensure_ascii=False, separators=(",", ":"), default=float),
        url="", score=1, category=category,
    )


def collect_stock_sources(db: Session, symbols: list[str], as_of: date,
                          start_date: date | None = None) -> list[SourceChunk]:
    """Read primary observations using one caller-owned Session.

    Archived AI interpretations are excluded: checking their freshness scans the
    news corpus for every candidate date and is not part of a live chat request.
    """
    if start_date is not None and start_date > as_of:
        raise ValueError("start_date must not be after as_of")
    collected = {symbol: repository.collect_rows(db, symbol=symbol, as_of=as_of)
                 for symbol in dict.fromkeys(value.strip().upper() for value in symbols if value.strip())}
    all_days = sorted({row.date for rows in collected.values()
                       for key in ("price_rows", "technical_rows", "chip_rows") for row in rows[key]
                       if row.date <= as_of and (start_date is None or row.date >= start_date)})
    days = all_days[-TIMELINE_TRADING_DAYS:]
    sources = []
    for symbol, rows in collected.items():
        bundle = build_evidence_bundle(symbol=symbol, as_of_date=as_of, rows=rows, news_sources=[])
        price_by_date = {row.date: row for row in rows["price_rows"]}
        tech_by_date = {row.date: row for row in rows["technical_rows"]}
        chip_by_date = {row.date: row for row in rows["chip_rows"]}
        timeline = bundle.timeline_by_date()
        long_term_anchor = bundle.long_term_anchor
        anchor_limitations = []
        latest_price_date = max(price_by_date, default=None)
        latest_technical_date = max(tech_by_date, default=None)
        if latest_price_date != latest_technical_date:
            long_term_anchor = [item for item in long_term_anchor
                                if item["field"] not in {"vs_ma60_pct", "vs_ma240_pct"}]
            anchor_limitations.append(
                f"MA60/MA240 deviations omitted: no same-date closing price and moving average. "
                f"Latest price date: {latest_price_date}; latest indicator date: {latest_technical_date}.")
        window = {"requested_start_date": start_date.isoformat() if start_date else None,
                  "window_start_date": days[0].isoformat() if days else None,
                  "window_end_date": days[-1].isoformat() if days else None,
                  "maximum_observations": TIMELINE_TRADING_DAYS,
                  "window_truncated": len(all_days) > TIMELINE_TRADING_DAYS,
                  "comparison_basis": "All requested stocks use the same observation dates. "
                                      "Null means missing, never zero or a carried-forward value."}
        before = len(sources)

        def market_row(day: date) -> list:
            return [day.isoformat(),
                    *(getattr(price_by_date.get(day), key, None) for key in _PRICE_FIELDS),
                    *(timeline.get(day.isoformat(), {}).get(key) for key in _DERIVED_FIELDS),
                    *(getattr(tech_by_date.get(day), key, None) for key in _TECH_FIELDS)]

        observed_days = [day for day in days if day in price_by_date or day in tech_by_date]
        if observed_days:
            previous = max((day for day in price_by_date.keys() | tech_by_date.keys()
                            if day < days[0]), default=None)
            sources.append(_source(symbol, "market_technical", "價量與技術指標", as_of, {
                **window,
                "columns": ["date", *_PRICE_FIELDS, *_DERIVED_FIELDS, *_TECH_FIELDS],
                "rows": [market_row(day) for day in days],
                "previous_window_observation": market_row(previous) if previous else None,
                "units": {"prices_and_moving_averages": "TWD per share", "volume_shares": "shares",
                          "volume_ma5": "shares", "chg_pct": "%", "vol_vs_ma5_pct": "%",
                          "rsi5_rsi10_kd_k9_kd_d9": "index points", "macd_fields": "TWD per share"},
                "indicator_basis": "Stored daily indicators: RSI periods 5/10; KD period 9. "
                                   "MACD smoothing settings are not recorded here. "
                                   "The previous observation may precede the requested window. "
                                   "Missing K or D values cannot establish a crossover, and gaps "
                                   "between observations do not establish consecutive trading-day coverage.",
                "price_change_basis": "The existing analysis builder compares with the previous available close; "
                                      "missing intervening observations prevent calling it a verified single-session move.",
                "long_term_anchor": long_term_anchor,
                "long_term_anchor_limitations": anchor_limitations,
            }, observed_days[-1].isoformat()))

        observed_chips = [day for day in days if day in chip_by_date]
        if observed_chips:
            sources.append(_source(symbol, "institutional", "法人買賣超", as_of, {
                **window, "columns": ["date", *_CHIP_FIELDS],
                "rows": [[day.isoformat(), *(getattr(chip_by_date.get(day), key, None)
                                            for key in _CHIP_FIELDS)] for day in days],
                "unit": "shares; positive means net buying, negative means net selling",
                "ten_day_summary": bundle.chip_summary,
                "summary_basis": "The existing ten-trading-day summary uses lots (1 lot = 1000 shares) "
                                 "and can include observations before the requested start date.",
            }, observed_chips[-1].isoformat()))

        published_income = [row for row in rows["income_rows"] if _financial_is_published(row.date, as_of)]
        latest_income_date = max((row.date for row in published_income), default=None)
        published_revenue = [row for row in rows["revenue_rows"] if _revenue_is_published(row, as_of)]
        latest_revenue = published_revenue[-1] if published_revenue else None
        if bundle.fundamental or published_income or published_revenue:
            fundamental_ids = {item["id"] for item in bundle.fundamental}
            fundamentals = {item["field"]: {key: value for key, value in item.items()
                                           if key not in {"id", "collected_at"}}
                            for item in bundle.catalog() if item["id"] in fundamental_ids}
            if latest_revenue is not None and (latest_revenue.revenue is None or latest_revenue.revenue <= 0):
                fundamentals["revenue_monthly"] = {
                    "field": "revenue_monthly", "date": latest_revenue.date.isoformat(),
                    "period": (f"{latest_revenue.revenue_year}-{latest_revenue.revenue_month:02d}"
                               if latest_revenue.revenue_year and latest_revenue.revenue_month else None),
                    "value": latest_revenue.revenue,
                    "publication_basis": "Existing announcement-lag estimate; actual publication time unavailable.",
                    "growth_limitation": "Latest revenue is non-positive or missing. Derived growth and a "
                                         "positive-growth streak are unavailable for this reporting period.",
                }
                fundamentals.pop("revenue_yoy_positive_streak", None)
            sources.append(_source(symbol, "fundamental", "基本面與估值", as_of, {
                "requested_start_date": window["requested_start_date"],
                "items": [fundamentals.get(field, {"field": field, "value": None})
                          for field in _FUNDAMENTAL_FIELDS],
                "reported_income": [{"period_end": row.date.isoformat(), "field": row.item_type,
                                     "value": row.value}
                                    for row in published_income if row.date == latest_income_date],
                "reported_monthly_revenue": ({"stored_date": latest_revenue.date.isoformat(),
                    "year": latest_revenue.revenue_year, "month": latest_revenue.revenue_month,
                    "revenue": latest_revenue.revenue} if latest_revenue is not None else None),
                "units": {"eps": "TWD per share", "revenue_monthly": "TWD",
                          "margins_and_growth_and_dividend_yield": "%", "per_and_pbr": "times",
                          "revenue_yoy_positive_streak": "months", "pct_rank_1y": "percentile",
                          "reported_income": "EPS: TWD per share; other fields: original stored units. "
                                             "Monetary scaling is not recorded, so do not assume thousands or millions."},
                "publication_basis": f"Actual announcement and revision times are unavailable. "
                                     f"The existing evidence builder assumes a {FINANCIAL_PUBLISH_LAG_DAYS}-day "
                                     f"quarterly lag, {ANNUAL_PUBLISH_LAG_DAYS}-day annual lag, and monthly "
                                     f"revenue availability no earlier than day {REVENUE_PUBLISH_DAY} of the month after its revenue period, or a later issue date. "
                                     "These are availability estimates, not verified publication dates. "
                                     "Each item retains its reporting period or market date; compare matching "
                                     "periods only. This is the latest available background at the cutoff, "
                                     "which can predate the requested interval.",
            }))

        if len(sources) == before:
            sources.append(_source(symbol, "data_availability", "資料可用性", as_of, {
                **window, "status": "unavailable",
                "limitation": "No price, technical, institutional, or available financial evidence "
                              "was found for this stock and cutoff/window. "
                              "The source date is the query cutoff, not an observation publication date.",
            }))
    return sources
