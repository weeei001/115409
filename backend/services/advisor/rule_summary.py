from __future__ import annotations

from datetime import date
from typing import Any


def _fmt_number(value: Any, digits: int = 2) -> str:
    try:
        num = float(value)
    except (TypeError, ValueError):
        return "—"
    return f"{num:.{digits}f}"


def _fmt_signed_int(value: Any) -> str:
    try:
        num = int(round(float(value)))
    except (TypeError, ValueError):
        return "—"
    return f"{num:+,d}"


class RuleSummaryBuilder:
    """Build deterministic advisor summary text without calling LLM."""

    def build(
        self,
        *,
        symbol: str,
        as_of_date: date,
        core_decision: dict[str, Any],
        snapshot: dict[str, Any],
        credibility_summary: dict[str, Any] | None,
    ) -> list[str]:
        trend = str(core_decision.get("trend_conclusion") or "尚無結論")
        confidence = str(core_decision.get("confidence_level") or "未提供")
        checks = list(core_decision.get("condition_checks") or [])
        passed = sum(1 for item in checks if bool(item.get("passed")))
        total = len(checks)

        reason_points = [
            str(item).strip()
            for item in (core_decision.get("reason_points") or [])
            if str(item).strip()
        ]

        technical = dict(core_decision.get("technical_snapshot") or snapshot.get("latest_technical") or {})
        institutional = dict(core_decision.get("institutional_snapshot") or snapshot.get("latest_institutional") or {})

        first = (
            f"{symbol} 截至 {as_of_date.isoformat()} 的核心判斷為「{trend}」，"
            f"信心等級為「{confidence}」，條件檢查通過 {passed}/{total}。"
        )

        reasons = "；".join(reason_points[:2]) if reason_points else "目前尚未提供額外理由點。"
        second = f"主要依據：{reasons}"

        rsi = _fmt_number(technical.get("rsi14"))
        macd_hist = _fmt_number(technical.get("macd_hist"), digits=4)
        total_net = _fmt_signed_int(institutional.get("total_net"))
        third = f"技術與籌碼快照：RSI14 {rsi}、MACD 柱體 {macd_hist}、三大法人合計 {total_net}。"

        if credibility_summary:
            ac = _fmt_number(credibility_summary.get("ac") * 100 if credibility_summary.get("ac") is not None else None)
            wr = _fmt_number(
                credibility_summary.get("win_rate") * 100 if credibility_summary.get("win_rate") is not None else None
            )
            third = f"{third} 既有回測摘要：AC {ac}%、勝率 {wr}%（僅供可信度參考）。"

        return [first, second, third]
