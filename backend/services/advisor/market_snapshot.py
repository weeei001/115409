from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from agent.data_fetcher import fetch_db_data
from agent.schemas import ParsedIntent
from trend_core import MarketRow


def _to_date(value: Any) -> date | None:
    if isinstance(value, date):
        return value
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value).date()
        except ValueError:
            return None
    return None


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


class MarketSnapshotService:
    async def get_snapshot(
        self,
        *,
        symbol: str,
        as_of_date: date,
        lookback_days: int = 420,
    ) -> dict[str, Any]:
        normalized_symbol = symbol.strip().upper()
        if not normalized_symbol:
            raise ValueError("symbol 為必填")

        start_date = as_of_date - timedelta(days=max(90, lookback_days))
        intent = ParsedIntent(
            symbols=[normalized_symbol],
            date_start=start_date,
            date_end=as_of_date,
            original_query="",
        )
        data = await fetch_db_data(intent)

        prices = sorted(data.prices, key=lambda row: row.get("date") or "")
        indicators = sorted(data.indicators, key=lambda row: row.get("date") or "")
        institutional = sorted(data.institutional, key=lambda row: row.get("date") or "")

        indicator_map = {row.get("date"): row for row in indicators}
        institutional_map = {row.get("date"): row for row in institutional}

        market_rows: list[MarketRow] = []
        for price in prices:
            row_date = _to_date(price.get("date"))
            if row_date is None or row_date > as_of_date:
                continue
            close = _to_float(price.get("close"))
            if close is None:
                continue
            open_ = _to_float(price.get("open")) or close
            high = _to_float(price.get("high")) or close
            low = _to_float(price.get("low")) or close
            volume = _to_float(price.get("volume")) or 0.0

            ind = indicator_map.get(price.get("date")) or {}
            inst = institutional_map.get(price.get("date")) or {}
            market_rows.append(
                MarketRow(
                    date=row_date,
                    open=open_,
                    high=high,
                    low=low,
                    close=close,
                    volume=volume,
                    ma5=_to_float(ind.get("ma5")),
                    ma20=_to_float(ind.get("ma20")),
                    ma60=_to_float(ind.get("ma60")),
                    rsi14=_to_float(ind.get("rsi14")),
                    k_value=_to_float(ind.get("k_value")),
                    d_value=_to_float(ind.get("d_value")),
                    macd=_to_float(ind.get("macd")),
                    macd_signal=_to_float(ind.get("macd_signal")),
                    macd_hist=_to_float(ind.get("macd_hist")),
                    total_net=_to_float(inst.get("total_net")) or 0.0,
                    news_score=0.0,
                )
            )

        if len(market_rows) < 60:
            raise ValueError("可用市場資料不足，至少需要約 60 個交易日")

        latest_technical = indicators[-1] if indicators else {}
        latest_institutional = institutional[-1] if institutional else {}
        latest_price = prices[-1] if prices else {}

        return {
            "symbol": normalized_symbol,
            "as_of_date": as_of_date,
            "date_start": start_date,
            "date_end": as_of_date,
            "prices": prices,
            "indicators": indicators,
            "institutional": institutional,
            "market_rows": market_rows,
            "latest_price": latest_price,
            "latest_technical": latest_technical,
            "latest_institutional": latest_institutional,
        }

