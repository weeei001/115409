"""The deterministic analysis use case and its snapshot transaction boundary."""
from __future__ import annotations

import asyncio
import hashlib
import json
import math
import re
from datetime import date, datetime
from functools import lru_cache
from time import perf_counter
from typing import Any

import httpx
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.clients.llm import LlmClient
from app.features.retrieval.service import RetrievalService
from app.features.retrieval.common import STOCK_OPTIONS, TAIPEI
from app.core.errors import AppError, ServiceUnavailable
from app.db.models.llm_response import LlmResponse, LLM_RESPONSE_KIND_TEXT_BRIEF
from . import repository, validation as gate
from app.features.news.eligibility import contains_simulation
from .compliance import compliance_rules_signature
from .evidence import FIELD_GLOSSARY, TIMELINE_TRADING_DAYS, build_evidence_bundle
from .prompts import TEXT_BRIEF_SYSTEM_PROMPT, few_shot_examples, select_examples
from .prediction import (StrategyConfig, WeeklyPredictionOutput,
                         build_chart_payload, compute_weighted_regression,
                         generate_prediction, weekly_prompt)
from .schemas import (StockBehaviorRagRequest, StockBehaviorRagResponse, StockBehaviorTextBrief,
                      StockBehaviorTextBriefRequest, StockBehaviorTextBriefResponse, TextBriefDisclaimer,
                      TextBriefVerification)


ALLOWED_SYMBOLS = frozenset(STOCK_OPTIONS)
SIMPLIFIED_CHINESE_CHARS = frozenset(
    "门为说经开关证买卖风险机会亿万点涨势后头复资达预测币价业东个产众优体债"
    "仅从仓传伤伦伪侧侦兑兰兴冲决况净击则刚创删别剂务动劳华协单卫压历县叶号叹"
    "吗吨听启员响图场坏块坚坛坝壮声处备够夹夺奖妇妈孙学宁宝实审写导层岁师帐带"
    "帮库应废广庄庆异弃张弯归录当彻径忆怀态总恋恶惊惯戏户执扩扫扬扰护报担拟拣"
)


def detect_simplified_chinese(text: str) -> list[str]:
    return list(dict.fromkeys(char for char in text if char in SIMPLIFIED_CHINESE_CHARS))


def compute_config_hash(config: dict[str, Any]) -> str:
    canonical = json.dumps(config, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@lru_cache(maxsize=1)
def text_brief_revision() -> str:
    return compute_config_hash({"prompt": TEXT_BRIEF_SYSTEM_PROMPT,
                                "examples": few_shot_examples(),
                                "glossary": FIELD_GLOSSARY,
                                "compliance": compliance_rules_signature(),
                                "schema": StockBehaviorTextBrief.model_json_schema(),
                                "pipeline": "backend-v1-news-support-1"})[:12]


def build_llm_runtime_config(settings: Any, model_name: str) -> dict[str, Any]:
    return {"purpose": "production", "rag_lookback_days": gate.RAG_DEFAULT_NEWS_LOOKBACK_DAYS,
            "rag_max_events": gate.RAG_DEFAULT_MAX_NEWS_EVENTS,
            "max_llm_news_sources": gate.MAX_LLM_NEWS_SOURCES,
            "model_name": model_name, "temperature": settings.LLM_TEMPERATURE,
            "max_completion_tokens": settings.LLM_MAX_TOKENS,
            "response_format": settings.LLM_RESPONSE_FORMAT,
            "llm_timeout_seconds": settings.LLM_TIMEOUT_SECONDS,
            "llm_streaming": settings.LLM_STREAMING,
            "llm_max_retries": settings.LLM_MAX_RETRIES,
            "stream_chunk_timeout_seconds": settings.LLM_STREAM_CHUNK_TIMEOUT_SECONDS,
            "llm_base_url": settings.LLM_BASE_URL,
            "retrieval": {"embedding_model": settings.EMBED_MODEL,
                          "index_version": getattr(settings, "NEWS_INDEX_VERSION", ""),
                          "index_fingerprint": getattr(settings, "news_index_fingerprint", None),
                          "collection": settings.QDRANT_COLLECTION,
                          "endpoint_hash": compute_config_hash({"url": settings.QDRANT_URL,
                              "host": settings.QDRANT_HOST, "port": settings.QDRANT_PORT,
                              "embedding_url": settings.EMBED_API_URL}),
                          "truncate": settings.EMBED_TRUNCATE},
            "window_days": TIMELINE_TRADING_DAYS, "news_summary_chars": None,
            "revision": text_brief_revision()}


async def _db_work(function, *args, **kwargs):
    task = asyncio.create_task(asyncio.to_thread(function, *args, **kwargs))
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        # Do not close a request session while its synchronous query is still running.
        await task
        raise


def _validate_symbol(symbol: str, allowed_symbols=ALLOWED_SYMBOLS) -> str:
    symbol = symbol.strip().upper()
    if symbol not in allowed_symbols:
        raise AppError({"code": "policy_violation", "message": f"symbol is not allowed by policy: {symbol}", "context": {}}, status_code=422)
    return symbol


class AnalysisService:
    def __init__(self, *, db: Session, settings: Any, http: httpx.AsyncClient,
                 llm: LlmClient | None = None, rag: RetrievalService | None = None,
                 session_factory=None):
        if rag is None and session_factory is None:
            raise ValueError("Analysis retrieval requires an independent session factory")
        self.db, self.settings = db, settings
        self.stock_options = dict(STOCK_OPTIONS)
        if db is not None:
            self.stock_options.update(repository.stock_names(db))
        self.llm = llm or LlmClient(settings, http)
        self.rag = rag if rag is not None else RetrievalService(
            http, settings, stock_options=self.stock_options, session_factory=session_factory)

    def _validate_symbol(self, symbol: str) -> str:
        return _validate_symbol(symbol, self.stock_options)

    async def collect_rag_news(self, req: StockBehaviorRagRequest) -> StockBehaviorRagResponse:
        symbols = [symbol.strip().upper() for symbol in req.symbols if symbol.strip()]
        if not symbols:
            raise AppError({"code": "policy_violation", "message": "symbols must contain at least one non-empty symbol", "context": {}}, status_code=422)
        symbol = self._validate_symbol(symbols[0])
        result = await self.rag.collect(symbol=symbol, lookback_days=req.lookback_days or 60,
                                        as_of=req.as_of_date)
        if result.status == "unavailable":
            raise ServiceUnavailable("新聞來源或版本核對暫時無法使用，無法確認是否有相關新聞。")
        sources = [{**item, "kind": "guidance" if item.get("kind") == "guidance" else "general"}
                   for item in result.news_sources]
        return StockBehaviorRagResponse(news_sources=sources, fallback_mode=result.fallback_mode)

    async def _trend_context(self, stock_id: str):
        symbol = self._validate_symbol(stock_id)
        self.llm.require_enabled()
        settings = self.settings
        loaded = await _db_work(
            repository.trend_inputs, self.db, symbol=symbol,
            history_days=settings.TREND_PREDICTION_HISTORY_DAYS,
            news_window_days=settings.TREND_PREDICTION_NEWS_WINDOW_DAYS,
            news_limit=settings.TREND_PREDICTION_NEWS_LIMIT,
        )
        if loaded is None:
            raise AppError(f"找不到股票 {symbol} 的價格資料", status_code=404)
        latest, rows, news_titles = loaded
        records = []
        for row in rows:
            close = float(row.close) if row.close is not None else 0.0
            if math.isfinite(close) and close > 0:
                records.append({"date": row.date.isoformat(), "close": close})
        records = records[-settings.TREND_PREDICTION_MAX_PRICE_POINTS:]
        if len(records) < 2:
            raise AppError(f"股票 {symbol} 的價格資料不足", status_code=404)
        strategy = StrategyConfig(
            name="live_default", news_window_days=settings.TREND_PREDICTION_NEWS_WINDOW_DAYS,
            news_limit=settings.TREND_PREDICTION_NEWS_LIMIT,
            horizon_days=settings.TREND_PREDICTION_HORIZON_DAYS,
            regression_lambda=settings.TREND_PREDICTION_REGRESSION_LAMBDA,
            momentum_lambda=settings.TREND_PREDICTION_MOMENTUM_LAMBDA,
            mean_reversion_decay=settings.TREND_PREDICTION_DECAY,
            trading_days_per_week=settings.TREND_PREDICTION_TRADING_DAYS_PER_WEEK,
            model_name=self.llm.model_name,
        )
        return symbol, latest, records, news_titles, strategy

    async def generate_trend_prediction(self, stock_id: str) -> dict:
        symbol, _, records, news_titles, strategy = await self._trend_context(stock_id)
        prediction = await generate_prediction(
            symbol, self.stock_options[symbol], records, news_titles, strategy, self.llm,
        )
        return {
            "stock_id": symbol,
            "stock_name": self.stock_options[symbol],
            **build_chart_payload(records, prediction, strategy),
            "ai_direction": prediction["direction"],
            "ai_change_pct": prediction["change_pct_total"],
            "ai_confidence": prediction["confidence"],
            "ai_summary": prediction["summary"],
        }

    async def get_analysis_digest(self, stock_id: str, as_of_date: date, period: str) -> dict:
        symbol = self._validate_symbol(stock_id)
        digest = await _db_work(repository.analysis_digest, self.db, symbol=symbol,
                                 as_of_date=as_of_date, period=period)
        if digest is None:
            raise AppError("查無指定時間點的個股分析快照", status_code=404)
        return digest

    async def stream_trend_prediction(self, stock_id: str):
        try:
            symbol, _, records, news_titles, strategy = await self._trend_context(stock_id)
            closes = [record["close"] for record in records]
            history = build_chart_payload(
                records,
                {"regression_history": compute_weighted_regression(closes, strategy.regression_lambda)[0],
                 "change_pct_total": 0.0},
                strategy,
            )
            trend = (f"最近 {len(closes)} 個交易日，收盤價從 {closes[0]} 到 {closes[-1]} 元"
                     f"（{(closes[-1] - closes[0]) / closes[0] * 100:+.2f}%）。")
            news_desc = "\n".join(f"- {title}" for title in news_titles) if news_titles else "（無近期新聞）"
            yield {
                "type": "init", "stock_id": symbol, "stock_name": self.stock_options[symbol],
                "change_basis": "cumulative_from_last_price",
                "calendar_basis": "weekdays_without_exchange_holidays",
                "return_basis": "unadjusted_price",
                "last_price": closes[-1], **{key: history[key] for key in (
                    "history_dates", "regression_history", "regression_upper",
                    "regression_lower", "future_dates", "regression_future")},
            }
            nodes = []
            trading_days_per_week = strategy.trading_days_per_week
            weeks = math.ceil(strategy.horizon_days / trading_days_per_week)
            for week in range(1, weeks + 1):
                prompt = weekly_prompt(
                    self.stock_options[symbol], symbol, closes[-1], trend, news_desc, week,
                    nodes, trading_days_per_week,
                )
                try:
                    result = await self.llm.generate(system_prompt=prompt, payload={}, schema=WeeklyPredictionOutput)
                    weekly = WeeklyPredictionOutput.model_validate(result.payload)
                    pct, reason = weekly.pct, weekly.reason
                except (AppError, ValidationError, TypeError, ValueError):
                    yield {"type": "error", "message": "預測服務暫時無法提供有效結果。"}
                    return
                base_price = closes[-1]
                node = {"week": week, "day_idx": min(week * trading_days_per_week - 1, strategy.horizon_days - 1),
                        "price": round(base_price * (1 + pct / 100), 2), "pct": pct, "reason": reason}
                nodes.append(node)
                yield {"type": "node", **node}
            target_price = nodes[-1]["price"] if nodes else closes[-1]
            total_pct = round((target_price - closes[-1]) / closes[-1] * 100, 2)
            yield {"type": "done", "total_pct": total_pct,
                   "direction": "up" if total_pct > 0 else "down" if total_pct < 0 else "neutral",
                   "target_price": target_price, "nodes": nodes}
        except AppError as exc:
            detail = exc.detail.get("message", "預測服務暫時無法使用") if isinstance(exc.detail, dict) else str(exc.detail)
            yield {"type": "error", "message": detail}

    async def generate_text_brief(self, req: StockBehaviorTextBriefRequest, *,
                                 refresh_sources: bool = False) -> StockBehaviorTextBriefResponse:
        symbol = req.symbol.strip().upper()
        today = datetime.now(TAIPEI).date()
        as_of = req.as_of_date or today
        if req.cache_only:
            cached = await _db_work(repository.load_latest_saved, self.db, symbol=symbol, as_of=as_of)
            if cached is not None:
                return cached
            return self._response(symbol, as_of, "unavailable", None,
                limitations=[gate.TEXT_BRIEF_CACHE_MISS_LIMITATION])

        config = build_llm_runtime_config(self.settings, self.llm.model_name)
        config_hash = compute_config_hash(config)
        if not req.force_refresh and not refresh_sources:
            cached = await _db_work(repository.load_cached, self.db, symbol=symbol,
                                    as_of=as_of, config_hash=config_hash)
            if cached is not None:
                return cached

        self._validate_symbol(symbol)
        if not refresh_sources or req.force_refresh:
            self.llm.require_enabled()
        rows = await _db_work(repository.collect_rows, self.db, symbol=symbol, as_of=as_of)
        rag = await self.rag.collect(symbol=symbol, as_of=as_of,
                                     max_events=gate.RAG_DEFAULT_MAX_NEWS_EVENTS, enforce_window=True)
        sources = await _db_work(repository.attach_article_ids, self.db, rag.news_sources)
        excluded_sources = [source for source in sources if contains_simulation(source)]
        sources = [source for source in sources if not contains_simulation(source)]
        source_fingerprint = await _db_work(repository.input_fingerprint, self.db,
            symbol=symbol, as_of=as_of, rows=rows, referenced_article_ids=repository.news_article_ids(sources))
        bundle = build_evidence_bundle(symbol=symbol, as_of_date=as_of, rows=rows,
                                        news_sources=sources, rag_fallback_mode=rag.fallback_mode)
        if rag.status == "unavailable":
            bundle.missing_fields.append("新聞來源或版本核對失敗；本次不能判定無相關新聞。")
        if excluded_sources:
            bundle.missing_fields.append("已排除模擬測試新聞")
        task_packet = {"task": {"type": "stock_behavior_text_brief", "symbol": symbol,
                      "as_of_date": as_of.isoformat(), "timeline_trading_days": TIMELINE_TRADING_DAYS,
                      "analysis_language": "zh-TW"}, **bundle.as_payload_sections()}
        evidence_fingerprint = compute_config_hash(task_packet)
        if refresh_sources and not req.force_refresh:
            cached = await _db_work(repository.load_cached, self.db, symbol=symbol,
                as_of=as_of, config_hash=config_hash, source_fingerprints={as_of: source_fingerprint},
                evidence_fingerprint=evidence_fingerprint)
            if cached is not None:
                return cached
        self.llm.require_enabled()
        config.update(input_fingerprint=source_fingerprint, evidence_fingerprint=evidence_fingerprint)
        prompt = TEXT_BRIEF_SYSTEM_PROMPT + "\n<field_glossary>\n" + json.dumps(FIELD_GLOSSARY, ensure_ascii=False) + "\n</field_glossary>"
        started = perf_counter()
        for attempt in range(2):
            output = await self.llm.generate(system_prompt=prompt, payload=task_packet, schema=StockBehaviorTextBrief,
                                             examples=select_examples(symbol, as_of.isoformat()))
            filtered_ids = []
            gate._filter_text_brief_evidence_ids(output.payload, allowed_ids=bundle.evidence_ids(),
                                                filtered_ids=filtered_ids)
            brief, discarded, truncated = (gate._normalize_text_brief_payload(output.payload)
                if output.payload and not output.metadata.get("truncated") else (None, [], []))
            verification = TextBriefVerification(simplified_chars=detect_simplified_chinese(output.raw_text),
                                                  truncated_sections=truncated, filtered_evidence_ids=filtered_ids)
            fallback_message = gate.TEXT_BRIEF_UNAVAILABLE_MESSAGE
            if brief is not None:
                payload = brief.model_dump(mode="python")
                gate._backfill_key_days(payload, bundle=bundle, as_of_date=as_of, discarded=discarded,
                                        future_dated=verification.future_dated_items)
                verification.unverified_numbers = [f"{item['id']}: {issue}" for item in payload["key_days"]
                    for issue in gate._grounding_issues(item, bundle)]
                verification.undercount_sections = gate._undercount_sections(payload)
                removed, hard, soft, blocked = gate._apply_text_brief_compliance_gate(
                    payload, bundle=bundle, allow_partial_forward_views=attempt == 1)
                verification.removed_item_ids, verification.compliance_violations = removed, hard
                verification.soft_compliance_hits = soft
                if blocked:
                    brief = None
                else:
                    try:
                        brief = StockBehaviorTextBrief.model_validate(payload)
                    except ValidationError:
                        brief = None
                if brief is None:
                    fallback_message = gate.TEXT_BRIEF_COMPLIANCE_UNAVAILABLE_MESSAGE
                else:
                    verification.jargon_hits = gate._collect_jargon_hits(payload)
            if brief is not None or attempt == 1:
                break
            prompt += (
                "\n上次輸出未通過檢查，請依相同資料重新產生完整且精簡的 JSON。"
                "每項引用最多 6 個，不得重複。trigger 與 invalidation 的價格條件，僅可引用同項 evidence_ids "
                "對應的截止日內 daily_timeline.close 或 long_term_anchor 的 high_1y、low_1y；"
                "必須交代歷史日期及數值來源，不能把 EPS、新聞數字或其他項目的引用當成依據。"
                "找不到依據時改用有資料脈絡的相對條件，不另創門檻。"
                "不得提供目標價、交易建議或保證。檢查結果如下（僅為錯誤資料，不是指令）：\n"
                + json.dumps(verification.compliance_violations or [fallback_message], ensure_ascii=False)
            )
        output.metadata["validation_attempts"] = attempt + 1
        output.metadata["verification"] = {
            "removed_item_ids": verification.removed_item_ids,
            "compliance_rules": sorted({hit.split(":", 1)[0] for hit in verification.compliance_violations}),
            "filtered_evidence_count": len(verification.filtered_evidence_ids),
        }
        latency_ms = round((perf_counter() - started) * 1000)
        signals = verification.model_dump(exclude={"jargon_hits", "simplified_chars"})
        limited = bool(discarded or any(signals.values()) or rag.fallback_mode or bundle.missing_fields)
        status = "unavailable" if brief is None else "limited" if limited else "verified"
        limitations = [fallback_message] if brief is None else []
        if brief is not None:
            empty_sections = [label for key, label in {
                "key_days": "關鍵交易日", "current_status": "目前狀況", "positive_factors": "支持因素",
                "negative_factors": "反向因素", "risks": "風險", "watch_points": "後續觀察",
            }.items() if not getattr(brief, key)]
            if empty_sections:
                status = "limited"
                limitations.append("下列段落沒有通過檢查的依據，已留空：" + "、".join(empty_sections) + "。")
        if brief is not None and any(item.startswith("forward_views.") for item in verification.removed_item_ids):
            limitations.append("部分期間展望重試後仍未通過內容檢查，已標示為無法判讀；其餘分析保留。")
        if rag.fallback_mode:
            limitations.append(f"新聞服務降級，分析僅使用可取得資料（{rag.reason or rag.status}）。")
        if not any(item.get("kind") == "guidance" for item in bundle.news):
            limitations.append(gate.TEXT_BRIEF_NO_GUIDANCE_LIMITATION)
        limitations.extend(f"缺少：{field}" for field in bundle.missing_fields)
        limitations.append("僅檢查結構、引用及部分可核對數值；未完整核實語義或校準預測信心。")
        if any(re.search(r"FVOCI|\d+家金控", str(item.get("value", ""))) for item in bundle.news):
            limitations.append("新聞包含金控獲利或 FVOCI 等財務口徑；公司與產業合計、當期損益與保留盈餘的比較尚未完整自動核對。")
        limitations.append("行情為未還原價格；財報公布與修訂時間未完整保存。")
        if brief is not None and brief.confidence == "high":
            brief.confidence = "medium" if not limited else "low"
            brief.confidence_reason = "信心未經預測校準；資料缺項與檢查限制請見分析限制。"
        catalog = bundle.catalog() if brief is not None else []
        response = self._response(symbol, as_of, status, brief, evidence_catalog=catalog, limitations=limitations)
        response.price_as_of_date = bundle.daily_timeline[-1]["date"] if bundle.daily_timeline else None
        response.news_cutoff_date = as_of.isoformat()
        response.verification = {key: len(value) for key, value in verification.model_dump().items()}
        response.analysis_mode = "historical_reanalysis" if as_of < today else "current_analysis" if as_of == today else None
        response.analysis_revision, response.config_hash = config["revision"], config_hash
        await _db_work(self._save_snapshot, response, config, output.raw_text,
                       len(bundle.news), latency_ms, output.metadata)
        return response

    def _response(self, symbol, as_of, status, brief, **fields):
        return StockBehaviorTextBriefResponse(symbol=symbol, as_of_date=as_of.isoformat(),
            generated_by=self.llm.model_name, status=status, brief=brief,
            disclaimer=TextBriefDisclaimer(version=gate.TEXT_BRIEF_DISCLAIMER_VERSION,
                                           text=gate.TEXT_BRIEF_DISCLAIMER_TEXT), **fields)

    def _save_snapshot(self, response, config, raw_text, news_count, latency_ms, metadata):
        if config.get("purpose") != "production" or contains_simulation(response.model_dump(mode="python")):
            raise ValueError("Ineligible sources cannot be saved as a production analysis")
        safe_payload = response.brief.model_dump(mode="json") if response.brief else {"limitations": response.limitations}
        row = LlmResponse(symbol=response.symbol, as_of_date=date.fromisoformat(response.as_of_date),
            kind=LLM_RESPONSE_KIND_TEXT_BRIEF, config_hash=response.config_hash,
            config_json=json.dumps(config, ensure_ascii=False, sort_keys=True),
            model_name=response.generated_by, is_fallback=response.brief is None,
            news_count=news_count, summary=response.brief.headline if response.brief else response.limitations[0],
            raw_llm_text=raw_text, normalized_json=json.dumps(
                {"payload": safe_payload, "model_metadata": metadata}, ensure_ascii=False),
            response_json=response.model_dump_json(), latency_ms=latency_ms)
        try:
            self.db.add(row)
            self.db.commit()
            self.db.refresh(row)
        except Exception:
            self.db.rollback()
            raise
        response.snapshot_id = row.id
        response.generated_at = row.created_at.isoformat() if row.created_at else None
