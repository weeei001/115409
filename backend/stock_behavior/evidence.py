"""text-first-v2 的證據組裝層。

設計原則：進入 payload 的每一筆資料都帶 id、都能被 evidence_ids 引用。
原本 v1 送出的 120 天 price/chip/technical 三張原始視窗沒有 id，
LLM 讀了也無法引用（會被 evidence 過濾器刪掉），此處以「每個交易日一列」
的合併時間軸取代，並把需要跨列運算的結論（均量比、乖離、法人累計、
基本面 YoY）先在後端算好，避免 LLM 做算術。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Iterable, Sequence

from sqlalchemy.orm import Session

from crud.daily_price import get_price_range
from crud.finmind_extra import (
    get_financial_statements,
    get_monthly_revenues,
    get_valuations,
)
from crud.institutional_trade import get_by_symbol_range
from crud.technical_indicator import get_indicators


TIMELINE_TRADING_DAYS = 40
CHIP_SUMMARY_TRADING_DAYS = 10
LONG_TERM_LOOKBACK_DAYS = 400
VALUATION_RANK_LOOKBACK_DAYS = 365
FINANCIAL_LOOKBACK_DAYS = 900
REVENUE_LOOKBACK_DAYS = 800
SHARES_PER_LOT = 1000

# 財報公告時差：以「期末 + N 日」判斷該期在 as_of 當下是否已公開，
# 避免歷史回測拿到當時尚未公告的財報。台灣 Q1~Q3 為期末後 45 日內、
# 年度財報為 75 日內，此處各留一段緩衝。
FINANCIAL_PUBLISH_LAG_DAYS = 50
ANNUAL_PUBLISH_LAG_DAYS = 95
# 月營收公告期限為次月 10 日；資料表的 date 欄本身已是次月 1 日。
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
    """相對變動；用於價格、成交量這類基期恆為正的欄位。"""
    if current is None or base is None or base == 0:
        return None
    return (current / base - 1.0) * 100.0


def _growth_pct(current: float | None, base: float | None) -> float | None:
    """成長率；基期為零或負數時不計算。

    EPS 會虧損（本資料表有 17 筆負值）、月營收也有少數異常負值，
    以負基期算出的百分比在財務上沒有意義（例如 -0.63 到 8.41 會算成 -1435%），
    這種數字一旦進了 payload，LLM 會照抄成「年增 1435%」。
    """
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


def _revenue_is_published(row_date: date, as_of: date) -> bool:
    try:
        deadline = row_date.replace(day=REVENUE_PUBLISH_DAY)
    except ValueError:  # pragma: no cover - day=10 對任何月份都合法
        return False
    return deadline <= as_of


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

    def as_payload_sections(self) -> dict[str, Any]:
        return {
            "daily_timeline": self.daily_timeline,
            "chip_summary": self.chip_summary,
            "long_term_anchor": self.long_term_anchor,
            "fundamental": self.fundamental,
            "news": self.news,
            "missing_fields": self.missing_fields,
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
        """證據總表，供回應的 evidence_catalog 依引用挑選。"""
        catalog: list[dict[str, Any]] = []
        for row in self.daily_timeline:
            catalog.append(
                {
                    "id": row["id"],
                    "field": "daily_timeline",
                    "date": row.get("date"),
                    "value": {
                        key: row.get(key)
                        for key in ("close", "chg_pct", "vol_lots", "vol_vs_ma5_pct", "foreign_net_lots")
                        if row.get(key) is not None
                    },
                }
            )
        catalog.extend(self.chip_summary)
        catalog.extend(self.long_term_anchor)
        catalog.extend(self.fundamental)
        catalog.extend(self.news)
        return catalog

    def timeline_by_id(self) -> dict[str, dict[str, Any]]:
        return {row["id"]: row for row in self.daily_timeline}

    def timeline_by_date(self) -> dict[str, dict[str, Any]]:
        return {str(row.get("date")): row for row in self.daily_timeline}

    def known_percentages(self) -> set[float]:
        """payload 中真正以「百分比」為單位的值，供 key_days 文字對帳使用。

        只收百分比欄位。先前把 rsi5、kd_k、EPS、收盤價這類非百分比的數值也收進來，
        會讓「本益比 32.8」去驗證一句錯誤的「上漲 32.8%」——對帳等於白做。

        已知限制：中文用「上漲／下跌」表達正負而不是負號，所以這裡比對絕對值，
        無法分辨模型把跌 2.03% 寫成漲 2.03%。方向錯誤要靠 eval 人工抽查。
        """
        values: set[float] = set()

        def add(value: Any) -> None:
            number = _f(value)
            if number is not None:
                values.add(round(abs(number), 2))

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
    for key in ("yoy_last6", "last4q"):
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
    """把價量、籌碼、技術指標與新聞併成一條每日時間軸。

    price_rows 需包含視窗之前的資料，才能算出視窗第一天的漲跌幅。
    """
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
    """外資買賣超的多日累計。

    單日淨額看不出調節是否延續，LLM 又不該自己把時間軸上的十列加起來，
    所以在後端先算好。刻意從已組好的 timeline 取值而不是回頭讀 chip_rows，
    這樣累計數與模型看得到的每日數字必定對得起來。
    """
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
                    "date": as_of_date.isoformat(),
                    "value": _round(position, 1),
                }
            )
    else:
        missing.append("近一年高低點")

    latest_technical = technical_rows[-1] if technical_rows else None
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

    # 期別可能有缺漏；拿「上一筆現有資料」當上一季會把跨了兩季的比較標成 QoQ。
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
    # 資料表有少數負值的月營收（明顯是來源異常，營收不可能為負），一律視為缺值。
    published = [
        row
        for row in rows
        if _revenue_is_published(row.date, as_of_date) and (_f(row.revenue) or 0.0) > 0
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

    def yoy_for(period: tuple[int, int]) -> float | None:
        return _growth_pct(by_period.get(period), by_period.get((period[0] - 1, period[1])))

    # 同樣要確認是「真的上一個月」而不是「上一筆有資料的月份」。
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
            "pct_rank_1y": _pct_rank(history, value),
        }
        items.append({key: entry for key, entry in item.items() if entry is not None})
    return items


def build_fundamental(
    db: Session,
    *,
    symbol: str,
    as_of_date: date,
) -> tuple[list[dict[str, Any]], list[str]]:
    ids = _IdGen("fd")
    items: list[dict[str, Any]] = []
    missing: list[str] = []

    income_rows = get_financial_statements(
        db,
        symbol=symbol,
        statement="income",
        start_date=as_of_date - timedelta(days=FINANCIAL_LOOKBACK_DAYS),
        end_date=as_of_date,
    )
    eps_items = _eps_items(income_rows, as_of_date, ids)
    if eps_items:
        items.extend(eps_items)
    else:
        missing.append("每股盈餘與獲利率")

    revenue_rows = get_monthly_revenues(
        db,
        symbol=symbol,
        start_date=as_of_date - timedelta(days=REVENUE_LOOKBACK_DAYS),
        end_date=as_of_date + timedelta(days=31),
    )
    revenue_items = _revenue_items(revenue_rows, as_of_date, ids)
    if revenue_items:
        items.extend(revenue_items)
    else:
        missing.append("月營收")

    valuation_rows = get_valuations(
        db,
        symbol=symbol,
        start_date=as_of_date - timedelta(days=VALUATION_RANK_LOOKBACK_DAYS),
        end_date=as_of_date,
    )
    valuation_items = _valuation_items(valuation_rows, as_of_date, ids)
    if valuation_items:
        items.extend(valuation_items)
    else:
        missing.append("本益比與估值")
    return items, missing


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
        summary = " ".join(str(source.get("summary") or "").split())
        if summary_chars and len(summary) > summary_chars:
            summary = summary[:summary_chars] + "…"
        kind = source.get("kind")
        item = {
            "id": ids.next(),
            "field": "news",
            "date": timestamp.split("T", 1)[0] if timestamp else None,
            "kind": kind if kind in {"general", "guidance", "market"} else "general",
            "title": title,
            "value": summary or title,
        }
        items.append({key: value for key, value in item.items() if value is not None})
    return items


def collect_market_rows(
    db: Session,
    *,
    symbol: str,
    as_of_date: date,
) -> tuple[list[Any], list[Any], list[Any]]:
    long_start = as_of_date - timedelta(days=LONG_TERM_LOOKBACK_DAYS)
    price_rows = get_price_range(db, symbol=symbol, start_date=long_start, end_date=as_of_date)
    window_start = price_rows[-TIMELINE_TRADING_DAYS].date if len(price_rows) >= TIMELINE_TRADING_DAYS else long_start
    chip_rows = get_by_symbol_range(db, symbol=symbol, start_date=window_start, end_date=as_of_date)
    technical_rows = get_indicators(db, symbol=symbol, start_date=long_start, end_date=as_of_date)
    return price_rows, chip_rows, technical_rows


def build_evidence_bundle(
    db: Session,
    *,
    symbol: str,
    as_of_date: date,
    news_sources: Sequence[dict[str, Any]],
    news_summary_chars: int | None,
    rag_fallback_mode: bool = False,
) -> EvidenceBundle:
    price_rows, chip_rows, technical_rows = collect_market_rows(
        db, symbol=symbol, as_of_date=as_of_date
    )
    news = build_news_items(news_sources, summary_chars=news_summary_chars)
    timeline, timeline_missing = build_daily_timeline(
        price_rows=price_rows,
        chip_rows=chip_rows,
        technical_rows=technical_rows,
        news_items=news,
    )
    chip_summary, chip_missing = build_chip_summary(timeline=timeline)
    anchor, anchor_missing = build_long_term_anchor(
        price_rows=price_rows,
        technical_rows=technical_rows,
        as_of_date=as_of_date,
    )
    fundamental, fundamental_missing = build_fundamental(db, symbol=symbol, as_of_date=as_of_date)
    if not news:
        timeline_missing = [*timeline_missing, "近期新聞"]

    return EvidenceBundle(
        symbol=symbol,
        as_of_date=as_of_date,
        daily_timeline=timeline,
        chip_summary=chip_summary,
        long_term_anchor=anchor,
        fundamental=fundamental,
        news=news,
        missing_fields=list(
            dict.fromkeys([*timeline_missing, *chip_missing, *anchor_missing, *fundamental_missing])
        ),
        rag_fallback_mode=rag_fallback_mode,
    )
