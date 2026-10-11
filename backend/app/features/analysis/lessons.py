"""Settle text-brief calls into short reviews that later briefs on the same stock may read.

A call is settled once its horizon has traded; the review records the date of the last close used,
and a brief only sees reviews settled by its own analysis date (no hindsight in historical re-runs).
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date
from typing import Any

from app.db.models.brief_lesson import BRIEF_LESSON_READY, BRIEF_LESSON_REJECTED, BriefLesson
from .compliance import scan_compliance_hits
from .track_record import HORIZONS

REVIEW_MAX_CHARS = 200
HORIZON_LABELS = {"short_1_5": "短線 1–5 個交易日", "swing_6_20": "波段 6–20 個交易日",
                  "medium_21_40": "中期 21–40 個交易日"}
STANCE_LABELS = {"bullish": "偏多", "mildly_bullish": "溫和偏多", "mildly_bearish": "溫和偏空", "bearish": "偏空"}

PAST_REVIEWS_GUIDANCE = """
<past_reviews>
payload.past_reviews 是本檔先前分析在期間到期後的檢討，依到期日由舊到新；result 是當時方向判斷的結果，benchmark_return_pct 是同期加權指數漲跌。
它只用來檢查本次推理是否重犯同類錯誤，不是本次證據：不得引用其 id，不得當成方向依據，也不要因為過去命中或失誤而偏向某一方向。市場狀態可能已經改變，本次判斷仍以其他欄位的資料為準。
</past_reviews>"""

REVIEW_SYSTEM_PROMPT = (
    "你在檢討一份已到期的台股個股 AI 分析。用 2 至 3 句台灣繁體中文寫成一段平鋪直敘的文字，"
    "不用條列、標題或 markdown，總長不超過 160 字：\n"
    "1. 引用提供的數字，說明這段期間個股與加權指數的實際漲跌，以及當時的方向判斷是否成立；"
    "期間太短、不足以檢驗原本理由時直接說明。\n"
    "2. 指出當時理由中，哪一項被結果支持或推翻。\n"
    "3. 寫下下次分析同類情境時要多檢查的一件事。\n"
    "只根據提供的內容，不補入其他公司事件、新聞或數字。不得提供買賣、加減碼、停損停利、目標價或資金配置等操作建議，"
    "不保證結果，也不預測未來股價。"
)


def lesson_scope(settings: Any) -> list[str]:
    """TEXT_BRIEF_LESSONS_SYMBOLS as upper-case codes in their configured order; "*" means every stock."""
    items = str(getattr(settings, "TEXT_BRIEF_LESSONS_SYMBOLS", "") or "").split(",")
    return list(dict.fromkeys(item.strip().upper() for item in items if item.strip()))


def lessons_enabled(settings: Any, symbol: str) -> bool:
    scope = lesson_scope(settings)
    return "*" in scope or symbol.strip().upper() in scope


@dataclass(frozen=True)
class Settlement:
    snapshot_id: int
    symbol: str
    as_of_date: date
    horizon: str
    days: int
    stance: str
    return_pct: float
    benchmark_return_pct: float | None
    result: str
    resolved_on: date


def select_settlements(snapshots: list[dict], items: list,
                       reviewed: dict[tuple[str, str], list[tuple[date, date]]]) -> list[Settlement]:
    """Due directional calls without a review, at most one per window per stock and horizon.

    Daily briefs overlap: twenty consecutive 20-day calls share most of their window and would yield
    near-identical reviews, so a call is skipped when its window overlaps a reviewed one, earlier or later
    and whether or not that review's brief is still inside the lookback, or one selected before it.
    ``snapshots`` and ``items`` are parallel, as returned by ``track_record.evaluate``; ``reviewed`` maps
    (symbol, horizon) to the (as_of_date, resolved_on) windows that already have a review.
    """
    due: dict[tuple[str, str], list[Settlement]] = {}
    for snapshot, item in zip(snapshots, items):
        for (key, days), outcome in zip(HORIZONS, item.outcomes):
            if outcome.result not in {"hit", "miss"}:
                continue
            due.setdefault((snapshot["symbol"], key), []).append(Settlement(
                snapshot_id=snapshot["id"], symbol=snapshot["symbol"], as_of_date=snapshot["as_of_date"],
                horizon=key, days=days, stance=outcome.stance, return_pct=outcome.return_pct,
                benchmark_return_pct=outcome.benchmark_return_pct, result=outcome.result,
                resolved_on=date.fromisoformat(outcome.resolved_on)))
    selected: list[Settlement] = []
    for group, calls in due.items():
        taken = list(reviewed.get(group, []))
        for call in sorted(calls, key=lambda item: item.as_of_date):
            # A window runs from the analysis date to its last close; one starting on another's last close
            # does not overlap it, matching "base + days" in trading days.
            if all(call.as_of_date >= end or start >= call.resolved_on for start, end in taken):
                selected.append(call)
                taken.append((call.as_of_date, call.resolved_on))
    return sorted(selected, key=lambda item: (item.resolved_on, item.symbol, item.horizon), reverse=True)


def review_prompt(settlement: Settlement, response_json: str | None) -> str | None:
    try:
        brief = json.loads(response_json or "{}").get("brief") or {}
        view = brief["forward_views"][settlement.horizon]
    except (ValueError, KeyError, TypeError, AttributeError):
        return None
    benchmark = ("缺少同期加權指數資料" if settlement.benchmark_return_pct is None
                 else f"加權指數 {settlement.benchmark_return_pct:+.2f}%")
    return "\n".join([
        f"股票：{settlement.symbol}",
        f"分析基準日：{settlement.as_of_date.isoformat()}",
        f"期間：{HORIZON_LABELS[settlement.horizon]}（到 {settlement.resolved_on.isoformat()} 收盤）",
        f"當時立場：{STANCE_LABELS.get(settlement.stance, settlement.stance)}",
        f"當時理由：{view.get('reason') or '未提供'}",
        f"當時的失效條件：{view.get('invalidation') or '未提供'}",
        f"當時摘要標題：{brief.get('headline') or '未提供'}",
        f"實際結果：個股 {settlement.return_pct:+.2f}%，{benchmark}；方向判斷"
        f"{'成立' if settlement.result == 'hit' else '不成立'}。",
    ])


def review_status(text: str) -> str:
    """Reject a review the brief must not read: empty, overlong or worded as advice."""
    if not text or len(text) > REVIEW_MAX_CHARS:
        return BRIEF_LESSON_REJECTED
    if any(hit.severity == "hard" for hit in scan_compliance_hits(text)):
        return BRIEF_LESSON_REJECTED
    return BRIEF_LESSON_READY


async def write_review(llm, settlement: Settlement, response_json: str | None) -> BriefLesson:
    prompt = review_prompt(settlement, response_json)
    if prompt is None:
        # Recorded as rejected, so an unreadable snapshot is not retried on every run.
        text, status = "", BRIEF_LESSON_REJECTED
    else:
        result = await llm.text(system_prompt=REVIEW_SYSTEM_PROMPT, prompt=prompt)
        text = " ".join(result.raw_text.split())
        status = BRIEF_LESSON_REJECTED if result.metadata.get("truncated") else review_status(text)
    return BriefLesson(symbol=settlement.symbol, as_of_date=settlement.as_of_date, horizon=settlement.horizon,
                       snapshot_id=settlement.snapshot_id, stance=settlement.stance,
                       return_pct=settlement.return_pct, benchmark_return_pct=settlement.benchmark_return_pct,
                       result=settlement.result, resolved_on=settlement.resolved_on, lesson=text[:2000],
                       status=status, model_name=getattr(llm, "model_name", None))
