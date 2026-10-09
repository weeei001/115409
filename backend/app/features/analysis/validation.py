"""Pure normalization and compliance gates for the public brief."""
from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from typing import Any
from pydantic import ValidationError
from .schemas import (RawStockBehaviorTextBrief, RawTextBriefClaim, RawTextBriefForwardView,
    RawTextBriefKeyDay, RawTextBriefRisk, RawTextBriefWatchPoint, StockBehaviorTextBrief,
    TextBriefClaim, TextBriefForwardView, TextBriefKeyDay, TextBriefRisk, TextBriefWatchPoint)
from .compliance import ComplianceHit, scan_compliance_hits
from .evidence import EvidenceBundle
from datetime import date

MAX_LLM_NEWS_SOURCES = 20
ANALYSIS_LANGUAGE = "zh-TW"
RAG_DEFAULT_NEWS_LOOKBACK_DAYS = 60
RAG_DEFAULT_MAX_NEWS_EVENTS = 20
NEWS_SUMMARY_CHARS: int | None = None
TEXT_BRIEF_SCHEMA_VERSION = "text-first-v1"
TEXT_BRIEF_TARGET_COUNTS = {"key_days": 3, "watch_points": 2}
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
JARGON_TERMS_RE = re.compile(
    r"MACD|RSI|KDJ|KD值|KD|布林(?:通道|線)?|乖離|黃金交叉|死亡交叉|K值|D值|J值|"
    r"隨機指標|相對強弱|指數平滑異同"
)
FORWARD_CONDITION_KEYS = frozenset({"trigger", "invalidation"})
FORWARD_PRICE_RE = re.compile(r"(?<![\d.,])([\d.,]+(?:\s*(?:至|到|[-–—~～、/]|及|與|和|或)\s*[\d.,]+)*)\s*(?:元|塊)")
TEXT_BRIEF_NO_GUIDANCE_LIMITATION = "本分析未涵蓋公司自提財測，展望類資訊僅來自媒體報導。"
TEXT_BRIEF_DISCLAIMER_VERSION = "v1"
TEXT_BRIEF_DISCLAIMER_TEXT = (
    "本內容由 AI 系統彙整公開資訊自動產生，僅供參考，不構成投資建議或個股買賣依據；"
    "投資人應自行獨立判斷並自負投資風險。行情與公告請以臺灣證券交易所、"
    "證券櫃檯買賣中心及公開資訊觀測站公告為準。"
)
TEXT_BRIEF_UNAVAILABLE_MESSAGE = "模型輸出無法解析，本次無法提供簡報。"
TEXT_BRIEF_COMPLIANCE_UNAVAILABLE_MESSAGE = "簡報內容未通過合規檢查，本次無法提供。"
TEXT_BRIEF_CACHE_MISS_LIMITATION = "目前沒有可用的已存 AI 分析，排程更新後才會出現。"
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
TEXT_BRIEF_MISSING_TRIGGER = "本次未提供可核對的觸發條件。"


def _price_mentions(text: str, *, condition: bool = False):
    """Keep monetary facts such as EPS out of stock-price checks."""
    for match in FORWARD_PRICE_RE.finditer(text):
        start = max(text.rfind(char, 0, match.start()) for char in "。；;，,\n") + 1
        prefix = text[start:match.start()]
        end = min((pos for char in "。；;，,\n" if (pos := text.find(char, match.end())) >= 0), default=len(text))
        suffix = text[match.end():end]
        subjects = list(re.finditer(
            r"(?P<financial>EPS|每股盈餘|營收|獲利|盈餘|股利|盤價|產品售價)"
            r"|(?P<market>股價|收盤|價位|支撐|壓力|防守|買點|賣點|高點|低點)", prefix, re.I))
        if subjects:
            if subjects[-1].lastgroup == "market":
                yield match
        elif (condition or re.search(r"價格|突破|站上|跌破|守住|失守", prefix)
              or re.search(r"股價|收盤|價位|支撐|壓力|防守|買點|賣點", suffix)):
            yield match


def _is_price_scenario(text: str, match: re.Match) -> bool:
    start = max(text.rfind(char, 0, match.start()) for char in "。；;，,\n") + 1
    prefix = text[start:match.start()]
    markers = list(re.finditer(r"情境假設|假設門檻", prefix))
    # 「若收盤跌破」 conditions on a future close; only an observed close is a historical claim.
    return bool(markers) and not re.search(
        r"已(?:收盤|成交|突破|站上|跌破)|實際(?:收盤|成交)|歷史(?:高點|低點)"
        r"|收盤(?!價?\s*(?:跌破|站上|站回|突破|低於|高於|守住|失守|回到|跌回|回落|回升))",
        prefix[markers[-1].end():] if markers else prefix)


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

def _normalize_text_brief_forward_views(
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

def _normalize_text_brief_payload(
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
        "key_days": _normalize_text_brief_items(
            raw["key_days"],
            raw_model=RawTextBriefKeyDay,
            strict_model=TextBriefKeyDay,
            id_prefix="kd",
            section="key_days",
            discarded=discarded,
        ),
        "headline": raw["headline"],
        "risks": _normalize_text_brief_items(
            raw["risks"],
            raw_model=RawTextBriefRisk,
            strict_model=TextBriefRisk,
            id_prefix="rk",
            section="risks",
            discarded=discarded,
        ),
        "watch_points": _normalize_text_brief_items(
            raw["watch_points"],
            raw_model=RawTextBriefWatchPoint,
            strict_model=TextBriefWatchPoint,
            id_prefix="wp",
            section="watch_points",
            discarded=discarded,
        ),
        "forward_views": _normalize_text_brief_forward_views(
            raw["forward_views"], discarded=discarded
        ),
        "overall_stance": raw["overall_stance"],
        "confidence": raw["confidence"],
        "confidence_reason": raw["confidence_reason"],
        "limitations": raw["limitations"],
    }
    for section, prefix in claim_sections:
        normalized[section] = _normalize_text_brief_items(
            raw[section],
            raw_model=RawTextBriefClaim,
            strict_model=TextBriefClaim,
            id_prefix=prefix,
            section=section,
            discarded=discarded,
        )

    _truncate_oversized_sections(normalized, truncated=truncated)

    try:
        return StockBehaviorTextBrief.model_validate(normalized), discarded, truncated
    except ValidationError as exc:
        return None, discarded, truncated

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
                    if isinstance(evidence_id, str) and evidence_id in allowed_ids:
                        if evidence_id not in kept:
                            kept.append(evidence_id)
                    else:
                        filtered_ids.append(str(evidence_id))
                value[key] = kept
            else:
                _filter_text_brief_evidence_ids(
                    item,
                    allowed_ids=allowed_ids,
                    filtered_ids=filtered_ids,
                )
    elif isinstance(value, list):
        for item in value:
            _filter_text_brief_evidence_ids(
                item,
                allowed_ids=allowed_ids,
                filtered_ids=filtered_ids,
            )

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

def _historical_prices(bundle: EvidenceBundle) -> dict[str, Decimal]:
    prices = {}
    for row in bundle.daily_timeline + bundle.long_term_anchor:
        try:
            if date.fromisoformat(str(row.get("date"))) > bundle.as_of_date:
                continue
            value = (row.get("close") if "close" in row else row.get("value")
                     if row.get("field") in {"high_1y", "low_1y"} else None)
            price = Decimal(str(value))
            if price.is_finite() and price > 0:
                prices[row["id"]] = price
        except (ValueError, InvalidOperation):
            continue
    return prices


def _scan_text_brief_compliance(value: Any, *, prices: dict[str, Decimal] | None = None) -> list[ComplianceHit]:
    hits = []
    if isinstance(value, list):
        for item in value:
            hits.extend(_scan_text_brief_compliance(item, prices=prices))
    elif isinstance(value, dict):
        cited_prices = {(prices or {})[ref] for ref in value.get("evidence_ids", []) if ref in (prices or {})}
        cites_news = any(str(ref).startswith("nw_") for ref in value.get("evidence_ids") or [])
        for key, text in value.items():
            if key in TEXT_BRIEF_COMPLIANCE_TEXT_KEYS and isinstance(text, str):
                condition = key in FORWARD_CONDITION_KEYS
                matches = list(_price_mentions(text, condition=condition))
                amounts = [amount for match in matches for amount in re.findall(r"[\d.,]+", match.group(1))]
                valid_amounts = bool(amounts) and all(
                    re.fullmatch(r"(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?", amount)
                    and Decimal(amount.replace(",", "")) > 0 for amount in amounts)
                grounded = valid_amounts and all(Decimal(amount.replace(",", "")) in cited_prices for amount in amounts)
                scenarios = [condition and bool(cited_prices) and _is_price_scenario(text, match) for match in matches]
                supported = valid_amounts and all(scenario or all(
                    Decimal(amount.replace(",", "")) in cited_prices
                    for amount in re.findall(r"[\d.,]+", match.group(1)))
                    for match, scenario in zip(matches, scenarios))
                if any(scenarios) and valid_amounts and not grounded:
                    hits.append(ComplianceHit("情境價位-soft", "soft", text))
                hits.extend(scan_compliance_hits(text, grounded_condition=supported, cites_news=cites_news))
                if condition and amounts and not supported:
                    hits.append(ComplianceHit("前瞻價位-hard", "hard", text))
            elif key == "limitations" and isinstance(text, list):
                for entry in text:
                    if isinstance(entry, str):
                        hits.extend(scan_compliance_hits(entry))
            else:
                hits.extend(_scan_text_brief_compliance(text, prices=prices))
    return hits

def _apply_text_brief_compliance_gate(
    brief_payload: dict[str, Any], *, bundle: EvidenceBundle | None = None, allow_partial_forward_views: bool = False,
) -> tuple[list[str], list[str], list[str], bool]:
    removed_ids: list[str] = []
    hard_violations: list[str] = []
    soft_hits: list[str] = []
    prices = _historical_prices(bundle) if bundle is not None else {}

    def check(item):
        return _scan_text_brief_compliance(item, prices=prices)

    def record(hits):
        hard_violations.extend(f"{hit.rule}: {hit.snippet}" for hit in hits if hit.severity == "hard")
        soft_hits.extend(f"{hit.rule}: {hit.snippet}" for hit in hits if hit.severity == "soft")
        return any(hit.severity == "hard" for hit in hits)

    for section in TEXT_BRIEF_ITEM_SECTIONS:
        kept = []
        for item in brief_payload[section]:
            if record(check(item)):
                # Like a forward view's invalidation, an invalid trigger does not invalidate the risk itself.
                rest = {key: value for key, value in item.items() if key != "trigger"}
                if section == "risks" and not any(hit.severity == "hard" for hit in check(rest)):
                    item["trigger"] = TEXT_BRIEF_MISSING_TRIGGER
                    removed_ids.append(f"{item['id']}.trigger")
                    kept.append(item)
                else:
                    removed_ids.append(item["id"])
            else:
                kept.append(item)
        brief_payload[section] = kept

    blocked = False
    for horizon, view in brief_payload["forward_views"].items():
        if record(check(view)):
            # An invalid condition does not invalidate a supported explanation.
            explanation = {key: value for key, value in view.items() if key != "invalidation"}
            if not any(hit.severity == "hard" for hit in check(explanation)):
                view["invalidation"] = "本次未提供可核對的失效條件。"
                removed_ids.append(f"forward_views.{horizon}.invalidation")
                brief_payload["confidence"] = "low"
            elif not allow_partial_forward_views:
                blocked = True
            else:
                removed_ids.append(f"forward_views.{horizon}")
                brief_payload["forward_views"][horizon] = {
                    "stance": "uncertain",
                    "reason": "此期間展望未通過內容檢查，暫不提供方向判讀。",
                    "invalidation": "缺少通過檢查的失效條件。",
                    "evidence_ids": [],
                    "validation_status": "rejected",
                }

    has_direction = any(view["stance"] != "uncertain" and view.get("evidence_ids")
                        and view.get("validation_status") != "rejected"
                        for view in brief_payload["forward_views"].values())
    if any(f"forward_views.{horizon}" in removed_ids for horizon in brief_payload["forward_views"]):
        if not has_direction:
            brief_payload["overall_stance"] = "uncertain"
        brief_payload["confidence"] = "low"
        brief_payload["confidence_reason"] = "部分期間的分析依據無法確認，信心調降；請參考其餘有依據的期間判斷。"
    elif any(item.endswith(".invalidation") for item in removed_ids):
        brief_payload["confidence_reason"] = "部分失效條件未通過檢查，已保留有依據的方向與理由，信心調降。"

    refs = list(_text_brief_referenced_ids(brief_payload))
    replacements = {"headline": "依可核對資料整理個股現況與展望",
                    "confidence_reason": "部分文字未通過檢查，僅保留有依據的分析，信心調降。"}
    for key, replacement in replacements.items():
        if record(check({key: brief_payload[key], "evidence_ids": refs})):
            if allow_partial_forward_views:
                brief_payload[key] = replacement
                brief_payload["confidence"] = "low"
                removed_ids.append(key)
            else:
                blocked = True
    kept_limits = []
    for index, text in enumerate(brief_payload["limitations"]):
        if record(check({"text": text, "claim_type": "limitation", "evidence_ids": refs})):
            if allow_partial_forward_views:
                removed_ids.append(f"limitations[{index}]")
                brief_payload["confidence"] = "low"
                continue
            blocked = True
        kept_limits.append(text)
    brief_payload["limitations"] = kept_limits
    if any(not brief_payload[section] for section in TEXT_BRIEF_ITEM_SECTIONS if section != "source_divergences"):
        if not has_direction:
            brief_payload["overall_stance"] = "uncertain"
        brief_payload["confidence"] = "low"
        brief_payload["confidence_reason"] = "部分項目缺少分析依據，信心調降；方向判斷僅依現有可用資料。"
    return (
        removed_ids,
        hard_violations,
        soft_hits,
        blocked or not any(brief_payload[section] for section in TEXT_BRIEF_ITEM_SECTIONS),
    )

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
                    _text_brief_referenced_ids(item)
                )
    elif isinstance(value, list):
        for item in value:
            referenced.update(
                _text_brief_referenced_ids(item)
            )
    return referenced

def _backfill_key_days(
    brief_payload: dict[str, Any],
    *,
    bundle: EvidenceBundle,
    as_of_date: date,
    discarded: list[str],
    future_dated: list[str],
) -> None:
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

def _collect_jargon_hits(brief_payload: dict[str, Any]) -> list[str]:
    hits: list[str] = []
    for text in _text_brief_compliance_texts(brief_payload):
        hits.extend(JARGON_TERMS_RE.findall(text))
    return list(dict.fromkeys(hits))

def _undercount_sections(brief_payload: dict[str, Any]) -> list[str]:
    return [
        f"{section}<{minimum}"
        for section, minimum in TEXT_BRIEF_TARGET_COUNTS.items()
        if len(brief_payload.get(section) or []) < minimum
    ]
