"""Pure, deterministic evidence calculations; no database or HTTP access."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
import re
from typing import Any, Iterable, Sequence

TIMELINE_TRADING_DAYS = 40
CHIP_SUMMARY_TRADING_DAYS = 10
LONG_TERM_LOOKBACK_DAYS = 400
VALUATION_RANK_LOOKBACK_DAYS = 365
FINANCIAL_LOOKBACK_DAYS = 900
REVENUE_LOOKBACK_DAYS = 800
SHARES_PER_LOT = 1000
# A full sentence in missing_fields; the brief shows it without the "缺少：" prefix.
NEWS_FIRST_PUBLIC_LIMITATION = "新聞的首次發布時間無法確認，分析可能用到事後才公開的資訊。"

FINANCIAL_PUBLISH_LAG_DAYS = 50
ANNUAL_PUBLISH_LAG_DAYS = 95
REVENUE_PUBLISH_DAY = 10

FIELD_GLOSSARY: dict[str, str] = {
    "close": "收盤價（元）",
    "chg_pct": "當日漲跌幅（%）",
    "vol_lots": "成交量（張，1 張＝1000 股）",
    "vol_vs_ma5_pct": "成交量相對五日均量的增減（%），負值代表量能萎縮",
    "foreign_net_lots": "外資買賣超（張），正為買超、負為賣超",
    "trust_net_lots": "投信買賣超（張）",
    "dealer_net_lots": "自營商買賣超（張）",
    "rsi5": "五日相對強弱值，數值越高代表近期上漲天數與幅度佔比越大",
    "kd_k": "九日 K 值，反映收盤價在近九日高低區間中的位置",
    "macd_hist": "快慢線差值的柱狀體，正值代表上行動能累積、負值代表動能仍受壓",
    "vs_ma20_pct": "收盤價相對二十日均線的乖離（%）",
    "news": "當日對應的新聞 id；空陣列代表當天沒有檢索到新聞",
    "foreign_net_10d_lots": "外資近十個交易日買賣超合計（張）",
    "high_1y": "近一年最高收盤價（元）",
    "low_1y": "近一年最低收盤價（元）",
    "close_pos_in_1y_pct": "收盤價落在近一年高低區間的位置（0＝最低、100＝最高）",
    "vs_ma60_pct": "收盤價相對六十日均線的乖離（%）",
    "vs_ma240_pct": "收盤價相對二百四十日均線的乖離（%）",
    "eps": "單季每股盈餘（元），非累計",
    "gross_margin_pct": "單季毛利率（%）",
    "operating_margin_pct": "單季營業利益率（%）",
    "revenue_monthly": "單月合併營收（元）",
    "revenue_yoy_positive_streak": "月營收年增率連續為正的月數",
    "per": "本益比",
    "pbr": "股價淨值比",
    "dividend_yield": "現金殖利率（%）",
    "pct_rank_1y": "該數值在近一年分佈中的百分位（0～100），數值越高代表相對越貴／越高",
}

def _f(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (int, float)):
        return float(value)
    return None

def _round(value: float | None, digits: int) -> float | None:
    return None if value is None else round(value, digits)

def _lots(shares: Any) -> int | None:
    value = _f(shares)
    return None if value is None else int(round(value / SHARES_PER_LOT))

def _pct_change(current: float | None, base: float | None) -> float | None:
    if current is None or base is None or base == 0:
        return None
    return (current / base - 1.0) * 100.0

def _growth_pct(current: float | None, base: float | None) -> float | None:
    if current is None or base is None or base <= 0:
        return None
    return (current / base - 1.0) * 100.0

def _pct_rank(values: Sequence[float], current: float) -> int | None:
    if not values:
        return None
    below = sum(1 for value in values if value <= current)
    return int(round(below / len(values) * 100))

def _quarter_label(period_end: date) -> str:
    return f"{period_end.year}Q{(period_end.month - 1) // 3 + 1}"

def _financial_is_published(period_end: date, as_of: date) -> bool:
    lag = ANNUAL_PUBLISH_LAG_DAYS if period_end.month == 12 else FINANCIAL_PUBLISH_LAG_DAYS
    return period_end + timedelta(days=lag) <= as_of

def revenue_availability(row: Any) -> tuple[date | None, str]:
    """Use the revenue period, not the provider-specific row date, as the anchor."""
    try:
        year, month = int(row.revenue_year), int(row.revenue_month)
        period = date(year, month, 1)
    except (AttributeError, TypeError, ValueError):
        return None, "營收月份不明，無法判定可用日"
    following = (period.replace(day=28) + timedelta(days=4)).replace(day=REVENUE_PUBLISH_DAY)
    raw = str(getattr(row, "create_time", "") or "")
    try:
        issued = date.fromisoformat(raw[:10])
    except ValueError:
        issued = None
    # A table issue date is an availability bound, not a verified first-publication time.
    available = max(following, issued) if issued else following
    return available, ("依營收次月公告期限與出表日較晚者保守判定，非首次公布時間"
                       if issued else "依營收次月公告期限估計；未取得實際公布與修訂時間")


def _revenue_is_published(row: Any, as_of: date) -> bool:
    available, _ = revenue_availability(row)
    return available is not None and available <= as_of


class _IdGen:
    def __init__(self, prefix: str) -> None:
        self._prefix = prefix
        self._n = 0

    def next(self) -> str:
        self._n += 1
        return f"{self._prefix}_{self._n:02d}"

@dataclass
class EvidenceBundle:
    symbol: str
    as_of_date: date
    daily_timeline: list[dict[str, Any]] = field(default_factory=list)
    chip_summary: list[dict[str, Any]] = field(default_factory=list)
    long_term_anchor: list[dict[str, Any]] = field(default_factory=list)
    fundamental: list[dict[str, Any]] = field(default_factory=list)
    news: list[dict[str, Any]] = field(default_factory=list)
    missing_fields: list[str] = field(default_factory=list)
    rag_fallback_mode: bool = False
    collected_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())

    def as_payload_sections(self) -> dict[str, Any]:
        return {
            "daily_timeline": self.daily_timeline,
            "chip_summary": self.chip_summary,
            "long_term_anchor": self.long_term_anchor,
            "fundamental": self.fundamental,
            "news": self.news,
            "missing_fields": self.missing_fields,
            "data_limitations": ["價格為未還原收盤價，報酬未排除除權息與拆股影響",
                                 "財報可用日為估計；原始累計財報不等於單季 EPS"],
        }

    def evidence_ids(self) -> set[str]:
        ids: set[str] = set()
        for bucket in (
            self.daily_timeline,
            self.chip_summary,
            self.long_term_anchor,
            self.fundamental,
            self.news,
        ):
            for item in bucket:
                item_id = item.get("id")
                if isinstance(item_id, str):
                    ids.add(item_id)
        return ids

    def catalog(self) -> list[dict[str, Any]]:
        catalog: list[dict[str, Any]] = []
        for row in self.daily_timeline:
            catalog.append(
                {
                    "id": row["id"],
                    "field": "daily_timeline",
                    "date": row.get("date"),
                    "value": {
                        key: row.get(key)
                        for key in ("close", "chg_pct", "vol_lots", "vol_vs_ma5_pct", "foreign_net_lots",
                                    "trust_net_lots", "dealer_net_lots", "rsi5", "kd_k", "macd_hist", "vs_ma20_pct")
                        if row.get(key) is not None
                    },
                }
            )
        catalog.extend(self.chip_summary)
        catalog.extend(self.long_term_anchor)
        catalog.extend({**item, "publication_basis": item.get("publication_basis") or (
            "依財報期間與固定公告延遲推定可用日，未取得實際公告時間"
            if item.get("field") in {"eps", "gross_margin_pct", "operating_margin_pct"}
            else "依月營收公告期限推定可用日，未取得實際公告時間"
            if item.get("field") in {"revenue_monthly", "revenue_yoy_positive_streak"}
            else "市場資料日期；未保存精確發布與修訂時間"
        )} for item in self.fundamental)
        catalog.extend(self.news)
        return [{**item, "collected_at": self.collected_at} for item in catalog]

    def timeline_by_id(self) -> dict[str, dict[str, Any]]:
        return {row["id"]: row for row in self.daily_timeline}

    def timeline_by_date(self) -> dict[str, dict[str, Any]]:
        return {str(row.get("date")): row for row in self.daily_timeline}

    def known_percentages(self) -> set[float]:
        values: set[float] = set()

        def add(value: Any) -> None:
            number = _f(value)
            if number is not None:
                values.add(round(number, 2))

        for row in self.daily_timeline:
            for key in ("chg_pct", "vol_vs_ma5_pct", "vs_ma20_pct"):
                add(row.get(key))
        for item in self.long_term_anchor + self.fundamental:
            for key in ("yoy_pct", "qoq_pct", "mom_pct", "pct_rank_1y"):
                add(item.get(key))
            if str(item.get("field") or "").endswith("_pct"):
                add(item.get("value"))
            for _, series_value in _iter_series(item):
                add(series_value)
        return values

def _iter_series(item: dict[str, Any]) -> Iterable[tuple[str, Any]]:
    for key in ("yoy_last6",):
        series = item.get(key)
        if isinstance(series, list):
            for entry in series:
                if isinstance(entry, (list, tuple)) and len(entry) == 2:
                    yield str(entry[0]), entry[1]

def build_daily_timeline(
    *,
    price_rows: Sequence[Any],
    chip_rows: Sequence[Any],
    technical_rows: Sequence[Any],
    news_items: Sequence[dict[str, Any]],
    trading_days: int = TIMELINE_TRADING_DAYS,
) -> tuple[list[dict[str, Any]], list[str]]:
    missing: list[str] = []
    if not price_rows:
        return [], ["價量資料"]

    chip_by_date = {row.date: row for row in chip_rows}
    tech_by_date = {row.date: row for row in technical_rows}
    news_by_date: dict[str, list[str]] = {}
    for item in news_items:
        item_date = item.get("date")
        if isinstance(item_date, str) and isinstance(item.get("id"), str):
            news_by_date.setdefault(item_date, []).append(item["id"])

    window_rows = list(price_rows)[-trading_days:]
    prev_close_by_date: dict[date, float | None] = {}
    previous: float | None = None
    for row in price_rows:
        prev_close_by_date[row.date] = previous
        close = _f(row.close)
        if close is not None:
            previous = close

    timeline: list[dict[str, Any]] = []
    ids = _IdGen("d")
    for row in window_rows:
        close = _f(row.close)
        technical = tech_by_date.get(row.date)
        chip = chip_by_date.get(row.date)
        volume = _f(row.volume_shares)
        volume_ma5 = _f(getattr(technical, "volume_ma5", None)) if technical else None
        ma20 = _f(getattr(technical, "ma20", None)) if technical else None

        entry: dict[str, Any] = {
            "id": ids.next(),
            "date": row.date.isoformat(),
            "close": _round(close, 2),
            "chg_pct": _round(_pct_change(close, prev_close_by_date.get(row.date)), 2),
            "vol_lots": _lots(volume),
            "vol_vs_ma5_pct": _round(_pct_change(volume, volume_ma5), 0),
            "foreign_net_lots": _lots(getattr(chip, "foreign_net", None)) if chip else None,
            "trust_net_lots": _lots(getattr(chip, "investment_trust_net", None)) if chip else None,
            "dealer_net_lots": _lots(getattr(chip, "dealer_net", None)) if chip else None,
            "rsi5": _round(_f(getattr(technical, "rsi5", None)) if technical else None, 1),
            "kd_k": _round(_f(getattr(technical, "kd_k9", None)) if technical else None, 1),
            "macd_hist": _round(_f(getattr(technical, "macd_hist", None)) if technical else None, 2),
            "vs_ma20_pct": _round(_pct_change(close, ma20), 1),
            "news": news_by_date.get(row.date.isoformat(), []),
        }
        timeline.append({key: value for key, value in entry.items() if value is not None})

    if not any("foreign_net_lots" in row for row in timeline):
        missing.append("三大法人買賣超")
    if not any("macd_hist" in row for row in timeline):
        missing.append("技術指標")
    if len(timeline) < trading_days:
        missing.append(f"交易日不足（僅 {len(timeline)} 個交易日）")
    return timeline, missing

def build_chip_summary(
    *,
    timeline: Sequence[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[str]]:
    recent = list(timeline)[-CHIP_SUMMARY_TRADING_DAYS:]
    values = [row.get("foreign_net_lots") for row in recent]
    if len(recent) < CHIP_SUMMARY_TRADING_DAYS or any(
        not isinstance(value, (int, float)) for value in values
    ):
        return [], [f"外資近 {CHIP_SUMMARY_TRADING_DAYS} 個交易日累計買賣超"]

    return [
        {
            "id": "ch_01",
            "field": "foreign_net_10d_lots",
            "date": str(recent[-1].get("date")),
            "value": int(sum(values)),
            "calculation": {
                "formula": "近十個交易日外資買賣超加總後取整數",
                "unit": "張",
                "inputs": [{"date": str(row["date"]), "value": value} for row, value in zip(recent, values)],
            },
        }
    ], []

def build_long_term_anchor(
    *,
    price_rows: Sequence[Any],
    technical_rows: Sequence[Any],
    as_of_date: date,
) -> tuple[list[dict[str, Any]], list[str]]:
    missing: list[str] = []
    if not price_rows:
        return [], ["長期價格資料"]

    ids = _IdGen("lt")
    items: list[dict[str, Any]] = []
    one_year_ago = as_of_date - timedelta(days=VALUATION_RANK_LOOKBACK_DAYS)
    year_rows = [row for row in price_rows if row.date >= one_year_ago and _f(row.close) is not None]
    latest_close = _f(price_rows[-1].close)

    if year_rows and latest_close is not None:
        highest = max(year_rows, key=lambda row: _f(row.close) or 0.0)
        lowest = min(year_rows, key=lambda row: _f(row.close) or 0.0)
        high_value = _f(highest.close)
        low_value = _f(lowest.close)
        items.append(
            {
                "id": ids.next(),
                "field": "high_1y",
                "date": highest.date.isoformat(),
                "value": _round(high_value, 2),
            }
        )
        items.append(
            {
                "id": ids.next(),
                "field": "low_1y",
                "date": lowest.date.isoformat(),
                "value": _round(low_value, 2),
            }
        )
        if high_value is not None and low_value is not None and high_value > low_value:
            position = (latest_close - low_value) / (high_value - low_value) * 100.0
            items.append(
                {
                    "id": ids.next(),
                    "field": "close_pos_in_1y_pct",
                    "date": price_rows[-1].date.isoformat(),
                    "value": _round(position, 1),
                }
            )
    else:
        missing.append("近一年高低點")

    latest_technical = next((row for row in reversed(technical_rows) if row.date == price_rows[-1].date), None)
    for public_field, source_field in (("vs_ma60_pct", "ma60"), ("vs_ma240_pct", "ma240")):
        base = _f(getattr(latest_technical, source_field, None)) if latest_technical else None
        deviation = _pct_change(latest_close, base)
        if deviation is None:
            missing.append(public_field)
            continue
        items.append(
            {
                "id": ids.next(),
                "field": public_field,
                "date": latest_technical.date.isoformat(),
                "value": _round(deviation, 1),
            }
        )
    return items, missing

def _eps_items(rows: Sequence[Any], as_of_date: date, ids: _IdGen) -> list[dict[str, Any]]:
    by_period: dict[date, dict[str, float]] = {}
    for row in rows:
        if not _financial_is_published(row.date, as_of_date):
            continue
        value = _f(row.value)
        if value is None:
            continue
        by_period.setdefault(row.date, {})[row.item_type] = value

    periods = sorted(by_period)
    if not periods:
        return []

    latest = periods[-1]
    metrics = by_period[latest]
    eps = metrics.get("EPS")
    if eps is None:
        return []

    def quarter_index(period_end: date) -> int:
        return period_end.year * 4 + (period_end.month - 1) // 3

    latest_index = quarter_index(latest)
    by_index = {quarter_index(period): by_period[period] for period in periods}
    previous = by_index.get(latest_index - 1)
    year_ago = by_index.get(latest_index - 4)
    item: dict[str, Any] = {
        "id": ids.next(),
        "field": "eps",
        "period": _quarter_label(latest),
        "date": latest.isoformat(),
        "value": _round(eps, 2),
        "qoq_pct": _round(_growth_pct(eps, previous.get("EPS") if previous else None), 1),
        "yoy_pct": _round(_growth_pct(eps, year_ago.get("EPS") if year_ago else None), 1),
        "last4q": [
            [_quarter_label(period), _round(by_period[period].get("EPS"), 2)]
            for period in periods[-4:]
            if by_period[period].get("EPS") is not None
        ],
    }
    items = [{key: value for key, value in item.items() if value is not None}]

    revenue = metrics.get("Revenue")
    for public_field, source_field in (
        ("gross_margin_pct", "GrossProfit"),
        ("operating_margin_pct", "OperatingIncome"),
    ):
        numerator = metrics.get(source_field)
        margin = None if revenue in (None, 0) or numerator is None else numerator / revenue * 100.0
        if margin is None:
            continue
        items.append(
            {
                "id": ids.next(),
                "field": public_field,
                "period": _quarter_label(latest),
                "date": latest.isoformat(),
                "value": _round(margin, 1),
            }
        )
    return items

def _revenue_items(rows: Sequence[Any], as_of_date: date, ids: _IdGen) -> list[dict[str, Any]]:
    published = [
        row
        for row in rows
        if _revenue_is_published(row, as_of_date) and (_f(row.revenue) or 0.0) > 0
    ]
    if not published:
        return []

    published.sort(key=lambda row: row.date)
    by_period: dict[tuple[int, int], float] = {}
    for row in published:
        year = int(row.revenue_year) if row.revenue_year else row.date.year
        month = int(row.revenue_month) if row.revenue_month else row.date.month
        by_period[(year, month)] = float(_f(row.revenue) or 0.0)

    periods = sorted(by_period)
    latest = periods[-1]
    latest_value = by_period[latest]
    latest_row = next(row for row in reversed(published)
                      if (int(row.revenue_year), int(row.revenue_month)) == latest)
    available, basis = revenue_availability(latest_row)

    def yoy_for(period: tuple[int, int]) -> float | None:
        return _growth_pct(by_period.get(period), by_period.get((period[0] - 1, period[1])))

    def month_index(period: tuple[int, int]) -> int:
        return period[0] * 12 + period[1] - 1

    latest_index = month_index(latest)
    by_index = {month_index(period): period for period in periods}
    previous = by_index.get(latest_index - 1)

    streak = 0
    cursor = latest_index
    while True:
        period = by_index.get(cursor)
        if period is None:
            break
        change = yoy_for(period)
        if change is None or change <= 0:
            break
        streak += 1
        cursor -= 1

    item: dict[str, Any] = {
        "id": ids.next(),
        "field": "revenue_monthly",
        "available_at": available.isoformat(),
        "publication_basis": basis,
        "period": f"{latest[0]}-{latest[1]:02d}",
        "value": int(latest_value),
        "yoy_pct": _round(yoy_for(latest), 1),
        "mom_pct": _round(_growth_pct(latest_value, by_period.get(previous) if previous else None), 1),
        "yoy_last6": [
            [f"{period[0]}-{period[1]:02d}", _round(yoy_for(period), 1)]
            for period in periods[-6:]
            if yoy_for(period) is not None
        ],
    }
    items = [{key: value for key, value in item.items() if value is not None}]
    if streak:
        items.append(
            {
                "id": ids.next(),
                "field": "revenue_yoy_positive_streak",
                "available_at": available.isoformat(),
                "publication_basis": basis,
                "period": f"{latest[0]}-{latest[1]:02d}",
                "value": streak,
            }
        )
    return items

def _valuation_items(rows: Sequence[Any], as_of_date: date, ids: _IdGen) -> list[dict[str, Any]]:
    usable = [row for row in rows if row.date <= as_of_date]
    if not usable:
        return []

    usable.sort(key=lambda row: row.date)
    latest = usable[-1]
    one_year_ago = as_of_date - timedelta(days=VALUATION_RANK_LOOKBACK_DAYS)
    window = [row for row in usable if row.date >= one_year_ago]

    items: list[dict[str, Any]] = []
    for public_field, source_field in (
        ("per", "per"),
        ("pbr", "pbr"),
        ("dividend_yield", "dividend_yield"),
    ):
        value = _f(getattr(latest, source_field, None))
        if value is None:
            continue
        history = [
            number
            for number in (_f(getattr(row, source_field, None)) for row in window)
            if number is not None
        ]
        item = {
            "id": ids.next(),
            "field": public_field,
            "date": latest.date.isoformat(),
            "value": _round(value, 2),
            "sample_count": len(history),
            "window_start": window[0].date.isoformat() if window else None,
            "window_end": latest.date.isoformat(),
            # A full-year label requires broad coverage, not a single observation.
            "pct_rank_1y": (_pct_rank(history, value) if len(history) >= 120
                            and (latest.date - window[0].date).days >= 300 else None),
        }
        items.append({key: entry for key, entry in item.items() if entry is not None})
    return items



def build_news_items(
    news_sources: Sequence[dict[str, Any]],
    *,
    summary_chars: int | None,
) -> list[dict[str, Any]]:
    ids = _IdGen("nw")
    items: list[dict[str, Any]] = []
    for source in news_sources:
        if not isinstance(source, dict):
            continue
        title = str(source.get("title") or "").strip()
        if not title:
            continue
        timestamp = str(source.get("timestamp") or "")
        summary = str(source.get("summary") or "")
        if summary_chars and len(summary) > summary_chars:
            summary = summary[:summary_chars] + "…"
        kind = source.get("kind")
        url = source.get("url")
        publisher = source.get("publisher")
        raw_article_id = source.get("article_id")
        article_id = str(raw_article_id).strip() if raw_article_id else None

        item = {
            "id": ids.next(),
            "field": "news",
            "article_id": article_id,
            **{key: source[key] for key in ("chunk_id", "chunk_index", "char_start", "char_end",
                                          "content_hash", "revision", "index_version", "embedding_model",
                                          "content_truncated", "content_kind", "retrieval_branch",
                                          "shared_facts", "shared_fact_ids", "impact_context", "source_relationships",
                                          "event_time", "first_public_at", "observed_at", "revised_at")
               if source.get(key) is not None},
            "date": timestamp.split("T", 1)[0] if timestamp else None,
            "published_at": timestamp if "T" in timestamp else None,
            "published_time_precision": ("offset_datetime" if re.search(r"T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:\d{2})$", timestamp)
                                         else "local_datetime" if "T" in timestamp
                                         else "date" if re.fullmatch(r"\d{4}-\d{2}-\d{2}", timestamp)
                                         else "unknown"),
            "publication_basis": "上游提供的報導發布時間；首次公開及完整修訂歷史仍未核實",
            "kind": kind if kind in {"general", "guidance", "market"} else "general",
            "title": title,
            "value": summary or title,
            "url": str(url).strip() if isinstance(url, str) and url.strip() else None,
            "publisher": (
                str(publisher).strip()
                if isinstance(publisher, str) and publisher.strip()
                else None
            ),
        }
        if isinstance(source.get("source_state"), dict):
            item["source_state"] = {**source["source_state"], "limitation":
                "新聞首次公開時間及完整修訂歷史未核實；僅能作回顧資料，不能宣稱精確還原當時可得資訊。"}
        items.append({key: value for key, value in item.items() if value is not None})
    return items


def build_evidence_bundle(*, symbol: str, as_of_date: date,
                          rows: dict[str, list[Any]], news_sources: Sequence[dict[str, Any]],
                          rag_fallback_mode: bool = False) -> EvidenceBundle:
    price_rows = [row for row in rows["price_rows"] if row.date <= as_of_date]
    chip_rows = [row for row in rows["chip_rows"] if row.date <= as_of_date]
    technical_rows = [row for row in rows["technical_rows"] if row.date <= as_of_date]
    news = build_news_items(news_sources, summary_chars=None)
    timeline, timeline_missing = build_daily_timeline(
        price_rows=price_rows, chip_rows=chip_rows, technical_rows=technical_rows, news_items=news)
    chips, chip_missing = build_chip_summary(timeline=timeline)
    anchor, anchor_missing = build_long_term_anchor(
        price_rows=price_rows, technical_rows=technical_rows, as_of_date=as_of_date)
    fundamental, fundamental_missing = [], []
    ids = _IdGen("fd")
    for builder, key, missing in (
        (_eps_items, "income_rows", "每股盈餘與獲利率"),
        (_revenue_items, "revenue_rows", "月營收"),
        (_valuation_items, "valuation_rows", "本益比與估值"),
    ):
        items = builder(rows[key], as_of_date, ids)
        fundamental.extend(items)
        if not items:
            fundamental_missing.append(missing)
    if not news:
        timeline_missing.append("近期新聞")
    if any(item.get("source_state", {}).get("limitation") for item in news):
        timeline_missing.append(NEWS_FIRST_PUBLIC_LIMITATION)
    return EvidenceBundle(
        symbol=symbol, as_of_date=as_of_date, daily_timeline=timeline,
        chip_summary=chips, long_term_anchor=anchor, fundamental=fundamental, news=news,
        missing_fields=list(dict.fromkeys([*timeline_missing, *chip_missing, *anchor_missing, *fundamental_missing])),
        rag_fallback_mode=rag_fallback_mode,
    )
