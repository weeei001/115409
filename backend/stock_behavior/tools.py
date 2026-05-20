from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from models.daily_price import DailyPrice
from models.institutional_trade import InstitutionalTrade
from models.technical_indicator import TechnicalIndicator
from stock_behavior.policy import POLICY
from stock_behavior.rag_client import fetch_rag_news
from stock_behavior.serializers import (
    serialize_chip_window_rows,
    serialize_price_window_rows,
    serialize_technical_window_rows,
)
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

    def _consume_call(self, tool_name: str, payload: dict[str, Any]) -> None:
        self._tool_calls += 1
        if self._tool_calls > POLICY.max_tool_calls_per_request:
            raise PolicyViolationError("tool call count exceeded policy limit")
        trace = {"tool": tool_name, "input": payload}
        self.tool_trace.append(trace)

    def get_price_volume_window(self, *, symbol: str, start_date: date, end_date: date) -> dict[str, Any]:
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
        return serialize_price_window_rows(rows, start_date=start_date, end_date=end_date)

    def get_chip_window(self, *, symbol: str, start_date: date, end_date: date) -> dict[str, Any]:
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
        return serialize_chip_window_rows(rows, start_date=start_date, end_date=end_date)

    def get_technical_window(self, *, symbol: str, start_date: date, end_date: date) -> dict[str, Any]:
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
        return serialize_technical_window_rows(rows, start_date=start_date, end_date=end_date)

    async def get_rag_news(
        self,
        *,
        symbol: str,
        as_of_date: date,
        lookback_days: int,
        max_events: int,
    ) -> dict[str, Any]:
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
        return output

    def save_stock_analysis_result(
        self,
        *,
        symbol: str,
        as_of_date: date,
        analysis_type: str,
        result: dict[str, Any],
        evidence_payload: dict[str, Any],
    ) -> dict[str, Any]:
        payload = {
            "symbol": symbol,
            "as_of_date": as_of_date.isoformat(),
            "analysis_type": analysis_type,
        }
        self._consume_call("save_stock_analysis_result", payload)
        return {"saved": False, "id": None, "evidence_hash": None}
