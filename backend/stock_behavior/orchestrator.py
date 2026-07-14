from __future__ import annotations

import hashlib
import json
from datetime import date, timedelta
from time import perf_counter
from typing import Any

from pydantic import ValidationError
from sqlalchemy.orm import Session

from crud.analysis_snapshot import create_snapshot
from crud.daily_price import get_price_range
from crud.institutional_trade import get_by_symbol_range
from crud.technical_indicator import get_indicators
from schemas.stock_behavior import (
    StockBehaviorAiProjection,
    StockBehaviorAiResponse,
    StockBehaviorAiRequest,
    StockBehaviorAnalysisPayload,
    StockBehaviorDataInventory,
    StockBehaviorRagRequest,
    StockBehaviorRagResponse,
    SCENARIO_PROJECTION_DAYS,
)
from stock_behavior.llm import (
    LLM_MAX_COMPLETION_TOKENS,
    LLM_TIMEOUT_SECONDS,
    StockBehaviorLlmService,
)
from stock_behavior.normalizer import (
    FALLBACK_SUMMARY,
    build_stock_behavior_analysis_fallback,
    normalize_llm_analysis_payload,
)
from stock_behavior.prompt_templates import PROMPT_VERSION
from stock_behavior.tools import (
    ToolExecutor,
    serialize_chip_window_rows,
    serialize_price_window_rows,
    serialize_technical_window_rows,
)
from stock_behavior.utils import PolicyViolationError


MAX_LLM_RAW_ANSWER_CHARS = 2000
MAX_LLM_NEWS_SOURCES = 5
AI_ANALYSIS_WINDOW_DAYS = 120
AI_DEFAULT_HORIZON_DAYS = 40
AI_DEFAULT_LANGUAGE = "zh-TW"
RAG_DEFAULT_NEWS_LOOKBACK_DAYS = 30
RAG_DEFAULT_MAX_NEWS_EVENTS = 5


def _analysis_window(as_of_date: date, lookback_days: int) -> tuple[date, date]:
    return as_of_date - timedelta(days=lookback_days), as_of_date


class StockBehaviorOrchestrator:
    def __init__(self, *, db: Session, settings: Any) -> None:
        self._db = db
        self._settings = settings
        self._llm = StockBehaviorLlmService(settings)

    @staticmethod
    def _prepare_rag_request_context(req: StockBehaviorRagRequest) -> str:
        symbols = [symbol.strip().upper() for symbol in req.symbols if symbol and symbol.strip()]
        if not symbols:
            raise PolicyViolationError("symbols must contain at least one non-empty symbol")
        return symbols[0]

    def _new_executor(self) -> ToolExecutor:
        return ToolExecutor(
            settings=self._settings,
        )

    @staticmethod
    def _latest_row(window_payload: dict[str, Any]) -> dict[str, Any]:
        rows = window_payload.get("data")
        if not isinstance(rows, list) or not rows:
            return {}
        latest = rows[-1]
        return latest if isinstance(latest, dict) else {}

    @staticmethod
    def _value_present(value: Any) -> bool:
        return value is not None and value != ""

    @staticmethod
    def _date_part(value: Any) -> str | None:
        if not value:
            return None
        return str(value).split("T", 1)[0]

    @classmethod
    def _streak_days(cls, rows: list[Any], field: str) -> int | None:
        if not rows:
            return None
        latest = rows[-1] if isinstance(rows[-1], dict) else {}
        latest_value = latest.get(field) if isinstance(latest, dict) else None
        if not isinstance(latest_value, (int, float)) or latest_value == 0:
            return None

        direction = 1 if latest_value > 0 else -1
        streak = 0
        for row in reversed(rows):
            if not isinstance(row, dict):
                break
            value = row.get(field)
            if not isinstance(value, (int, float)) or value == 0:
                break
            if (value > 0 and direction > 0) or (value < 0 and direction < 0):
                streak += 1
                continue
            break
        return streak or None

    @staticmethod
    def _recent_numeric_values(rows: list[Any], field: str, periods: int) -> list[float] | None:
        recent_rows = [row for row in rows if isinstance(row, dict)][-periods:]
        if len(recent_rows) < periods:
            return None
        values: list[float] = []
        for row in recent_rows:
            value = row.get(field)
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                return None
            values.append(float(value))
        return values

    @classmethod
    def _recent_sum(cls, rows: list[Any], field: str, periods: int) -> float | None:
        values = cls._recent_numeric_values(rows, field, periods)
        if values is None:
            return None
        return sum(values)

    @classmethod
    def _recent_average(cls, rows: list[Any], field: str, periods: int) -> float | None:
        values = cls._recent_numeric_values(rows, field, periods)
        if values is None:
            return None
        return sum(values) / periods

    @classmethod
    def _build_data_inventory(
        cls,
        *,
        llm_evidence: dict[str, Any],
        rag_news: dict[str, Any],
    ) -> dict[str, Any]:
        price_window = llm_evidence.get("price_window") if isinstance(llm_evidence.get("price_window"), dict) else {}
        chip_window = llm_evidence.get("chip_window") if isinstance(llm_evidence.get("chip_window"), dict) else {}
        technical_window = (
            llm_evidence.get("technical_window") if isinstance(llm_evidence.get("technical_window"), dict) else {}
        )

        price_latest = cls._latest_row(price_window)
        chip_latest = cls._latest_row(chip_window)
        technical_latest = cls._latest_row(technical_window)
        price_rows = price_window.get("data") if isinstance(price_window.get("data"), list) else []
        chip_rows = chip_window.get("data") if isinstance(chip_window.get("data"), list) else []

        missing_fields: list[str] = []
        price_volume: list[dict[str, Any]] = []
        chip: list[dict[str, Any]] = []
        technical: list[dict[str, Any]] = []
        news: list[dict[str, Any]] = []

        def add_item(
            bucket: list[dict[str, Any]],
            *,
            prefix: str,
            field: str,
            date_value: Any,
            value: Any,
            streak_days: int | None = None,
            reference_only: bool | None = None,
            record_missing: bool = True,
        ) -> None:
            if not cls._value_present(value):
                if record_missing:
                    missing_fields.append(field)
                return
            item: dict[str, Any] = {
                "id": f"{prefix}_{len(bucket) + 1:02d}",
                "field": field,
                "date": cls._date_part(date_value),
                "value": value,
            }
            if streak_days is not None:
                item["streak_days"] = streak_days
            if reference_only is not None:
                item["reference_only"] = reference_only
            bucket.append(item)

        price_date = price_latest.get("date") or technical_latest.get("date")
        add_item(
            price_volume,
            prefix="pv",
            field="close",
            date_value=price_date,
            value=price_latest.get("close"),
        )
        add_item(
            price_volume,
            prefix="pv",
            field="volume_shares",
            date_value=price_date,
            value=price_latest.get("volume_shares"),
        )
        add_item(
            price_volume,
            prefix="pv",
            field="volume_ma5",
            date_value=technical_latest.get("date") or price_date,
            value=technical_latest.get("volume_ma5"),
        )
        volume_ma20 = cls._recent_average(price_rows, "volume_shares", 20)
        if volume_ma20 is None:
            missing_fields.append("volume_ma20")
        else:
            add_item(
                price_volume,
                prefix="pv",
                field="volume_ma20",
                date_value=price_date,
                value=round(volume_ma20, 2),
            )

        chip_date = chip_latest.get("date")
        add_item(
            chip,
            prefix="ch",
            field="foreign_net",
            date_value=chip_date,
            value=chip_latest.get("foreign_net"),
            streak_days=cls._streak_days(chip_rows, "foreign_net"),
        )
        foreign_net_10d_sum = cls._recent_sum(chip_rows, "foreign_net", 10)
        if foreign_net_10d_sum is None:
            missing_fields.append("foreign_net 近 10 日累計")
        else:
            add_item(
                chip,
                prefix="ch",
                field="foreign_net_10d_sum",
                date_value=chip_date,
                value=int(foreign_net_10d_sum),
            )
        add_item(
            chip,
            prefix="ch",
            field="trust_net",
            date_value=chip_date,
            value=chip_latest.get("investment_trust_net"),
            streak_days=cls._streak_days(chip_rows, "investment_trust_net"),
        )
        add_item(
            chip,
            prefix="ch",
            field="dealer_net",
            date_value=chip_date,
            value=chip_latest.get("dealer_net"),
            streak_days=cls._streak_days(chip_rows, "dealer_net"),
        )

        technical_date = technical_latest.get("date")
        technical_fields = [
            ("rsi_5", "rsi5", True),
            ("kd_k", "kd_k9", True),
            ("macd_diff", "macd_dif", True),
            ("macd_histogram", "macd_hist", False),
            ("ma20", "ma20", True),
            ("ma60", "ma60", True),
            ("boll_mid20", "boll_mid20", False),
            ("boll_upper20", "boll_upper20", False),
            ("boll_lower20", "boll_lower20", False),
        ]
        for public_field, source_field, record_missing in technical_fields:
            add_item(
                technical,
                prefix="tc",
                field=public_field,
                date_value=technical_date,
                value=technical_latest.get(source_field),
                record_missing=record_missing,
            )

        news_sources = rag_news.get("news_sources") if isinstance(rag_news.get("news_sources"), list) else []
        for source in news_sources:
            if not isinstance(source, dict):
                continue
            title = source.get("title") or source.get("summary")
            if not cls._value_present(title):
                continue
            news.append(
                {
                    "id": f"nw_{len(news) + 1:02d}",
                    "field": "title",
                    "date": cls._date_part(source.get("timestamp")),
                    "value": title,
                    "reference_only": True,
                }
            )

        if not any(item["field"] == "boll_upper20" for item in technical) or not any(
            item["field"] == "boll_lower20" for item in technical
        ):
            missing_fields.append("布林通道上下軌")

        return {
            "price_volume": price_volume,
            "chip": chip,
            "technical": technical,
            "news": news,
            "missing_fields": list(dict.fromkeys(missing_fields)),
        }

    @staticmethod
    def _inventory_ids(data_inventory: dict[str, Any]) -> set[str]:
        ids: set[str] = set()
        for key in ("price_volume", "chip", "technical", "news"):
            items = data_inventory.get(key)
            if not isinstance(items, list):
                continue
            for item in items:
                if isinstance(item, dict) and isinstance(item.get("id"), str):
                    ids.add(item["id"])
        return ids

    @staticmethod
    def _inventory_value(data_inventory: dict[str, Any], field: str) -> Any:
        for key in ("price_volume", "chip", "technical"):
            items = data_inventory.get(key)
            if not isinstance(items, list):
                continue
            for item in items:
                if isinstance(item, dict) and item.get("field") == field:
                    return item.get("value")
        return None

    @staticmethod
    def _to_positive_float(value: Any) -> float | None:
        if isinstance(value, bool):
            return None
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            return None
        return parsed if parsed >= 0 else None

    @classmethod
    def _fill_projection_point_price(cls, point: dict[str, Any], *, base_close: Any) -> dict[str, Any]:
        if cls._to_positive_float(point.get("predicted_close")) is not None:
            return point

        base_close_value = cls._to_positive_float(base_close)
        if base_close_value is None:
            return point

        relative_price = cls._to_positive_float(point.get("relative_price")) or 1.0
        return {
            **point,
            "predicted_close": round(base_close_value * relative_price, 2),
        }

    @classmethod
    def _fill_projection_point_volume(cls, point: dict[str, Any], *, base_volume: Any) -> dict[str, Any]:
        if cls._to_positive_float(point.get("predicted_volume")) is not None:
            return point

        base_volume_value = cls._to_positive_float(base_volume)
        if base_volume_value is None:
            return point

        direction = str(point.get("direction") or "uncertain").lower()
        factor = 1.1 if direction in {"up", "down"} else 0.9
        return {
            **point,
            "predicted_volume": float(round(base_volume_value * factor)),
        }

    @classmethod
    def _build_public_projection(
        cls,
        *,
        validated: StockBehaviorAnalysisPayload,
        data_inventory: dict[str, Any],
        horizon_days: int,
    ) -> StockBehaviorAiProjection:
        allowed_ids = cls._inventory_ids(data_inventory)
        projection = validated.projection.model_dump(mode="python")
        base_close = cls._inventory_value(data_inventory, "close")
        base_volume = cls._inventory_value(data_inventory, "volume_ma5")
        if base_volume is None:
            base_volume = cls._inventory_value(data_inventory, "volume_shares")

        points = []
        for point in projection.get("points", []):
            point = cls._fill_projection_point_price(point, base_close=base_close)
            point = cls._fill_projection_point_volume(point, base_volume=base_volume)
            evidence_ids = [
                evidence_id
                for evidence_id in point.get("evidence_ids", [])
                if evidence_id in allowed_ids
            ]
            point = {**point, "evidence_ids": evidence_ids}
            points.append(point)

        return StockBehaviorAiProjection.model_validate(
            {
                "horizon_days": projection.get("horizon_days") or horizon_days,
                "scenario_key": projection.get("scenario_key") or "primary",
                "base_close": base_close,
                "base_volume": base_volume,
                "points": points,
            }
        )

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
            "price_window": serialize_price_window_rows(
                price_rows,
                start_date=window_start,
                end_date=window_end,
            ),
            "chip_window": serialize_chip_window_rows(
                chip_rows,
                start_date=window_start,
                end_date=window_end,
            ),
            "technical_window": serialize_technical_window_rows(
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
        as_of: date | None = None,
        lookback_days: int = RAG_DEFAULT_NEWS_LOOKBACK_DAYS,
    ) -> dict[str, Any]:
        rag_news = await executor.get_rag_news(
            symbol=symbol,
            lookback_days=lookback_days,
            max_events=RAG_DEFAULT_MAX_NEWS_EVENTS,
            as_of=as_of,
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

    async def collect_rag_news(self, req: StockBehaviorRagRequest) -> StockBehaviorRagResponse:
        symbol = self._prepare_rag_request_context(req)
        executor = self._new_executor()
        rag = await self._collect_rag_news_with_executor(
            executor=executor,
            symbol=symbol,
            as_of=req.as_of_date,
            lookback_days=req.lookback_days or RAG_DEFAULT_NEWS_LOOKBACK_DAYS,
        )
        return StockBehaviorRagResponse.model_validate(rag["rag_news"])

    async def generate_llm_analysis(self, req: StockBehaviorAiRequest) -> StockBehaviorAiResponse:
        symbol = req.symbol.strip().upper()
        today = date.today()
        as_of_date = req.as_of_date or today
        as_of_date_text = as_of_date.isoformat()
        llm_evidence = self._collect_llm_evidence_from_crud(
            symbol=symbol,
            as_of_date=as_of_date,
            lookback_days=AI_ANALYSIS_WINDOW_DAYS,
        )
        rag_news = self._build_client_rag_news_payload(req)
        if not rag_news.get("news_sources") and not rag_news.get("raw_answer"):
            rag_news = self._empty_rag_news_payload()
        data_inventory = self._build_data_inventory(
            llm_evidence=llm_evidence,
            rag_news=rag_news,
        )

        task_packet = self._build_llm_task_packet(
            {
                "task": {
                    "type": "stock_behavior_evidence_projection",
                    "symbol": symbol,
                    "as_of_date": as_of_date_text,
                    "horizon_days": AI_DEFAULT_HORIZON_DAYS,
                    "recent_lookback_days": AI_ANALYSIS_WINDOW_DAYS,
                    "analysis_language": AI_DEFAULT_LANGUAGE,
                },
                "price_window": llm_evidence["price_window"],
                "chip_window": llm_evidence["chip_window"],
                "technical_window": llm_evidence["technical_window"],
                "rag_news": rag_news,
                "data_inventory": data_inventory,
                "reference_materials": rag_news.get("reference_materials", {}),
                "analysis_mode": "prefetched_db_and_client_rag_projection",
            }
        )

        llm_started_at = perf_counter()
        try:
            raw_llm_response, raw_llm_text = await self._llm.generate_analysis_from_evidence(
                task_packet=task_packet
            )
        except RuntimeError as exc:
            raise PolicyViolationError(
                "LLM analysis failed",
                code="llm_analysis_failed",
                context={
                    "symbol": symbol,
                    "as_of_date": as_of_date_text,
                    "reason": str(exc),
                },
            ) from exc
        latency_ms = round((perf_counter() - llm_started_at) * 1000)

        normalized_llm_response: dict[str, Any] = {}
        is_fallback = False
        try:
            normalized_llm_response = normalize_llm_analysis_payload(
                raw_llm_response,
                horizon_days=AI_DEFAULT_HORIZON_DAYS,
            )
            validated = StockBehaviorAnalysisPayload.model_validate(normalized_llm_response)
        except ValidationError as exc:
            is_fallback = True
            formatted_errors = self._format_validation_errors(exc)
            fallback_payload = build_stock_behavior_analysis_fallback(
                f"LLM 分析結構驗證失敗：{formatted_errors}",
                horizon_days=AI_DEFAULT_HORIZON_DAYS,
            )
            if isinstance(normalized_llm_response.get("projection"), dict):
                fallback_payload["projection"] = normalized_llm_response["projection"]
            validated = StockBehaviorAnalysisPayload.model_validate(fallback_payload)

        if validated.summary == FALLBACK_SUMMARY:
            is_fallback = True

        public_projection = self._build_public_projection(
            validated=validated,
            data_inventory=data_inventory,
            horizon_days=AI_DEFAULT_HORIZON_DAYS,
        )
        response = StockBehaviorAiResponse(
            symbol=symbol,
            as_of_date=as_of_date_text,
            generated_by=getattr(self._llm, "model_name", self._settings.ADVISOR_LLM_MODEL or ""),
            summary=validated.summary,
            data_inventory=StockBehaviorDataInventory.model_validate(data_inventory),
            projection=public_projection,
        )

        model_name = getattr(
            self._llm,
            "model_name",
            self._settings.ADVISOR_LLM_MODEL or "",
        )
        config = {
            "window_days": AI_ANALYSIS_WINDOW_DAYS,
            "horizon_days": AI_DEFAULT_HORIZON_DAYS,
            "projection_days": SCENARIO_PROJECTION_DAYS,
            "rag_lookback_days": RAG_DEFAULT_NEWS_LOOKBACK_DAYS,
            "rag_max_events": RAG_DEFAULT_MAX_NEWS_EVENTS,
            "max_llm_news_sources": MAX_LLM_NEWS_SOURCES,
            "model_name": model_name,
            "temperature": getattr(self._settings, "ADVISOR_LLM_TEMPERATURE", 0.2),
            "max_completion_tokens": LLM_MAX_COMPLETION_TOKENS,
            "prompt_version": PROMPT_VERSION,
            "llm_timeout_seconds": LLM_TIMEOUT_SECONDS,
        }
        config_json = json.dumps(config, ensure_ascii=False, sort_keys=True)
        try:
            create_snapshot(
                self._db,
                symbol=symbol,
                as_of_date=as_of_date,
                run_kind=(
                    "backtest"
                    if req.as_of_date is not None and req.as_of_date < today
                    else "live"
                ),
                config_hash=hashlib.sha256(config_json.encode("utf-8")).hexdigest(),
                config_json=config_json,
                model_name=model_name,
                prompt_version=PROMPT_VERSION,
                is_fallback=is_fallback,
                rag_fallback_mode=bool(rag_news.get("fallback_mode", False)),
                news_count=len(rag_news.get("news_sources", [])),
                base_close=public_projection.base_close,
                base_volume=public_projection.base_volume,
                summary=validated.summary,
                news_sources_json=json.dumps(
                    rag_news.get("news_sources", []), ensure_ascii=False, default=str
                ),
                data_inventory_json=json.dumps(data_inventory, ensure_ascii=False, default=str),
                normalized_payload_json=json.dumps(
                    validated.model_dump(mode="json"), ensure_ascii=False
                ),
                public_projection_json=json.dumps(
                    public_projection.model_dump(mode="json"), ensure_ascii=False
                ),
                task_packet_json=json.dumps(task_packet, ensure_ascii=False, default=str),
                raw_llm_text=raw_llm_text,
                latency_ms=latency_ms,
            )
        except Exception as exc:
            print(f"[stock_behavior_snapshot] status=fail symbol={symbol} error={exc}")
            self._db.rollback()

        return response
