"""What the model sees on a decision day: an anonymized snapshot, plus the signal evidence for one group.

The stock code, name and calendar dates are left out and prices are indexed to 100, which makes it harder
for the model to recall what really happened next, though that cannot be ruled out; days are counted
relative to the decision day (t = 0).
"""
from __future__ import annotations

from datetime import date
from typing import Any

from app.features.signals.detection import Day
from app.features.signals.schemas import PeriodStats, SignalEvidenceItem

SNAPSHOT_DAYS = 20
REVENUE_MONTHS = 3

SYSTEM_PROMPT = """
你在協助一項台股研究回測。payload 是一檔匿名股票到判斷日（t=0）收盤為止的資料：沒有股票名稱與日期，價格換成以第一天為 100 的指數。
不要猜測是哪一檔股票或哪一段時間，也不要使用對任何股票後續走勢的記憶；只根據 payload 判斷。
判斷這檔股票接下來 5 個交易日的方向，stance 只能是：
bullish（偏多，證據明確且一致）、mildly_bullish（溫和偏多）、neutral（中性或證據互相抵銷）、mildly_bearish（溫和偏空）、bearish（偏空，證據明確且一致）。
這是研究用的方向判斷，持股比例由固定規則換算，不要寫買賣、加減碼或價位建議。
reason 用台灣繁體中文一到兩句，最多 120 字，說明最主要的依據與最大的反向訊號。
欄位說明：close 價格指數；chg_pct 當日漲跌（%）；vs_ma20_pct、vs_ma60_pct 收盤相對 20、60 日均線（%）；vol_vs_ma5_pct 成交量相對 5 日均量（%）；
kd_k、kd_d 九日 KD；macd_hist_pct MACD 柱狀體除以收盤（%）；foreign、trust 外資、投信當日買超 1、賣超 -1、持平 0；
revenue_yoy_pct 判斷日已經公布的最近幾個月營收年增率（%），m=0 是最近一個已公布的月份。
""".strip()

SIGNALS_ADDENDUM = """
signal_evidence 是判斷日當天已經知道結果的訊號統計：signals 是最近成立、觀察期還沒走完的訊號，all_stocks 是股票清單全部股票過去的表現，
this_stock 是這檔股票自己的過去表現，edge_vs_baseline_pct 是比任一天進場高或低的百分點，baseline 是任一天進場。
可以參考也可以不採用；all_stocks.events 少於 30 的統計不穩定。實際用到的訊號把 id 放進 evidence_ids，沒用到就留空陣列。
""".strip()


def _pct(value: float | None, base: float | None) -> float | None:
    return None if value is None or not base else round((value / base - 1) * 100, 2)


def _sign(value: float | None) -> int | None:
    return None if value is None else (value > 0) - (value < 0)


def snapshot(days: list[Day], index: int, revenue: list[tuple[int, date, float | None]]) -> dict[str, Any]:
    window = days[max(0, index - SNAPSHOT_DAYS + 1):index + 1]
    base = window[0].close
    rows = []
    for offset, day in enumerate(window):
        position = index - len(window) + 1 + offset
        previous = days[position - 1] if position > 0 else None
        row = {
            "t": position - index, "close": round(day.close / base * 100, 2),
            "chg_pct": _pct(day.close, previous.close if previous else None),
            "vs_ma20_pct": _pct(day.close, day.ma20), "vs_ma60_pct": _pct(day.close, day.ma60),
            "vol_vs_ma5_pct": _pct(day.volume, day.volume_ma5),
            "kd_k": None if day.kd_k is None else round(day.kd_k, 1),
            "kd_d": None if day.kd_d is None else round(day.kd_d, 1),
            "macd_hist_pct": None if day.macd_hist is None else round(day.macd_hist / day.close * 100, 3),
            "foreign": _sign(day.foreign_net), "trust": _sign(day.trust_net),
        }
        rows.append({key: value for key, value in row.items() if value is not None})
    # Only months already published by the decision day; their calendar month is left out like every other date.
    published = [yoy for _, available, yoy in revenue if available <= days[index].date][-REVENUE_MONTHS:]
    return {
        "task": {"decision_day": "t=0", "horizon_trading_days": 5, "anonymized": True},
        "daily": rows,
        "revenue_yoy_pct": [{"m": offset - len(published) + 1, "yoy": None if yoy is None else round(yoy, 1)}
                            for offset, yoy in enumerate(published)],
    }


def _stats(stats: PeriodStats) -> dict[str, Any]:
    return stats.model_dump(exclude_none=True, exclude={"net_return_pct"})


def with_evidence(payload: dict[str, Any], baseline: PeriodStats, evidence: list[SignalEvidenceItem]) -> dict[str, Any]:
    return {**payload, "signal_evidence": {
        "horizon_trading_days": 5, "baseline": _stats(baseline),
        "signals": [{"id": item.id, "label": item.label, "definition": item.definition, "reading": item.reading,
                     "trading_days_ago": item.trading_days_ago, "all_stocks": _stats(item.all_stocks),
                     "this_stock": _stats(item.this_stock), "edge_vs_baseline_pct": item.edge_vs_baseline_pct}
                    for item in evidence],
    }}
