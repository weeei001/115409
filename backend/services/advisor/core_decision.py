from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Any

from services.core_mode import CoreModeService
from trend_core import (
    CoreModePresetStore,
    build_price_chart_payload,
    build_trend_reasoning,
    normalize_core_mode_params,
    run_core_mode_pipeline,
)


class CoreDecisionService:
    def __init__(self, *, preset_store_path: Path) -> None:
        self._preset_store = CoreModePresetStore(preset_store_path)

    def _resolve_preset(self, *, preset_id: str | None, use_active_preset: bool) -> tuple[dict[str, Any], Any]:
        listed = self._preset_store.list_presets()
        presets = listed.get("presets") or []
        active = listed.get("active_preset")

        selected: dict[str, Any] | None = None
        if preset_id:
            selected = next((item for item in presets if item.get("id") == preset_id), None)
            if selected is None:
                raise ValueError("找不到指定的 preset")
        elif use_active_preset:
            selected = active
        else:
            selected = active

        if not selected:
            raise ValueError("目前沒有可用 preset")
        params = normalize_core_mode_params(selected.get("params") or {})
        return selected, params

    def build_decision(
        self,
        *,
        snapshot: dict[str, Any],
        as_of_date: date,
        preset_id: str | None,
        use_active_preset: bool,
    ) -> dict[str, Any]:
        selected_preset, params = self._resolve_preset(preset_id=preset_id, use_active_preset=use_active_preset)
        rows = [row for row in snapshot["market_rows"] if row.date <= as_of_date]
        if len(rows) < 60:
            raise ValueError("資料不足，無法產生核心趨勢判斷")

        pipeline = run_core_mode_pipeline(rows, params)
        latest_feature = pipeline["features"][-1]
        latest_score = pipeline["scores"][-1]
        latest_signal = pipeline["signals"][-1]
        signal_status = {
            "early_signal": latest_signal.early_signal,
            "formal_signal": latest_signal.formal_signal,
        }
        reasoning = build_trend_reasoning(latest_score, latest_signal, params)
        decision_payload = CoreModeService._build_decision_payload(
            trend_conclusion=latest_signal.trend_conclusion,
            confidence_level=latest_signal.confidence_level,
            reasoning=reasoning,
            signal_status=signal_status,
            reason_points=latest_signal.reason_points,
        )

        latest_technical = snapshot.get("latest_technical") or {}
        latest_institutional = snapshot.get("latest_institutional") or {}
        price_chart = build_price_chart_payload(
            rows,
            pipeline["signals"],
            pipeline["scores"],
            pipeline["trades"],
        )

        return {
            "symbol": snapshot["symbol"],
            "as_of_date": rows[-1].date.isoformat(),
            "active_preset": selected_preset,
            "preset_id": selected_preset.get("id"),
            "state_score": round(latest_score.state_score, 4),
            "trend_shape_score": round(latest_score.trend_shape_score, 4),
            "trend_score": round(latest_score.trend_score, 4),
            "weighted_score": round(latest_feature.weighted_score, 4),
            "trend_conclusion": latest_signal.trend_conclusion,
            "confidence_level": latest_signal.confidence_level,
            "condition_checks": decision_payload["condition_checks"],
            "early_signal_status": signal_status.get("early_signal"),
            "formal_signal_status": signal_status.get("formal_signal"),
            "reason_points": decision_payload["reason_points"],
            "risk_notes": decision_payload["key_risks"],
            "action_suggestion": decision_payload["action_suggestion"],
            "conclusion_summary": decision_payload["conclusion_summary"],
            "reasoning": reasoning,
            "technical_snapshot": {
                "date": latest_technical.get("date"),
                "ma5": latest_technical.get("ma5"),
                "ma20": latest_technical.get("ma20"),
                "ma60": latest_technical.get("ma60"),
                "rsi14": latest_technical.get("rsi14"),
                "macd_hist": latest_technical.get("macd_hist"),
            },
            "institutional_snapshot": {
                "date": latest_institutional.get("date"),
                "foreign_net": latest_institutional.get("foreign_net"),
                "trust_net": latest_institutional.get("trust_net"),
                "dealer_net": latest_institutional.get("dealer_net"),
                "total_net": latest_institutional.get("total_net"),
            },
            "price_chart": price_chart,
        }

