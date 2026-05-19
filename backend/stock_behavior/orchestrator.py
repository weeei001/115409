from __future__ import annotations

import uuid
from datetime import date, timedelta
from typing import Any

from pydantic import ValidationError
from sqlalchemy.orm import Session

from crud.daily_price import get_price_range
from crud.institutional_trade import get_by_symbol_range
from crud.technical_indicator import get_indicators
from schemas.stock_behavior import (
    SCENARIO_PROJECTION_DAYS,
    StockBehaviorAiResponse,
    StockBehaviorAiRequest,
    StockBehaviorAnalysisPayload,
    StockBehaviorAnalyzeRequest,
    StockBehaviorBasicResponse,
    StockBehaviorPublicAnalysisPayload,
    StockBehaviorRagRequest,
    StockBehaviorRagResponse,
)
from stock_behavior.llm import StockBehaviorLlmService
from stock_behavior.normalizer import (
    build_stock_behavior_analysis_fallback,
    normalize_llm_analysis_payload,
    normalize_projection_points,
)
from stock_behavior.tools import ToolExecutor
from stock_behavior.utils import PolicyViolationError, parse_date


CHART_HISTORY_LOOKBACK_DAYS = 365
MAX_LLM_RAW_ANSWER_CHARS = 4000
MAX_LLM_NEWS_SOURCES = 8
AI_ANALYSIS_WINDOW_DAYS = 90
AI_DEFAULT_HORIZON_DAYS = 40
AI_DEFAULT_RECENT_LOOKBACK_DAYS = 365
AI_DEFAULT_LANGUAGE = "zh-TW"
RAG_DEFAULT_NEWS_LOOKBACK_DAYS = 60
RAG_DEFAULT_MAX_NEWS_EVENTS = 10


def _analysis_window(as_of_date: date, lookback_days: int) -> tuple[date, date]:
    return as_of_date - timedelta(days=lookback_days), as_of_date


class StockBehaviorOrchestrator:
    def __init__(self, *, db: Session, settings: Any) -> None:
        self._db = db
        self._settings = settings
        self._llm = StockBehaviorLlmService(settings)

    @staticmethod
    def _prepare_request_context(req: StockBehaviorAnalyzeRequest) -> tuple[str, date]:
        symbol = req.symbol.strip().upper()
        as_of_date = parse_date(req.as_of_date)
        return symbol, as_of_date

    @staticmethod
    def _prepare_rag_request_context(req: StockBehaviorRagRequest) -> tuple[str, date]:
        symbols = [symbol.strip().upper() for symbol in req.symbols if symbol and symbol.strip()]
        if not symbols:
            raise PolicyViolationError("symbols must contain at least one non-empty symbol")
        return symbols[0], date.today()

    def _new_executor(self, *, symbol: str, as_of_date: date) -> ToolExecutor:
        return ToolExecutor(
            db=self._db,
            settings=self._settings,
            request_id=uuid.uuid4().hex,
            symbol=symbol,
            as_of_date=as_of_date,
        )

    @staticmethod
    def _to_float(value: Any) -> float | None:
        return float(value) if value is not None else None

    @staticmethod
    def _to_int(value: Any) -> int | None:
        return int(value) if value is not None else None

    @classmethod
    def _serialize_price_window_rows(
        cls,
        rows: list[Any],
        *,
        start_date: date,
        end_date: date,
    ) -> dict[str, Any]:
        data = [
            {
                "date": row.date.isoformat(),
                "open": cls._to_float(getattr(row, "open", None)),
                "high": cls._to_float(getattr(row, "high", None)),
                "low": cls._to_float(getattr(row, "low", None)),
                "close": cls._to_float(getattr(row, "close", None)),
                "volume_shares": cls._to_int(getattr(row, "volume_shares", None)),
                "amount": cls._to_int(getattr(row, "amount", None)),
                "change": cls._to_float(getattr(row, "change", None)),
            }
            for row in rows
        ]
        return {
            "window": f"{start_date.isoformat()}~{end_date.isoformat()}",
            "data": data,
            "count": len(data),
        }

    @classmethod
    def _serialize_chip_window_rows(
        cls,
        rows: list[Any],
        *,
        start_date: date,
        end_date: date,
    ) -> dict[str, Any]:
        data = [
            {
                "date": row.date.isoformat(),
                "foreign_buy": cls._to_int(getattr(row, "foreign_buy", None) or 0),
                "foreign_sell": cls._to_int(getattr(row, "foreign_sell", None) or 0),
                "foreign_net": cls._to_int(getattr(row, "foreign_net", None) or 0),
                "investment_trust_buy": cls._to_int(getattr(row, "investment_trust_buy", None) or 0),
                "investment_trust_sell": cls._to_int(getattr(row, "investment_trust_sell", None) or 0),
                "investment_trust_net": cls._to_int(getattr(row, "investment_trust_net", None) or 0),
                "dealer_buy": cls._to_int(getattr(row, "dealer_buy", None) or 0),
                "dealer_sell": cls._to_int(getattr(row, "dealer_sell", None) or 0),
                "dealer_net": cls._to_int(getattr(row, "dealer_net", None) or 0),
                "total_institutional_buy": cls._to_int(getattr(row, "total_institutional_buy", None) or 0),
                "total_institutional_sell": cls._to_int(getattr(row, "total_institutional_sell", None) or 0),
                "total_institutional_net": cls._to_int(getattr(row, "total_institutional_net", None) or 0),
            }
            for row in rows
        ]
        return {
            "window": f"{start_date.isoformat()}~{end_date.isoformat()}",
            "data": data,
            "count": len(data),
        }

    @classmethod
    def _serialize_technical_window_rows(
        cls,
        rows: list[Any],
        *,
        start_date: date,
        end_date: date,
    ) -> dict[str, Any]:
        data = [
            {
                "date": row.date.isoformat(),
                "close": cls._to_float(getattr(row, "close", None)),
                "ma5": cls._to_float(getattr(row, "ma5", None)),
                "ma10": cls._to_float(getattr(row, "ma10", None)),
                "ma20": cls._to_float(getattr(row, "ma20", None)),
                "ma60": cls._to_float(getattr(row, "ma60", None)),
                "ma120": cls._to_float(getattr(row, "ma120", None)),
                "ma240": cls._to_float(getattr(row, "ma240", None)),
                "rsi5": cls._to_float(getattr(row, "rsi5", None)),
                "rsi10": cls._to_float(getattr(row, "rsi10", None)),
                "rsv9": cls._to_float(getattr(row, "rsv9", None)),
                "kd_k9": cls._to_float(getattr(row, "kd_k9", None)),
                "kd_d9": cls._to_float(getattr(row, "kd_d9", None)),
                "kd_j9": cls._to_float(getattr(row, "kd_j9", None)),
                "ema12": cls._to_float(getattr(row, "ema12", None)),
                "ema26": cls._to_float(getattr(row, "ema26", None)),
                "macd_dif": cls._to_float(getattr(row, "macd_dif", None)),
                "macd_dea": cls._to_float(getattr(row, "macd_dea", None)),
                "macd_signal": cls._to_float(getattr(row, "macd_signal", None)),
                "macd_hist": cls._to_float(getattr(row, "macd_hist", None)),
                "boll_mid20": cls._to_float(getattr(row, "boll_mid20", None)),
                "boll_upper20": cls._to_float(getattr(row, "boll_upper20", None)),
                "boll_lower20": cls._to_float(getattr(row, "boll_lower20", None)),
                "volume_ma5": cls._to_float(getattr(row, "volume_ma5", None)),
            }
            for row in rows
        ]
        return {
            "window": f"{start_date.isoformat()}~{end_date.isoformat()}",
            "data": data,
            "count": len(data),
        }

    @staticmethod
    def _format_validation_errors(exc: ValidationError) -> str:
        return "; ".join(
            f"{'.'.join(str(part) for part in error['loc'])}: {error['msg']}"
            for error in exc.errors()
        )

    @staticmethod
    def _build_llm_task_packet(payload: dict[str, Any]) -> dict[str, Any]:
        for window_key in ("price_window", "chip_window", "technical_window"):
            window_payload = payload.get(window_key)
            if not isinstance(window_payload, dict):
                continue
            rows = window_payload.get("data")
            if isinstance(rows, list):
                trimmed_rows = rows[-AI_ANALYSIS_WINDOW_DAYS:]
                window_payload["data"] = trimmed_rows
                window_payload["count"] = len(trimmed_rows)

        rag_news = payload.get("rag_news")
        if isinstance(rag_news, dict):
            news_sources = rag_news.get("news_sources")
            if isinstance(news_sources, list):
                rag_news["news_sources"] = news_sources[:MAX_LLM_NEWS_SOURCES]
            raw_answer = rag_news.get("raw_answer")
            if isinstance(raw_answer, str):
                rag_news["raw_answer"] = raw_answer[:MAX_LLM_RAW_ANSWER_CHARS]
            reference_materials = rag_news.get("reference_materials")
            if isinstance(reference_materials, dict):
                rag_api_response = reference_materials.get("rag_api_response")
                if isinstance(rag_api_response, dict):
                    raw_answer = rag_api_response.get("raw_answer")
                    if isinstance(raw_answer, str):
                        rag_api_response["raw_answer"] = raw_answer[:MAX_LLM_RAW_ANSWER_CHARS]
                    news_sources = rag_api_response.get("news_sources")
                    if isinstance(news_sources, list):
                        rag_api_response["news_sources"] = news_sources[:MAX_LLM_NEWS_SOURCES]
        return payload

    @staticmethod
    def _normalize_projection_points(
        source_points: Any,
        *,
        fallback_reason: str,
    ) -> list[dict[str, Any]]:
        return normalize_projection_points(source_points, fallback_reason=fallback_reason)

    def _collect_basic_evidence_with_executor(
        self,
        *,
        req: StockBehaviorAnalyzeRequest,
        executor: ToolExecutor,
        symbol: str,
        as_of_date: date,
    ) -> dict[str, Any]:
        recent_start, recent_end = _analysis_window(as_of_date, req.recent_lookback_days)
        recent_evidence = {
            "price_window": executor.get_price_volume_window(
                symbol=symbol,
                start_date=recent_start,
                end_date=recent_end,
            ),
            "chip_window": executor.get_chip_window(
                symbol=symbol,
                start_date=recent_start,
                end_date=recent_end,
            ),
            "technical_window": executor.get_technical_window(
                symbol=symbol,
                start_date=recent_start,
                end_date=recent_end,
            ),
        }
        return {
            "stored_profile": {"profile": {}},
            "recent_evidence": recent_evidence,
        }

    @classmethod
    def _fallback_scenario_projection(
        cls,
        *,
        scenario_name: str,
        user_interpretation: str,
        source_points: Any,
        fallback_reason: str,
    ) -> dict[str, Any]:
        return {
            "scenario_key": "primary",
            "scenario_name": scenario_name,
            "scenario_role": "primary",
            "user_interpretation": user_interpretation,
            "trigger_conditions": ["資料不足，需等待價量、籌碼與技術證據補齊。"],
            "invalidation_conditions": ["後續資料與此情境假設不一致。"],
            "projection_points": cls._normalize_projection_points(
                source_points,
                fallback_reason=fallback_reason,
            ),
        }
    def _collect_llm_evidence_from_crud(
        self,
        *,
        symbol: str,
        as_of_date: date,
        lookback_days: int,
    ) -> dict[str, Any]:
        window_start, window_end = _analysis_window(as_of_date, lookback_days)
        price_rows = get_price_range(
            self._db,
            symbol=symbol,
            start_date=window_start,
            end_date=window_end,
        )
        chip_rows = get_by_symbol_range(
            self._db,
            symbol=symbol,
            start_date=window_start,
            end_date=window_end,
        )
        technical_rows = get_indicators(
            self._db,
            symbol=symbol,
            start_date=window_start,
            end_date=window_end,
        )
        return {
            "price_window": self._serialize_price_window_rows(
                price_rows,
                start_date=window_start,
                end_date=window_end,
            ),
            "chip_window": self._serialize_chip_window_rows(
                chip_rows,
                start_date=window_start,
                end_date=window_end,
            ),
            "technical_window": self._serialize_technical_window_rows(
                technical_rows,
                start_date=window_start,
                end_date=window_end,
            ),
        }

    async def _collect_rag_news_with_executor(
        self,
        *,
        executor: ToolExecutor,
        symbol: str,
        as_of_date: date,
    ) -> dict[str, Any]:
        rag_news = await executor.get_rag_news(
            symbol=symbol,
            as_of_date=as_of_date,
            lookback_days=RAG_DEFAULT_NEWS_LOOKBACK_DAYS,
            max_events=RAG_DEFAULT_MAX_NEWS_EVENTS,
        )
        return {
            "rag_news": rag_news,
        }

    @staticmethod
    def _empty_rag_news_payload() -> dict[str, Any]:
        return {
            "news_sources": [],
            "fallback_mode": False,
            "raw_answer": "",
            "raw_answer_usage": "reference_only",
            "reference_materials": {
                "rag_api_response": {
                    "fallback_mode": False,
                    "usage": "reference_only",
                    "raw_answer": "",
                    "news_sources": [],
                },
            },
        }

    @classmethod
    def _build_client_rag_news_payload(cls, req: StockBehaviorAiRequest) -> dict[str, Any]:
        news_sources = [item.model_dump(mode="python") for item in req.news_sources]
        return {
            "news_sources": news_sources,
            "fallback_mode": req.fallback_mode,
            "raw_answer": req.raw_answer,
            "raw_answer_usage": "reference_only",
            "reference_materials": {
                "rag_api_response": {
                    "usage": "reference_only",
                    "fallback_mode": req.fallback_mode,
                    "raw_answer": req.raw_answer,
                    "news_sources": news_sources,
                }
            },
        }

    async def collect_basic_evidence(self, req: StockBehaviorAnalyzeRequest) -> StockBehaviorBasicResponse:
        symbol, as_of_date = self._prepare_request_context(req)
        executor = self._new_executor(symbol=symbol, as_of_date=as_of_date)
        basic = self._collect_basic_evidence_with_executor(
            req=req,
            executor=executor,
            symbol=symbol,
            as_of_date=as_of_date,
        )
        return StockBehaviorBasicResponse(
            symbol=symbol,
            as_of_date=as_of_date.isoformat(),
            stored_behavior_profile=basic["stored_profile"].get("profile", {}),
            recent_evidence=basic["recent_evidence"],
        )

    async def collect_rag_news(self, req: StockBehaviorRagRequest) -> StockBehaviorRagResponse:
        symbol, as_of_date = self._prepare_rag_request_context(req)
        executor = self._new_executor(symbol=symbol, as_of_date=as_of_date)
        rag = await self._collect_rag_news_with_executor(
            executor=executor,
            symbol=symbol,
            as_of_date=as_of_date,
        )
        return StockBehaviorRagResponse.model_validate(rag["rag_news"])

    async def generate_llm_analysis(self, req: StockBehaviorAiRequest) -> StockBehaviorAiResponse:
        symbol = req.symbol.strip().upper()
        as_of_date = date.today()
        llm_evidence = self._collect_llm_evidence_from_crud(
            symbol=symbol,
            as_of_date=as_of_date,
            lookback_days=AI_ANALYSIS_WINDOW_DAYS,
        )
        rag_news = self._build_client_rag_news_payload(req)
        if not rag_news.get("news_sources") and not rag_news.get("raw_answer"):
            rag_news = self._empty_rag_news_payload()

        task_packet = self._build_llm_task_packet(
            {
                "task": {
                    "type": "llm_only_stock_behavior_analysis",
                    "symbol": symbol,
                    "as_of_date": as_of_date.isoformat(),
                    "horizon_days": AI_DEFAULT_HORIZON_DAYS,
                    "recent_lookback_days": AI_ANALYSIS_WINDOW_DAYS,
                    "analysis_language": AI_DEFAULT_LANGUAGE,
                },
                "price_window": llm_evidence["price_window"],
                "chip_window": llm_evidence["chip_window"],
                "technical_window": llm_evidence["technical_window"],
                "rag_news": rag_news,
                "reference_materials": rag_news.get("reference_materials", {}),
                "analysis_mode": "prefetched_db_with_client_rag",
            }
        )

        try:
            raw_llm_response = await self._llm.generate_analysis_from_evidence(task_packet=task_packet)
        except RuntimeError as exc:
            raise PolicyViolationError(
                "LLM analysis failed",
                code="llm_analysis_failed",
                context={
                    "symbol": symbol,
                    "as_of_date": as_of_date.isoformat(),
                    "reason": str(exc),
                },
            ) from exc

        try:
            normalized_llm_response = normalize_llm_analysis_payload(
                raw_llm_response,
                horizon_days=AI_DEFAULT_HORIZON_DAYS,
            )
            validated = StockBehaviorAnalysisPayload.model_validate(normalized_llm_response)
        except ValidationError as exc:
            formatted_errors = self._format_validation_errors(exc)
            fallback_payload = build_stock_behavior_analysis_fallback(
                f"LLM 分析結構驗證失敗：{formatted_errors}",
                horizon_days=AI_DEFAULT_HORIZON_DAYS,
            )
            validated = StockBehaviorAnalysisPayload.model_validate(fallback_payload)

        public_payload = StockBehaviorPublicAnalysisPayload.model_validate(
            validated.model_dump(mode="python")
        )
        return StockBehaviorAiResponse(
            symbol=symbol,
            as_of_date=as_of_date.isoformat(),
            llm_analysis=public_payload,
        )
