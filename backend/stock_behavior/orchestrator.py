from __future__ import annotations

import hashlib
import json
import re
from copy import deepcopy
from datetime import date, timedelta
from functools import lru_cache
from time import perf_counter
from typing import Any

from pydantic import ValidationError
from sqlalchemy.orm import Session

from crud.llm_response import create_llm_response, get_cached_llm_response
from models.llm_response import LLM_RESPONSE_KIND_TEXT_BRIEF
from schemas.stock_behavior import (
    RawStockBehaviorTextBrief,
    RawTextBriefClaim,
    RawTextBriefForwardView,
    RawTextBriefKeyDay,
    RawTextBriefRisk,
    RawTextBriefWatchPoint,
    StockBehaviorRagRequest,
    StockBehaviorRagResponse,
    StockBehaviorTextBrief,
    StockBehaviorTextBriefRequest,
    StockBehaviorTextBriefResponse,
    TextBriefClaim,
    TextBriefDisclaimer,
    TextBriefForwardView,
    TextBriefKeyDay,
    TextBriefRisk,
    TextBriefVerification,
    TextBriefWatchPoint,
)
from stock_behavior.compliance import (
    ComplianceHit,
    compliance_rules_signature,
    scan_compliance_hits,
)
from stock_behavior.evidence import (
    TIMELINE_TRADING_DAYS,
    EvidenceBundle,
    build_evidence_bundle,
)
from stock_behavior.few_shot_examples import FEW_SHOT_EXAMPLES
from stock_behavior.llm import (
    LLM_MAX_COMPLETION_TOKENS,
    LLM_TIMEOUT_SECONDS,
    StockBehaviorLlmService,
)
from stock_behavior.observability import log_event, log_warn, stage
from stock_behavior.prompt_templates import TEXT_BRIEF_SYSTEM_PROMPT
from stock_behavior.tools import ToolExecutor
from stock_behavior.utils import (
    PolicyViolationError,
    UpstreamModelError,
    detect_simplified_chinese,
)


MAX_LLM_NEWS_SOURCES = 50
ANALYSIS_LANGUAGE = "zh-TW"
RAG_DEFAULT_NEWS_LOOKBACK_DAYS = 60
RAG_DEFAULT_MAX_NEWS_EVENTS = 50
NEWS_SUMMARY_CHARS: int | None = None
TEXT_BRIEF_SCHEMA_VERSION = "text-first-v2"
# 目標數量；低於此值不會讓整份作廢，但會把 status 降為 limited 並記在 verification。
TEXT_BRIEF_TARGET_COUNTS = {"key_days": 3, "watch_points": 2}
# 上限；超出時截斷到上限而非整份作廢。實測 nemotron 會給 4 個正面因素、5 個觀察點，
# 內容本身沒問題，若因為多寫一項就丟掉整份簡報，是把好結果當垃圾。
TEXT_BRIEF_MAX_COUNTS = {
    "key_days": 5,
    "current_status": 3,
    "positive_factors": 3,
    "negative_factors": 3,
    "source_divergences": 3,
    "risks": 3,
    "watch_points": 4,
    "limitations": 5,
}
# 只抓「一般投資人看不懂」的指標代號。月線、季線、年線這類詞在台股媒體天天出現，
# 讀者本來就熟悉，禁掉反而讓句子變得囉嗦；真正該擋的是英文縮寫與專業術語。
# 這裡只記錄不降級：列入 status 會讓幾乎每份都變 limited，那個狀態就失去鑑別度，
# 但 eval 仍需要這個數字來衡量 prompt 的遵循度。
JARGON_TERMS_RE = re.compile(
    r"MACD|RSI|KDJ|KD值|KD|布林(?:通道|線)?|乖離|黃金交叉|死亡交叉|K值|D值|J值|"
    r"隨機指標|相對強弱|指數平滑異同"
)
# trigger 與 invalidation 依定義都是「未來會發生什麼」的條件，任何價位數字都是
# 未來價位。文字型的 未來價位型-hard 規則只抓「支撐/壓力 → 數字」的語序，實測模型
# 會寫成「跌破 2400 元關鍵支撐」（數字在前）而漏接，這裡改用欄位級的硬規則。
FORWARD_CONDITION_KEYS = frozenset({"trigger", "invalidation"})
FORWARD_PRICE_RE = re.compile(r"\d+(?:\.\d+)?\s*(?:元|塊)")
TEXT_BRIEF_NUMBER_TOLERANCE_PP = 0.1
TEXT_BRIEF_NO_GUIDANCE_LIMITATION = "本分析未涵蓋公司自提財測，展望類資訊僅來自媒體報導。"
TEXT_BRIEF_DISCLAIMER_VERSION = "v1"
TEXT_BRIEF_DISCLAIMER_TEXT = (
    "本內容由 AI 系統彙整公開資訊自動產生，僅供參考，不構成投資建議或個股買賣依據；"
    "投資人應自行獨立判斷並自負投資風險。行情與公告請以臺灣證券交易所、"
    "證券櫃檯買賣中心及公開資訊觀測站公告為準。"
)
TEXT_BRIEF_UNAVAILABLE_MESSAGE = "模型輸出無法解析，本次無法提供簡報。"
TEXT_BRIEF_COMPLIANCE_UNAVAILABLE_MESSAGE = "簡報內容未通過合規檢查，本次無法提供。"
TEXT_BRIEF_CACHE_MISS_LIMITATION = "這檔還沒有產生過 AI 分析，排程更新後才會出現；要現在跑請按「重新分析」。"
TEXT_BRIEF_ITEM_SECTIONS = (
    "key_days",
    "current_status",
    "positive_factors",
    "negative_factors",
    "source_divergences",
    "risks",
    "watch_points",
)
TEXT_BRIEF_COMPLIANCE_TEXT_KEYS = frozenset(
    {
        "text",
        "title",
        "description",
        "rationale",
        "headline",
        "statement",
        "confidence_reason",
        "what",
        "what_to_watch",
        "why_it_matters",
        "when",
        "trigger",
        "risk_type",
        "reason",
        "invalidation",
    }
)
PERCENT_IN_TEXT_RE = re.compile(r"(\d+(?:\.\d+)?)\s*%")


def build_llm_runtime_config(settings: Any, model_name: str) -> dict[str, Any]:
    """模型與檢索的執行參數；併入 config_hash，改動任一項都會讓既有快照失效。"""
    return {
        "rag_lookback_days": RAG_DEFAULT_NEWS_LOOKBACK_DAYS,
        "rag_max_events": RAG_DEFAULT_MAX_NEWS_EVENTS,
        "max_llm_news_sources": MAX_LLM_NEWS_SOURCES,
        "model_name": model_name,
        "temperature": getattr(settings, "ADVISOR_LLM_TEMPERATURE", 0.2),
        "max_completion_tokens": getattr(
            settings,
            "ADVISOR_LLM_MAX_COMPLETION_TOKENS",
            LLM_MAX_COMPLETION_TOKENS,
        ),
        "response_format": getattr(
            settings,
            "ADVISOR_LLM_RESPONSE_FORMAT",
            "json_object",
        ),
        "llm_timeout_seconds": getattr(
            settings,
            "ADVISOR_LLM_TIMEOUT_SECONDS",
            LLM_TIMEOUT_SECONDS,
        ),
        "llm_streaming": bool(getattr(settings, "ADVISOR_LLM_STREAMING", False)),
    }


def compute_config_hash(config: dict[str, Any]) -> str:
    canonical = json.dumps(config, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@lru_cache(maxsize=1)
def text_brief_revision() -> str:
    """簡報產出邏輯的內容指紋，併入 config_hash 當快取鍵。

    prompt、few-shot、合規規則、schema 任一改動都會自動讓舊快照失效。
    直接雜湊內容而不是維護版本字串，就不會有「改了 prompt 忘記 bump」
    導致舊快照被當成有效繼續回放的情況。
    """
    canonical = json.dumps(
        {
            "prompt": TEXT_BRIEF_SYSTEM_PROMPT,
            "examples": FEW_SHOT_EXAMPLES,
            "compliance": compliance_rules_signature(),
            "schema": TEXT_BRIEF_SCHEMA_VERSION,
        },
        ensure_ascii=False,
        sort_keys=True,
        default=str,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:12]


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


    # ── text-first-v2 文字簡報（此段以下改用 observability 的結構化 log）─────

    @staticmethod
    def _normalize_text_brief_items(
        raw_items: Any,
        *,
        raw_model: Any,
        strict_model: Any,
        id_prefix: str,
        section: str,
        discarded: list[str],
    ) -> list[dict[str, Any]]:
        if not isinstance(raw_items, list):
            discarded.append(section)
            return []

        normalized: list[dict[str, Any]] = []
        for index, item in enumerate(raw_items):
            item_label = f"{section}[{index}]"
            try:
                raw_item = raw_model.model_validate(item).model_dump(mode="python")
            except ValidationError:
                discarded.append(item_label)
                continue

            item_id = raw_item.get("id")
            if not isinstance(item_id, str) or re.fullmatch(
                rf"{re.escape(id_prefix)}_[0-9]+", item_id
            ) is None:
                discarded.append(item_id if isinstance(item_id, str) else item_label)
                continue
            try:
                normalized.append(
                    strict_model.model_validate(raw_item).model_dump(mode="python")
                )
            except ValidationError:
                discarded.append(item_id)
        return normalized

    @classmethod
    def _normalize_text_brief_forward_views(
        cls,
        raw_forward_views: Any,
        *,
        discarded: list[str],
    ) -> dict[str, Any] | None:
        if not isinstance(raw_forward_views, dict):
            discarded.append("forward_views")
            return None

        normalized: dict[str, Any] = {}
        for horizon in ("short_1_5", "swing_6_20", "medium_21_40"):
            try:
                raw_view = RawTextBriefForwardView.model_validate(
                    raw_forward_views.get(horizon)
                ).model_dump(mode="python")
                normalized[horizon] = TextBriefForwardView.model_validate(
                    raw_view
                ).model_dump(mode="python")
            except ValidationError:
                discarded.append(f"forward_views.{horizon}")
                return None
        return normalized

    @staticmethod
    def _truncate_oversized_sections(
        normalized: dict[str, Any],
        *,
        truncated: list[str],
    ) -> None:
        for section, maximum in TEXT_BRIEF_MAX_COUNTS.items():
            items = normalized.get(section)
            if isinstance(items, list) and len(items) > maximum:
                truncated.append(f"{section}>{maximum}")
                normalized[section] = items[:maximum]

    @classmethod
    def _normalize_text_brief_payload(
        cls,
        payload: dict[str, Any],
    ) -> tuple[StockBehaviorTextBrief | None, list[str], list[str]]:
        discarded: list[str] = []
        truncated: list[str] = []
        try:
            raw = RawStockBehaviorTextBrief.model_validate(payload).model_dump(
                mode="python"
            )
        except ValidationError:
            return None, ["root"], truncated

        claim_sections = (
            ("current_status", "cs"),
            ("positive_factors", "pos"),
            ("negative_factors", "neg"),
            ("source_divergences", "div"),
        )
        normalized: dict[str, Any] = {
            "key_days": cls._normalize_text_brief_items(
                raw["key_days"],
                raw_model=RawTextBriefKeyDay,
                strict_model=TextBriefKeyDay,
                id_prefix="kd",
                section="key_days",
                discarded=discarded,
            ),
            "headline": raw["headline"],
            "risks": cls._normalize_text_brief_items(
                raw["risks"],
                raw_model=RawTextBriefRisk,
                strict_model=TextBriefRisk,
                id_prefix="rk",
                section="risks",
                discarded=discarded,
            ),
            "watch_points": cls._normalize_text_brief_items(
                raw["watch_points"],
                raw_model=RawTextBriefWatchPoint,
                strict_model=TextBriefWatchPoint,
                id_prefix="wp",
                section="watch_points",
                discarded=discarded,
            ),
            "forward_views": cls._normalize_text_brief_forward_views(
                raw["forward_views"], discarded=discarded
            ),
            "overall_stance": raw["overall_stance"],
            "confidence": raw["confidence"],
            "confidence_reason": raw["confidence_reason"],
            "limitations": raw["limitations"],
        }
        for section, prefix in claim_sections:
            normalized[section] = cls._normalize_text_brief_items(
                raw[section],
                raw_model=RawTextBriefClaim,
                strict_model=TextBriefClaim,
                id_prefix=prefix,
                section=section,
                discarded=discarded,
            )

        cls._truncate_oversized_sections(normalized, truncated=truncated)

        try:
            return StockBehaviorTextBrief.model_validate(normalized), discarded, truncated
        except ValidationError as exc:
            print(
                "[stock_behavior_text_brief] status=fallback "
                f"reason=validation_failed error={cls._format_validation_errors(exc)}"
            )
            return None, discarded, truncated

    @staticmethod
    def _format_validation_errors(exc: ValidationError) -> str:
        return "; ".join(
            f"{'.'.join(str(part) for part in error['loc'])}: {error['msg']}"
            for error in exc.errors()
        )

    @staticmethod
    def _filter_text_brief_evidence_ids(
        value: Any,
        *,
        allowed_ids: set[str],
        filtered_ids: list[str],
    ) -> None:
        if isinstance(value, dict):
            for key, item in value.items():
                if key == "evidence_ids" and isinstance(item, list):
                    kept = []
                    for evidence_id in item:
                        if evidence_id in allowed_ids:
                            kept.append(evidence_id)
                        else:
                            filtered_ids.append(evidence_id)
                    value[key] = kept
                else:
                    StockBehaviorOrchestrator._filter_text_brief_evidence_ids(
                        item,
                        allowed_ids=allowed_ids,
                        filtered_ids=filtered_ids,
                    )
        elif isinstance(value, list):
            for item in value:
                StockBehaviorOrchestrator._filter_text_brief_evidence_ids(
                    item,
                    allowed_ids=allowed_ids,
                    filtered_ids=filtered_ids,
                )

    @staticmethod
    def _text_brief_compliance_texts(value: Any) -> list[str]:
        parts: list[str] = []

        def collect(item: Any) -> None:
            if isinstance(item, dict):
                for key, child in item.items():
                    if key in TEXT_BRIEF_COMPLIANCE_TEXT_KEYS:
                        if isinstance(child, str):
                            parts.append(child)
                    elif key == "limitations" and isinstance(child, list):
                        parts.extend(entry for entry in child if isinstance(entry, str))
                    else:
                        collect(child)
            elif isinstance(item, list):
                for child in item:
                    collect(child)

        collect(value)
        return parts

    @staticmethod
    def _forward_condition_texts(value: Any) -> list[str]:
        texts: list[str] = []

        def collect(item: Any) -> None:
            if isinstance(item, dict):
                for key, child in item.items():
                    if key in FORWARD_CONDITION_KEYS and isinstance(child, str):
                        texts.append(child)
                    else:
                        collect(child)
            elif isinstance(item, list):
                for child in item:
                    collect(child)

        collect(value)
        return texts

    @classmethod
    def _scan_forward_condition_prices(cls, value: Any) -> list[ComplianceHit]:
        return [
            ComplianceHit("前瞻價位-hard", "hard", text)
            for text in cls._forward_condition_texts(value)
            if FORWARD_PRICE_RE.search(text)
        ]

    @classmethod
    def _scan_text_brief_compliance(cls, value: Any) -> list[ComplianceHit]:
        hits = [
            hit
            for text in cls._text_brief_compliance_texts(value)
            for hit in scan_compliance_hits(text)
        ]
        return hits + cls._scan_forward_condition_prices(value)

    @classmethod
    def _apply_text_brief_compliance_gate(
        cls,
        brief_payload: dict[str, Any],
    ) -> tuple[list[str], list[str], list[str], bool]:
        removed_ids: list[str] = []
        hard_violations: list[str] = []
        soft_hits: list[str] = []

        for section in TEXT_BRIEF_ITEM_SECTIONS:
            kept = []
            for item in brief_payload[section]:
                hits = cls._scan_text_brief_compliance(item)
                hard = [hit for hit in hits if hit.severity == "hard"]
                hard_violations.extend(f"{hit.rule}: {hit.snippet}" for hit in hard)
                soft_hits.extend(
                    f"{hit.rule}: {hit.snippet}"
                    for hit in hits
                    if hit.severity == "soft"
                )
                if hard:
                    removed_ids.append(item["id"])
                else:
                    kept.append(item)
            brief_payload[section] = kept

        core_payload = {
            "headline": brief_payload["headline"],
            "confidence_reason": brief_payload["confidence_reason"],
            "limitations": brief_payload["limitations"],
            "forward_views": brief_payload["forward_views"],
        }
        core_hits = cls._scan_text_brief_compliance(core_payload)
        hard_violations.extend(
            f"{hit.rule}: {hit.snippet}"
            for hit in core_hits
            if hit.severity == "hard"
        )
        soft_hits.extend(
            f"{hit.rule}: {hit.snippet}"
            for hit in core_hits
            if hit.severity == "soft"
        )
        return (
            removed_ids,
            hard_violations,
            soft_hits,
            any(hit.severity == "hard" for hit in core_hits),
        )

    @staticmethod
    def _text_brief_referenced_ids(value: Any) -> set[str]:
        referenced: set[str] = set()
        if isinstance(value, dict):
            for key, item in value.items():
                if key == "evidence_ids" and isinstance(item, list):
                    referenced.update(
                        evidence_id
                        for evidence_id in item
                        if isinstance(evidence_id, str)
                    )
                else:
                    referenced.update(
                        StockBehaviorOrchestrator._text_brief_referenced_ids(item)
                    )
        elif isinstance(value, list):
            for item in value:
                referenced.update(
                    StockBehaviorOrchestrator._text_brief_referenced_ids(item)
                )
        return referenced

    @staticmethod
    def _backfill_key_days(
        brief_payload: dict[str, Any],
        *,
        bundle: EvidenceBundle,
        as_of_date: date,
        discarded: list[str],
        future_dated: list[str],
    ) -> None:
        """move_pct 與 volume_ratio 一律由後端依 ref 回填，模型輸出的數字不採用。"""
        by_id = bundle.timeline_by_id()
        by_date = bundle.timeline_by_date()
        kept: list[dict[str, Any]] = []
        for item in brief_payload["key_days"]:
            item_date = item.get("date")
            if isinstance(item_date, str):
                try:
                    if date.fromisoformat(item_date) > as_of_date:
                        future_dated.append(item["id"])
                        continue
                except ValueError:
                    discarded.append(item["id"])
                    continue

            row = by_id.get(item.get("ref")) or by_date.get(item_date)
            if row is None:
                discarded.append(item["id"])
                continue

            item["ref"] = row["id"]
            item["date"] = row["date"]
            item["move_pct"] = row.get("chg_pct")
            volume_pct = row.get("vol_vs_ma5_pct")
            item["volume_ratio"] = (
                None if volume_pct is None else round(1.0 + volume_pct / 100.0, 2)
            )
            kept.append(item)
        brief_payload["key_days"] = kept

    @staticmethod
    def _check_key_day_numbers(
        brief_payload: dict[str, Any],
        *,
        known_percentages: set[float],
    ) -> list[str]:
        """key_days 敘述中的百分比必須對得上 payload 中真實存在的數值。"""
        unverified: list[str] = []
        for item in brief_payload["key_days"]:
            # 回填不到數字代表那天缺價量資料；沉默通過會讓 status 假性 verified。
            if item.get("move_pct") is None:
                unverified.append(f"{item['id']}: 該日缺少漲跌幅資料")
            text = item.get("what")
            if not isinstance(text, str):
                continue
            for match in PERCENT_IN_TEXT_RE.finditer(text):
                value = round(float(match.group(1)), 2)
                if any(
                    abs(value - candidate) <= TEXT_BRIEF_NUMBER_TOLERANCE_PP
                    for candidate in known_percentages
                ):
                    continue
                unverified.append(f"{item['id']}: {match.group(0)}")
        return unverified

    @classmethod
    def _collect_jargon_hits(cls, brief_payload: dict[str, Any]) -> list[str]:
        """面向使用者的文字裡出現的技術指標代號。只記錄，不影響 status。

        列入 status 會讓幾乎每份簡報都變 limited，反而讓這個狀態失去鑑別度；
        但 eval 需要一個數字來衡量 prompt 的「不要出現術語」到底遵循得多好。
        """
        hits: list[str] = []
        for text in cls._text_brief_compliance_texts(brief_payload):
            hits.extend(JARGON_TERMS_RE.findall(text))
        return list(dict.fromkeys(hits))

    @staticmethod
    def _undercount_sections(brief_payload: dict[str, Any]) -> list[str]:
        return [
            f"{section}<{minimum}"
            for section, minimum in TEXT_BRIEF_TARGET_COUNTS.items()
            if len(brief_payload.get(section) or []) < minimum
        ]

    @staticmethod
    def _build_text_brief_task_packet(
        *,
        symbol: str,
        as_of_date_text: str,
        bundle: EvidenceBundle,
    ) -> dict[str, Any]:
        # field_glossary 與 output_schema 都在 system prompt，不進 payload：
        # few-shot 的範例輸入必須與這裡完全同構，重複帶常數只是多花三倍 token。
        return {
            "task": {
                "type": "stock_behavior_text_brief",
                "symbol": symbol,
                "as_of_date": as_of_date_text,
                "timeline_trading_days": TIMELINE_TRADING_DAYS,
                "analysis_language": ANALYSIS_LANGUAGE,
            },
            **bundle.as_payload_sections(),
        }

    async def _fetch_text_brief_news(
        self,
        *,
        symbol: str,
        as_of_date: date,
    ) -> tuple[list[dict[str, Any]], bool]:
        """v2 由後端自行取新聞，不再接受前端傳入，避免分析與新聞來源對不上。"""
        try:
            with stage(
                "text_brief.rag",
                symbol=symbol,
                url=self._settings.RAG_API_URL or "-",
                lookback_days=RAG_DEFAULT_NEWS_LOOKBACK_DAYS,
                timeout_s=self._settings.RAG_API_TIMEOUT,
            ) as info:
                payload = await self._new_executor().get_rag_news(
                    symbol=symbol,
                    lookback_days=RAG_DEFAULT_NEWS_LOOKBACK_DAYS,
                    max_events=RAG_DEFAULT_MAX_NEWS_EVENTS,
                    as_of=as_of_date,
                )
                info["returned"] = len(payload.get("news_sources") or [])
                info["fallback"] = payload.get("fallback_mode")
        except PolicyViolationError:
            raise
        except Exception as exc:  # pragma: no cover - 網路層例外已在 tools 內處理
            log_warn(
                "text_brief.rag.failed",
                symbol=symbol,
                error_type=type(exc).__name__,
                error=str(exc)[:200],
            )
            return [], True

        sources = payload.get("news_sources")
        sources = sources if isinstance(sources, list) else []
        return (
            self._drop_stale_news(sources, as_of_date=as_of_date)[:MAX_LLM_NEWS_SOURCES],
            bool(payload.get("fallback_mode", False)),
        )

    @staticmethod
    def _drop_stale_news(
        sources: list[dict[str, Any]],
        *,
        as_of_date: date,
    ) -> list[dict[str, Any]]:
        """濾掉落在回溯視窗之外的新聞。

        RAG 端 /api/analyze 在近期查無結果時，會 fallback 回傳「任何早於 as_of 的
        新聞」（見 rag_deploy/api_server.py 的 not_future 分支）。實測 2615 在
        as_of=2026-03-20 會拿到 2024 年的紅海報導。這種舊聞掛進 payload 會被模型
        當成近期事件，所以後端自己再守一次時間窗。
        """
        earliest = as_of_date - timedelta(days=RAG_DEFAULT_NEWS_LOOKBACK_DAYS)
        kept: list[dict[str, Any]] = []
        dropped = 0
        for source in sources:
            timestamp = str(source.get("timestamp") or "")[:10]
            try:
                published_on = date.fromisoformat(timestamp)
            except ValueError:
                dropped += 1
                continue
            if published_on < earliest:
                dropped += 1
                continue
            kept.append(source)
        if dropped:
            log_warn(
                "text_brief.rag.stale_dropped",
                dropped=dropped,
                earliest=earliest.isoformat(),
            )
        return kept

    def _text_brief_config(self, model_name: str) -> dict[str, Any]:
        return {
            **build_llm_runtime_config(self._settings, model_name),
            "window_days": TIMELINE_TRADING_DAYS,
            "news_summary_chars": NEWS_SUMMARY_CHARS,
            "revision": text_brief_revision(),
        }

    def _cache_miss_response(
        self,
        *,
        symbol: str,
        as_of_date_text: str,
        model_name: str,
    ) -> StockBehaviorTextBriefResponse:
        """cache_only 完全查無快照：回一份 unavailable，讓前端顯示「尚未產生」而不是轉圈。"""
        return StockBehaviorTextBriefResponse(
            symbol=symbol,
            as_of_date=as_of_date_text,
            generated_by=model_name,
            status="unavailable",
            brief=None,
            disclaimer=TextBriefDisclaimer(
                version=TEXT_BRIEF_DISCLAIMER_VERSION,
                text=TEXT_BRIEF_DISCLAIMER_TEXT,
            ),
            limitations=[TEXT_BRIEF_CACHE_MISS_LIMITATION],
        )

    def _load_cached_text_brief(
        self,
        *,
        symbol: str,
        as_of_date: date | None,
        config_hash: str,
    ) -> StockBehaviorTextBriefResponse | None:
        row = get_cached_llm_response(
            self._db,
            symbol=symbol,
            as_of_date=as_of_date,
            kind=LLM_RESPONSE_KIND_TEXT_BRIEF,
            config_hash=config_hash,
        )
        if row is None or not row.response_json:
            return None
        try:
            stored = json.loads(row.response_json)
            response = StockBehaviorTextBriefResponse.model_validate(stored)
        except (ValueError, ValidationError):
            return None
        response.cached = True
        return response

    async def generate_text_brief(
        self,
        req: StockBehaviorTextBriefRequest,
    ) -> StockBehaviorTextBriefResponse:
        symbol = req.symbol.strip().upper()
        as_of_date = req.as_of_date or date.today()
        as_of_date_text = as_of_date.isoformat()
        model_name = getattr(
            self._llm,
            "model_name",
            self._settings.ADVISOR_LLM_MODEL or "",
        )
        config = self._text_brief_config(model_name)
        config_hash = compute_config_hash(config)
        log_event(
            "text_brief.request",
            symbol=symbol,
            as_of=as_of_date_text,
            model=model_name,
            force_refresh=req.force_refresh,
            config_hash=config_hash[:12],
        )

        if not req.force_refresh:
            cached = self._load_cached_text_brief(
                symbol=symbol,
                as_of_date=as_of_date,
                config_hash=config_hash,
            )
            if cached is not None:
                log_event(
                    "text_brief.cache_hit", symbol=symbol, as_of=as_of_date_text
                )
                return cached

        # 只讀快取（個股頁自動載入）：當日還沒產出就退回最近一次，產生交給排程。
        if req.cache_only and not req.force_refresh:
            cached = self._load_cached_text_brief(
                symbol=symbol,
                as_of_date=None,
                config_hash=config_hash,
            )
            log_event(
                "text_brief.cache_only",
                symbol=symbol,
                as_of=as_of_date_text,
                hit=cached is not None,
                stale_as_of=cached.as_of_date if cached else None,
            )
            return cached or self._cache_miss_response(
                symbol=symbol,
                as_of_date_text=as_of_date_text,
                model_name=model_name,
            )

        news_sources, rag_fallback_mode = await self._fetch_text_brief_news(
            symbol=symbol,
            as_of_date=as_of_date,
        )
        with stage("text_brief.evidence", symbol=symbol, as_of=as_of_date_text) as info:
            bundle = build_evidence_bundle(
                self._db,
                symbol=symbol,
                as_of_date=as_of_date,
                news_sources=news_sources,
                news_summary_chars=NEWS_SUMMARY_CHARS,
                rag_fallback_mode=rag_fallback_mode,
            )
            task_packet = self._build_text_brief_task_packet(
                symbol=symbol,
                as_of_date_text=as_of_date_text,
                bundle=bundle,
            )
            info["timeline_rows"] = len(bundle.daily_timeline)
            info["news"] = len(bundle.news)
            info["fundamental"] = len(bundle.fundamental)
            info["payload_chars"] = len(
                json.dumps(task_packet, ensure_ascii=False, default=str)
            )
            info["missing"] = bundle.missing_fields or "-"

        llm_started_at = perf_counter()
        try:
            (
                raw_llm_response,
                raw_llm_text,
                llm_meta,
            ) = await self._llm.generate_text_brief_from_evidence(
                task_packet=task_packet
            )
        except RuntimeError as exc:
            # LLM 服務未啟用（缺 API key／base url／模型名），屬於設定問題。
            raise PolicyViolationError(
                "LLM text brief failed",
                code="llm_text_brief_failed",
                context={
                    "symbol": symbol,
                    "as_of_date": as_of_date_text,
                    "reason": str(exc),
                },
            ) from exc
        except Exception as exc:
            # NIM 的 5xx／連線中斷不是 RuntimeError，放著不接會變成未處理的 500。
            raise UpstreamModelError(
                "模型服務暫時無法回應，請稍後重試",
                context={
                    "symbol": symbol,
                    "as_of_date": as_of_date_text,
                    "error_type": type(exc).__name__,
                    "reason": str(exc)[:200],
                },
            ) from exc
        latency_ms = round((perf_counter() - llm_started_at) * 1000)

        filtered_ids: list[str] = []
        future_dated_items: list[str] = []
        compliance_violations: list[str] = []
        removed_item_ids: list[str] = []
        soft_compliance_hits: list[str] = []
        unverified_numbers: list[str] = []
        undercount_sections: list[str] = []
        truncated_sections: list[str] = []
        jargon_hits: list[str] = []
        simplified_chars = detect_simplified_chinese(raw_llm_text)
        discarded: list[str] = []
        brief: StockBehaviorTextBrief | None = None
        blocked_payload: dict[str, Any] | None = None
        fallback_message = TEXT_BRIEF_UNAVAILABLE_MESSAGE
        if raw_llm_response and not llm_meta.get("truncated"):
            (
                brief,
                discarded,
                truncated_sections,
            ) = self._normalize_text_brief_payload(raw_llm_response)

        if brief is not None:
            brief_payload = brief.model_dump(mode="python")
            self._filter_text_brief_evidence_ids(
                brief_payload,
                allowed_ids=bundle.evidence_ids(),
                filtered_ids=filtered_ids,
            )
            self._backfill_key_days(
                brief_payload,
                bundle=bundle,
                as_of_date=as_of_date,
                discarded=discarded,
                future_dated=future_dated_items,
            )
            unverified_numbers = self._check_key_day_numbers(
                brief_payload,
                known_percentages=bundle.known_percentages(),
            )
            undercount_sections = self._undercount_sections(brief_payload)

            pre_compliance_payload = deepcopy(brief_payload)
            (
                removed_item_ids,
                compliance_violations,
                soft_compliance_hits,
                core_blocked,
            ) = self._apply_text_brief_compliance_gate(brief_payload)
            if core_blocked:
                blocked_payload = {
                    **pre_compliance_payload,
                    "blocked_by_compliance": True,
                }
                fallback_message = TEXT_BRIEF_COMPLIANCE_UNAVAILABLE_MESSAGE
                brief = None
            else:
                try:
                    brief = StockBehaviorTextBrief.model_validate(brief_payload)
                except ValidationError:
                    fallback_message = TEXT_BRIEF_COMPLIANCE_UNAVAILABLE_MESSAGE
                    brief = None
            if brief is not None:
                jargon_hits = self._collect_jargon_hits(brief_payload)

        filtered_ids = list(dict.fromkeys(filtered_ids))
        future_dated_items = list(dict.fromkeys(future_dated_items))
        discarded = list(dict.fromkeys(discarded))
        compliance_violations = list(dict.fromkeys(compliance_violations))
        removed_item_ids = list(dict.fromkeys(removed_item_ids))
        soft_compliance_hits = list(dict.fromkeys(soft_compliance_hits))
        unverified_numbers = list(dict.fromkeys(unverified_numbers))
        if discarded:
            log_warn("text_brief.items_discarded", items=discarded)

        is_fallback = brief is None
        status_value = (
            "unavailable"
            if is_fallback
            else (
                "limited"
                if filtered_ids
                or future_dated_items
                or compliance_violations
                or discarded
                or removed_item_ids
                or soft_compliance_hits
                or unverified_numbers
                or undercount_sections
                or truncated_sections
                else "verified"
            )
        )
        limitations = [fallback_message] if is_fallback else []
        if not any(item.get("kind") == "guidance" for item in bundle.news):
            limitations.append(TEXT_BRIEF_NO_GUIDANCE_LIMITATION)
        verification = TextBriefVerification(
            filtered_evidence_ids=filtered_ids,
            compliance_violations=compliance_violations,
            simplified_chars=simplified_chars,
            future_dated_items=future_dated_items,
            removed_item_ids=removed_item_ids,
            soft_compliance_hits=soft_compliance_hits,
            unverified_numbers=unverified_numbers,
            undercount_sections=undercount_sections,
            truncated_sections=truncated_sections,
            jargon_hits=jargon_hits,
        )

        evidence_catalog: list[dict[str, Any]] = []
        if brief is not None:
            referenced_ids = self._text_brief_referenced_ids(
                brief.model_dump(mode="python")
            )
            evidence_catalog = [
                item for item in bundle.catalog() if item.get("id") in referenced_ids
            ]

        response = StockBehaviorTextBriefResponse(
            symbol=symbol,
            as_of_date=as_of_date_text,
            generated_by=model_name,
            status=status_value,
            brief=brief,
            evidence_catalog=evidence_catalog,
            disclaimer=TextBriefDisclaimer(
                version=TEXT_BRIEF_DISCLAIMER_VERSION,
                text=TEXT_BRIEF_DISCLAIMER_TEXT,
            ),
            limitations=limitations,
        )

        normalized_payload = (
            brief.model_dump(mode="json")
            if brief is not None
            else blocked_payload or {"limitations": limitations}
        )
        try:
            create_llm_response(
                self._db,
                symbol=symbol,
                as_of_date=as_of_date,
                kind=LLM_RESPONSE_KIND_TEXT_BRIEF,
                config_hash=config_hash,
                config_json=json.dumps(config, ensure_ascii=False, sort_keys=True),
                model_name=model_name,
                is_fallback=is_fallback,
                news_count=len(bundle.news),
                summary=(brief.headline if brief is not None else fallback_message),
                raw_llm_text=raw_llm_text,
                normalized_json=json.dumps(
                    normalized_payload,
                    ensure_ascii=False,
                ),
                # verification 不在對外回應裡，但留在存檔供稽核：status 降為 limited 時
                # 要能回答「是哪一條規則、哪個欄位造成的」。
                response_json=json.dumps(
                    {
                        **response.model_dump(mode="json"),
                        "verification": verification.model_dump(mode="json"),
                    },
                    ensure_ascii=False,
                ),
                latency_ms=latency_ms,
            )
            log_event(
                "text_brief.llm_response_saved",
                symbol=symbol,
                is_fallback=is_fallback,
                finish_reason=llm_meta.get("finish_reason"),
            )
        except Exception as exc:
            log_warn(
                "text_brief.llm_response_save_failed",
                symbol=symbol,
                finish_reason=llm_meta.get("finish_reason"),
                error_type=type(exc).__name__,
                error=str(exc)[:200],
            )
            self._db.rollback()

        log_event(
            "text_brief.result",
            symbol=symbol,
            as_of=as_of_date_text,
            status=status_value,
            model=model_name,
            llm_ms=latency_ms,
            key_days=len(brief.key_days) if brief is not None else 0,
            filtered=filtered_ids or "-",
            removed=removed_item_ids or "-",
            hard=len(compliance_violations),
            soft=len(soft_compliance_hits),
            unverified=unverified_numbers or "-",
            undercount=undercount_sections or "-",
            truncated=truncated_sections or "-",
            jargon=jargon_hits or "-",
        )
        return response
