from __future__ import annotations

from datetime import date
from typing import Any, Dict, List

from sqlalchemy.orm import Session

from models.daily_price import DailyPrice
from models.institutional_trade import InstitutionalTrade
from models.technical_indicator import TechnicalIndicator
from stock_behavior.policy import POLICY
from stock_behavior.rag_client import fetch_rag_news
from stock_behavior.utils import PolicyViolationError, clamp_date_window


class ToolExecutor:
    def __init__(self, *, db: Session, settings: Any, request_id: str, symbol: str, as_of_date: date) -> None:
        self._db = db
        self._settings = settings
        self._request_id = request_id
        self._symbol = symbol
        self._as_of_date = as_of_date
        self._tool_calls = 0
        self.tool_trace: list[dict[str, Any]] = []

    def _ensure_symbol_allowed(self, symbol: str) -> None:
        if symbol not in POLICY.allowed_symbols:
            raise PolicyViolationError(f"symbol is not allowed by policy: {symbol}")

    def _consume_call(self, tool_name: str, payload: Dict[str, Any]) -> None:
        self._tool_calls += 1
        if self._tool_calls > POLICY.max_tool_calls_per_request:
            raise PolicyViolationError("tool call count exceeded policy limit")
        trace = {"tool": tool_name, "input": payload}
        self.tool_trace.append(trace)

    def _log_tool(self, tool_name: str, payload: Dict[str, Any], output: Dict[str, Any]) -> None:
        return None

    def get_price_volume_window(self, *, symbol: str, start_date: date, end_date: date) -> Dict[str, Any]:
        payload = {
            "symbol": symbol,
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
        }
        self._consume_call("get_price_volume_window", payload)
        self._ensure_symbol_allowed(symbol)
        start_date, end_date = clamp_date_window(start_date=start_date, end_date=end_date, as_of_date=self._as_of_date)
        rows = (
            self._db.query(DailyPrice)
            .filter(
                DailyPrice.symbol == symbol,
                DailyPrice.date >= start_date,
                DailyPrice.date <= end_date,
            )
            .order_by(DailyPrice.date)
            .all()
        )
        data = [
            {
                "date": row.date.isoformat(),
                "open": float(row.open) if row.open is not None else None,
                "high": float(row.high) if row.high is not None else None,
                "low": float(row.low) if row.low is not None else None,
                "close": float(row.close) if row.close is not None else None,
                "volume_shares": int(row.volume_shares) if row.volume_shares is not None else None,
                "amount": int(row.amount) if row.amount is not None else None,
                "change": float(row.change) if row.change is not None else None,
            }
            for row in rows
        ]
        output = {"window": f"{start_date.isoformat()}~{end_date.isoformat()}", "data": data, "count": len(data)}
        self._log_tool("get_price_volume_window", payload, output)
        return output

    def get_chip_window(self, *, symbol: str, start_date: date, end_date: date) -> Dict[str, Any]:
        payload = {
            "symbol": symbol,
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
        }
        self._consume_call("get_chip_window", payload)
        self._ensure_symbol_allowed(symbol)
        start_date, end_date = clamp_date_window(start_date=start_date, end_date=end_date, as_of_date=self._as_of_date)
        rows = (
            self._db.query(InstitutionalTrade)
            .filter(
                InstitutionalTrade.symbol == symbol,
                InstitutionalTrade.date >= start_date,
                InstitutionalTrade.date <= end_date,
            )
            .order_by(InstitutionalTrade.date)
            .all()
        )
        data = [
            {
                "date": row.date.isoformat(),
                "foreign_buy": int(row.foreign_buy or 0),
                "foreign_sell": int(row.foreign_sell or 0),
                "foreign_net": int(row.foreign_net or 0),
                "investment_trust_buy": int(row.investment_trust_buy or 0),
                "investment_trust_sell": int(row.investment_trust_sell or 0),
                "investment_trust_net": int(row.investment_trust_net or 0),
                "dealer_buy": int(row.dealer_buy or 0),
                "dealer_sell": int(row.dealer_sell or 0),
                "dealer_net": int(row.dealer_net or 0),
                "total_institutional_buy": int(row.total_institutional_buy or 0),
                "total_institutional_sell": int(row.total_institutional_sell or 0),
                "total_institutional_net": int(row.total_institutional_net or 0),
            }
            for row in rows
        ]
        output = {"window": f"{start_date.isoformat()}~{end_date.isoformat()}", "data": data, "count": len(data)}
        self._log_tool("get_chip_window", payload, output)
        return output

    def get_technical_window(self, *, symbol: str, start_date: date, end_date: date) -> Dict[str, Any]:
        payload = {
            "symbol": symbol,
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
        }
        self._consume_call("get_technical_window", payload)
        self._ensure_symbol_allowed(symbol)
        start_date, end_date = clamp_date_window(start_date=start_date, end_date=end_date, as_of_date=self._as_of_date)
        rows = (
            self._db.query(TechnicalIndicator)
            .filter(
                TechnicalIndicator.symbol == symbol,
                TechnicalIndicator.date >= start_date,
                TechnicalIndicator.date <= end_date,
            )
            .order_by(TechnicalIndicator.date)
            .all()
        )
        data = [
            {
                "date": row.date.isoformat(),
                "close": float(row.close) if row.close is not None else None,
                "ma5": float(row.ma5) if row.ma5 is not None else None,
                "ma10": float(row.ma10) if row.ma10 is not None else None,
                "ma20": float(row.ma20) if row.ma20 is not None else None,
                "ma60": float(row.ma60) if row.ma60 is not None else None,
                "ma120": float(row.ma120) if row.ma120 is not None else None,
                "ma240": float(row.ma240) if row.ma240 is not None else None,
                "rsi5": float(row.rsi5) if row.rsi5 is not None else None,
                "rsi10": float(row.rsi10) if row.rsi10 is not None else None,
                "rsv9": float(row.rsv9) if row.rsv9 is not None else None,
                "kd_k9": float(row.kd_k9) if row.kd_k9 is not None else None,
                "kd_d9": float(row.kd_d9) if row.kd_d9 is not None else None,
                "kd_j9": float(row.kd_j9) if row.kd_j9 is not None else None,
                "ema12": float(row.ema12) if row.ema12 is not None else None,
                "ema26": float(row.ema26) if row.ema26 is not None else None,
                "macd_dif": float(row.macd_dif) if row.macd_dif is not None else None,
                "macd_dea": float(row.macd_dea) if row.macd_dea is not None else None,
                "macd_signal": float(row.macd_signal) if row.macd_signal is not None else None,
                "macd_hist": float(row.macd_hist) if row.macd_hist is not None else None,
                "boll_mid20": float(row.boll_mid20) if row.boll_mid20 is not None else None,
                "boll_upper20": float(row.boll_upper20) if row.boll_upper20 is not None else None,
                "boll_lower20": float(row.boll_lower20) if row.boll_lower20 is not None else None,
                "volume_ma5": float(row.volume_ma5) if row.volume_ma5 is not None else None,
            }
            for row in rows
        ]
        output = {"window": f"{start_date.isoformat()}~{end_date.isoformat()}", "data": data, "count": len(data)}
        self._log_tool("get_technical_window", payload, output)
        return output

    async def get_rag_news(
        self,
        *,
        symbol: str,
        as_of_date: date,
        lookback_days: int,
        max_events: int,
    ) -> Dict[str, Any]:
        payload = {
            "symbol": symbol,
            "as_of_date": as_of_date.isoformat(),
            "lookback_days": lookback_days,
            "max_events": max_events,
        }
        self._consume_call("get_rag_news", payload)
        self._ensure_symbol_allowed(symbol)
        if lookback_days > POLICY.max_lookback_days_recent_analysis:
            raise PolicyViolationError("news lookback exceeds policy limit")
        if max_events > POLICY.max_news_events:
            raise PolicyViolationError("max news events exceeds policy limit")

        output = await fetch_rag_news(
            rag_api_url=self._settings.RAG_API_URL,
            rag_api_key=self._settings.RAG_API_KEY,
            symbol=symbol,
            as_of_date=as_of_date,
            lookback_days=lookback_days,
            max_events=max_events,
            timeout_seconds=self._settings.RAG_API_TIMEOUT,
        )
        output["count"] = len(output.get("news_sources", []))
        self._log_tool("get_rag_news", payload, output)
        return output

    def save_stock_analysis_result(
        self,
        *,
        symbol: str,
        as_of_date: date,
        analysis_type: str,
        result: Dict[str, Any],
        evidence_payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        payload = {
            "symbol": symbol,
            "as_of_date": as_of_date.isoformat(),
            "analysis_type": analysis_type,
        }
        self._consume_call("save_stock_analysis_result", payload)
        return {"saved": False, "id": None, "evidence_hash": None}
