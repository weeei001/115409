from __future__ import annotations

from dataclasses import asdict
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Optional

from crud import daily_price as crud_price
from crud import technical_indicator as crud_indicator
from crud.institutional_trade import get_by_symbol_range as crud_institutional_range
from database import SessionLocal
from trend_core import (
    CoreModePresetStore,
    MarketRow,
    build_core_mode_schema_payload,
    build_price_chart_payload,
    build_score_chart_payload,
    build_trend_reasoning,
    candidate_to_dict,
    normalize_core_mode_params,
    params_to_dict,
    run_core_mode_pipeline,
    search_best_core_mode_params,
    to_regime_dict,
    to_trade_dict,
)
from trend_core.core_mode_validation import ValidationConfig, evaluate_params_with_walk_forward


class CoreModeService:
    def __init__(self, *, preset_store_path: Path) -> None:
        self.preset_store = CoreModePresetStore(preset_store_path)

    @staticmethod
    def _status_label(passed: bool) -> str:
        return "通過" if passed else "未通過"

    @classmethod
    def _build_condition_checks(
        cls,
        *,
        reasoning: dict[str, Any],
        signal_status: dict[str, Optional[str]],
    ) -> list[dict[str, Any]]:
        check_map = {
            str(item.get("key")): item
            for item in reasoning.get("checks", [])
            if isinstance(item, dict) and item.get("key")
        }

        ordered_defs: list[tuple[str, str]] = [
            ("state_threshold", "狀態分數是否達標"),
            ("shape_threshold", "型態分數是否達標"),
            ("trend_threshold", "綜合趨勢分數是否達標"),
            ("breakout_pass", "是否有突破結構"),
            ("pullback_ok", "拉回深度是否合理"),
        ]

        checks: list[dict[str, Any]] = []
        for key, label in ordered_defs:
            base = check_map.get(key, {})
            passed = bool(base.get("passed"))
            checks.append(
                {
                    "key": key,
                    "label": label,
                    "passed": passed,
                    "status": cls._status_label(passed),
                    "value": base.get("value"),
                    "threshold": base.get("threshold"),
                }
            )

        early_signal = signal_status.get("early_signal")
        formal_signal = signal_status.get("formal_signal")
        checks.append(
            {
                "key": "early_signal",
                "label": "是否出現早期訊號",
                "passed": bool(early_signal),
                "status": cls._status_label(bool(early_signal)),
                "value": early_signal,
                "threshold": "需有早期訊號",
            }
        )
        checks.append(
            {
                "key": "formal_signal",
                "label": "是否出現正式訊號",
                "passed": bool(formal_signal),
                "status": cls._status_label(bool(formal_signal)),
                "value": formal_signal,
                "threshold": "需有正式訊號",
            }
        )
        return checks

    @staticmethod
    def _build_action_suggestion(
        *,
        trend_conclusion: str,
        confidence_level: str,
        signal_status: dict[str, Optional[str]],
        condition_checks: list[dict[str, Any]],
    ) -> str:
        check_map = {item["key"]: bool(item.get("passed")) for item in condition_checks}
        has_formal = bool(signal_status.get("formal_signal"))

        if trend_conclusion == "偏空":
            return "減碼"
        if trend_conclusion == "偏多":
            if has_formal and confidence_level in {"高", "中"} and check_map.get("pullback_ok", False):
                return "買進"
            if confidence_level == "低" or not check_map.get("pullback_ok", False):
                return "風險高"
            return "觀望"
        if trend_conclusion == "偏震盪":
            return "觀望" if confidence_level != "低" else "風險高"
        return "風險高" if confidence_level == "低" else "觀望"

    @staticmethod
    def _build_conclusion_summary(
        *,
        trend_conclusion: str,
        confidence_level: str,
        action_suggestion: str,
    ) -> str:
        if trend_conclusion == "偏多" and action_suggestion == "買進":
            return f"目前偏多且訊號集中，判斷合理，屬{confidence_level}信心，可考慮分批布局。"
        if trend_conclusion == "偏空":
            return f"目前結構偏弱，偏空判斷合理，屬{confidence_level}信心，建議先降風險。"
        if trend_conclusion == "偏震盪":
            return f"目前仍在區間整理，屬{confidence_level}信心，先觀察突破再決策。"
        if action_suggestion == "風險高":
            return f"條件尚未一致，屬{confidence_level}信心，暫不建議主動追價。"
        return f"目前趨勢訊號不集中，屬{confidence_level}信心，先以觀察為主。"

    @classmethod
    def _build_key_risks(
        cls,
        *,
        condition_checks: list[dict[str, Any]],
        confidence_level: str,
        signal_status: dict[str, Optional[str]],
    ) -> list[str]:
        risks: list[str] = []
        for item in condition_checks:
            if item.get("passed"):
                continue
            if item.get("key") in {"state_threshold", "shape_threshold", "trend_threshold", "breakout_pass", "pullback_ok"}:
                risks.append(f"{item.get('label')}未通過，趨勢延續性需保留。")
            if len(risks) >= 2:
                break

        if confidence_level == "低":
            risks.append("信心偏低，可能仍在雜訊區間，建議降低部位。")
        if not signal_status.get("formal_signal"):
            risks.append("尚未出現正式訊號，建議等待確認後再提高曝險。")

        if not risks:
            risks.append("目前未見明顯結構性風險，仍需嚴格執行停損。")
        return risks[:3]

    @classmethod
    def _build_decision_payload(
        cls,
        *,
        trend_conclusion: str,
        confidence_level: str,
        reasoning: dict[str, Any],
        signal_status: dict[str, Optional[str]],
        reason_points: list[str],
    ) -> dict[str, Any]:
        condition_checks = cls._build_condition_checks(reasoning=reasoning, signal_status=signal_status)
        action_suggestion = cls._build_action_suggestion(
            trend_conclusion=trend_conclusion,
            confidence_level=confidence_level,
            signal_status=signal_status,
            condition_checks=condition_checks,
        )
        conclusion_summary = cls._build_conclusion_summary(
            trend_conclusion=trend_conclusion,
            confidence_level=confidence_level,
            action_suggestion=action_suggestion,
        )
        key_risks = cls._build_key_risks(
            condition_checks=condition_checks,
            confidence_level=confidence_level,
            signal_status=signal_status,
        )
        return {
            "conclusion_summary": conclusion_summary,
            "condition_checks": condition_checks,
            "early_signal_status": signal_status.get("early_signal"),
            "formal_signal_status": signal_status.get("formal_signal"),
            "reason_points": reason_points[:3],
            "action_suggestion": action_suggestion,
            "key_risks": key_risks,
            "suggested_horizon": "未來 10~20 個交易日",
        }

    def get_schema(self) -> dict[str, Any]:
        payload = build_core_mode_schema_payload()
        preset_info = self.preset_store.list_presets()
        payload["active_preset"] = preset_info.get("active_preset")
        return payload

    def get_presets(self) -> dict[str, Any]:
        return self.preset_store.list_presets()

    def activate_preset(self, preset_id: str) -> dict[str, Any]:
        return self.preset_store.activate(preset_id)

    def save_preset(self, *, name: str, description: str, params: dict[str, Any], preset_id: str | None = None) -> dict[str, Any]:
        return self.preset_store.create_or_update_preset(
            name=name,
            description=description,
            params=params,
            preset_id=preset_id,
        )

    @staticmethod
    def _resolve_validation_config(request: dict[str, Any]) -> ValidationConfig:
        raw_mode = request.get("validation_mode") or "rolling_walk_forward"
        mode = raw_mode if raw_mode in {"rolling_walk_forward", "expanding_walk_forward"} else "rolling_walk_forward"

        rolling_settings = request.get("rolling_settings") or {}
        holdout_settings = request.get("holdout_settings") or {}

        def _to_int(value: Any) -> Optional[int]:
            try:
                return int(value)
            except (TypeError, ValueError):
                return None

        def _to_float(value: Any) -> Optional[float]:
            try:
                return float(value)
            except (TypeError, ValueError):
                return None

        step_days = _to_int(rolling_settings.get("step_days"))
        min_overlap_ratio = _to_float(rolling_settings.get("min_overlap_ratio"))

        holdout_enabled = bool(holdout_settings.get("enabled", True))
        holdout_days = _to_int(holdout_settings.get("holdout_days"))

        return ValidationConfig(
            mode=mode,
            step_days=step_days,
            min_overlap_ratio=min_overlap_ratio,
            holdout_enabled=holdout_enabled,
            holdout_days=holdout_days,
        )

    def _load_market_rows(self, *, symbol: str, start_date: date, end_date: date) -> list[MarketRow]:
        db = SessionLocal()
        try:
            warmup_start = start_date - timedelta(days=220)
            prices = crud_price.get_price_range(db, symbol=symbol, start_date=warmup_start, end_date=end_date)
            indicators = crud_indicator.get_indicators(db, symbol=symbol, start_date=warmup_start, end_date=end_date)
            institutional = crud_institutional_range(db, symbol=symbol, start_date=warmup_start, end_date=end_date)
        finally:
            db.close()

        indicator_map = {row.date: row for row in indicators}
        institutional_map = {row.date: row for row in institutional}

        out: list[MarketRow] = []
        for row in prices:
            if row.close is None:
                continue
            close = float(row.close)
            high = float(row.high) if row.high is not None else close
            low = float(row.low) if row.low is not None else close
            open_ = float(row.open) if row.open is not None else close
            volume = float(row.volume_shares or 0)

            ind = indicator_map.get(row.date)
            inst = institutional_map.get(row.date)

            out.append(
                MarketRow(
                    date=row.date,
                    open=open_,
                    high=high,
                    low=low,
                    close=close,
                    volume=volume,
                    ma5=float(ind.ma5) if ind and ind.ma5 is not None else None,
                    ma20=float(ind.ma20) if ind and ind.ma20 is not None else None,
                    ma60=float(ind.ma60) if ind and ind.ma60 is not None else None,
                    rsi14=float(ind.rsi14) if ind and ind.rsi14 is not None else None,
                    k_value=float(ind.k_value) if ind and ind.k_value is not None else None,
                    d_value=float(ind.d_value) if ind and ind.d_value is not None else None,
                    macd=float(ind.macd) if ind and ind.macd is not None else None,
                    macd_signal=float(ind.macd_signal) if ind and ind.macd_signal is not None else None,
                    macd_hist=float(ind.macd_hist) if ind and ind.macd_hist is not None else None,
                    total_net=float(inst.total_net) if inst and inst.total_net is not None else 0.0,
                    news_score=0.0,
                )
            )

        return out

    def run_core_mode(self, request: dict[str, Any]) -> dict[str, Any]:
        symbol = (request.get("symbol") or "").strip().upper()
        if not symbol:
            raise ValueError("symbol 為必填")

        date_range = request.get("date_range") or {}
        start_date = date.fromisoformat(date_range.get("start_date"))
        end_date = date.fromisoformat(date_range.get("end_date"))
        if start_date >= end_date:
            raise ValueError("date_range.start_date 必須早於 end_date")

        params = normalize_core_mode_params(request.get("params") or {})
        validation_config = self._resolve_validation_config(request)

        all_rows = self._load_market_rows(symbol=symbol, start_date=start_date, end_date=end_date)
        eval_rows = [row for row in all_rows if start_date <= row.date <= end_date]
        if len(eval_rows) < 80:
            raise ValueError("可用資料不足，至少需要約 80 個交易日")

        pipeline = run_core_mode_pipeline(eval_rows, params)
        latest_score = pipeline["scores"][-1]
        latest_signal = pipeline["signals"][-1]
        reasoning = build_trend_reasoning(latest_score, latest_signal, params)
        signal_status = {
            "early_signal": latest_signal.early_signal,
            "formal_signal": latest_signal.formal_signal,
        }
        decision_payload = self._build_decision_payload(
            trend_conclusion=latest_signal.trend_conclusion,
            confidence_level=latest_signal.confidence_level,
            reasoning=reasoning,
            signal_status=signal_status,
            reason_points=latest_signal.reason_points,
        )

        selected_eval = evaluate_params_with_walk_forward(eval_rows, params, validation_config=validation_config)

        def _append_profile(candidate: dict[str, Any], profile: str, reason: str) -> dict[str, Any]:
            out = dict(candidate)
            out["profile"] = profile
            out["selection_reason"] = reason
            return out

        run_optimization = bool(request.get("run_optimization", True))
        optimization_payload: dict[str, Any] = {
            "best_return_params": {
                "params": params_to_dict(params),
                "profile": "高報酬型",
                "selection_reason": "未啟用優化，暫以目前參數作為占位。",
            },
            "best_stable_params": {
                "params": params_to_dict(params),
                "profile": "穩定型",
                "selection_reason": "未啟用優化，暫以目前參數作為占位。",
            },
            "best_balanced_params": {
                "params": params_to_dict(params),
                "profile": "平衡型",
                "selection_reason": "未啟用優化，暫以目前參數作為占位。",
            },
            "coarse_count": 0,
            "refined_count": 0,
            "search_space": {},
            "validation_design": {},
        }
        comparison_candidates: list[dict[str, Any]] = []
        coarse_stage_candidates: list[dict[str, Any]] = []

        if run_optimization:
            search = search_best_core_mode_params(eval_rows, params, validation_config=validation_config)
            best_return = _append_profile(
                candidate_to_dict(search["best_return"]),
                "高報酬型",
                "以累積報酬、expectancy 與 profit factor 權重較高的目標函數排名第一。",
            )
            best_stable = _append_profile(
                candidate_to_dict(search["best_stable"]),
                "穩定型",
                "以 walk-forward 穩定性、較低回撤與跨 fold 一致性為優先。",
            )
            best_balanced = _append_profile(
                candidate_to_dict(search["best_balanced"]),
                "平衡型",
                "綜合 AC、expectancy、profit factor、future trend quality、max drawdown、stability 取得最佳平衡。",
            )
            top_candidates = [candidate_to_dict(item) for item in search["top_candidates"]]
            coarse_stage_candidates = [candidate_to_dict(item) for item in search["coarse_top_candidates"]]

            self.preset_store.replace_system_candidates(
                best_return=best_return,
                best_stable=best_stable,
                best_balanced=best_balanced,
                top_candidates=top_candidates,
            )

            optimization_payload = {
                "best_return_params": best_return,
                "best_stable_params": best_stable,
                "best_balanced_params": best_balanced,
                "coarse_count": search["coarse_count"],
                "refined_count": search["refined_count"],
                "search_space": search["search_space"],
                "validation_design": search["validation_design"],
            }
            comparison_candidates = top_candidates
        else:
            comparison_candidates = [candidate_to_dict(selected_eval)]

        summary = pipeline["summary"]
        summary_dict = asdict(summary)
        # 主摘要的 stability 要與 walk-forward 聚合一致，避免顯示固定 0。
        summary_dict["stability"] = selected_eval.aggregate_summary.stability

        return {
            "meta": {
                "symbol": symbol,
                "date_range": {
                    "start_date": start_date.isoformat(),
                    "end_date": end_date.isoformat(),
                },
                "as_of_date": eval_rows[-1].date.isoformat(),
                "sample_count": len(eval_rows),
                "validation_mode": validation_config.mode,
                "rolling_settings": {
                    "step_days": validation_config.step_days,
                    "min_overlap_ratio": validation_config.min_overlap_ratio,
                },
                "holdout_settings": {
                    "enabled": validation_config.holdout_enabled,
                    "holdout_days": validation_config.holdout_days,
                },
                "ac_definition": "在 n 被標記為趨勢候選/正式趨勢的樣本中，僅計入具備完整 n+1~n+20 未來窗的樣本，其趨勢品質達標比例",
                "tail_execution_policy": "訊號日 n、成交日 n+1；尾端無 n+1 時不開新倉，且未平倉部位不以同日 close 強平、直接排除績效",
                "tail_position_excluded": bool(pipeline.get("backtest_meta", {}).get("tail_position_excluded")),
            },
            "summary": {
                **summary_dict,
                "used_params": params_to_dict(params),
                "trend_conclusion": latest_signal.trend_conclusion,
                "confidence_level": latest_signal.confidence_level,
                "signal_status": signal_status,
                "reasoning": reasoning,
                **decision_payload,
            },
            "price_chart": build_price_chart_payload(
                eval_rows,
                pipeline["signals"],
                pipeline["scores"],
                pipeline["trades"],
            ),
            "score_chart": build_score_chart_payload(pipeline["scores"]),
            "trades": [to_trade_dict(t) for t in pipeline["trades"]],
            "equity_curve": pipeline["equity_curve"],
            "walk_forward": {
                "folds": [
                    {
                        "fold_id": fold.fold_id,
                        "overlap_ratio": round(fold.overlap_ratio, 4),
                        "train_start": fold.train_start.isoformat(),
                        "train_end": fold.train_end.isoformat(),
                        "validation_start": fold.validation_start.isoformat(),
                        "validation_end": fold.validation_end.isoformat(),
                        "test_start": fold.test_start.isoformat(),
                        "test_end": fold.test_end.isoformat(),
                        "validation_metrics": asdict(fold.validation_metrics),
                        "test_metrics": asdict(fold.test_metrics),
                    }
                    for fold in selected_eval.walk_forward
                ],
                "aggregate": asdict(selected_eval.aggregate_summary),
                "holdout": asdict(selected_eval.holdout_summary),
            },
            "regime_breakdown": [to_regime_dict(item) for item in pipeline["regime"]],
            "comparison_candidates": comparison_candidates,
            "coarse_stage_candidates": coarse_stage_candidates,
            "optimization": optimization_payload,
            "active_preset": self.preset_store.list_presets().get("active_preset"),
        }

    def apply_active_preset(self, *, symbol: str, as_of_date: Optional[date] = None) -> dict[str, Any]:
        symbol = symbol.strip().upper()
        if not symbol:
            raise ValueError("symbol 為必填")

        _, params, preset_name = self.preset_store.get_active_params()

        end_date = as_of_date or date.today()
        start_date = end_date - timedelta(days=360)

        rows = self._load_market_rows(symbol=symbol, start_date=start_date, end_date=end_date)
        eval_rows = [row for row in rows if row.date <= end_date]
        if len(eval_rows) < 60:
            raise ValueError("資料不足，無法套用 active preset 分析")

        pipeline = run_core_mode_pipeline(eval_rows, params)
        latest_feature = pipeline["features"][-1]
        latest_score = pipeline["scores"][-1]
        latest_signal = pipeline["signals"][-1]
        signal_status = {
            "early_signal": latest_signal.early_signal,
            "formal_signal": latest_signal.formal_signal,
        }
        reasoning = build_trend_reasoning(latest_score, latest_signal, params)
        decision_payload = self._build_decision_payload(
            trend_conclusion=latest_signal.trend_conclusion,
            confidence_level=latest_signal.confidence_level,
            reasoning=reasoning,
            signal_status=signal_status,
            reason_points=latest_signal.reason_points,
        )

        return {
            "symbol": symbol,
            "preset_name": preset_name,
            "as_of_date": eval_rows[-1].date.isoformat(),
            "scores": {
                "state_score": round(latest_score.state_score, 4),
                "trend_shape_score": round(latest_score.trend_shape_score, 4),
                "trend_score": round(latest_score.trend_score, 4),
                "weighted_score": round(latest_feature.weighted_score, 4),
            },
            "signal_status": signal_status,
            "key_features": {
                "breakout_strength": round(latest_feature.breakout_strength, 4),
                "pullback_depth": round(latest_feature.pullback_depth, 4),
                "trend_efficiency": round(latest_feature.trend_efficiency, 4),
                "volume_ratio": round(latest_feature.volume_ratio, 4),
            },
            "analysis_summary": {
                "reason_points": decision_payload["reason_points"],
                "suggested_horizon": decision_payload["suggested_horizon"],
                "conclusion_summary": decision_payload["conclusion_summary"],
                "key_risks": decision_payload["key_risks"],
            },
            "trend_conclusion": latest_signal.trend_conclusion,
            "confidence_level": latest_signal.confidence_level,
            "reasoning": reasoning,
            "conclusion_summary": decision_payload["conclusion_summary"],
            "condition_checks": decision_payload["condition_checks"],
            "early_signal_status": decision_payload["early_signal_status"],
            "formal_signal_status": decision_payload["formal_signal_status"],
            "reason_points": decision_payload["reason_points"],
            "action_suggestion": decision_payload["action_suggestion"],
            "key_risks": decision_payload["key_risks"],
        }
