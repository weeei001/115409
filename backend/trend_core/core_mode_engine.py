from __future__ import annotations

from dataclasses import asdict
from datetime import date
from statistics import mean, pstdev
from typing import Any, Optional

from .core_mode_types import (
    BacktestSummary,
    ConfidenceLevel,
    CoreModeParams,
    FeatureRow,
    MarketRow,
    RegimeBucketSummary,
    ScoreRow,
    SignalRow,
    TradeRecord,
    TrendConclusion,
    WalkForwardFoldSummary,
    clip,
)

_DEFAULT_HORIZON = 20


def _safe_mean(values: list[float]) -> float:
    return mean(values) if values else 0.0


def _safe_div(numerator: float, denominator: float, fallback: float = 0.0) -> float:
    if denominator == 0:
        return fallback
    return numerator / denominator


def _linear_quantile(sorted_values: list[float], q: float) -> float:
    if not sorted_values:
        return 0.0
    if len(sorted_values) == 1:
        return sorted_values[0]
    q = clip(q, 0.0, 1.0)
    pos = (len(sorted_values) - 1) * q
    lower = int(pos)
    upper = min(len(sorted_values) - 1, lower + 1)
    weight = pos - lower
    return (sorted_values[lower] * (1.0 - weight)) + (sorted_values[upper] * weight)


def _to_strength(value: Optional[float], scale: float = 1.0) -> float:
    if value is None:
        return 0.0
    if scale <= 0:
        scale = 1.0
    return clip(value / scale)


def _window(values: list[Any], end_idx: int, length: int, *, include_current: bool = True) -> list[Any]:
    if length <= 0:
        return []
    if include_current:
        start = max(0, end_idx - length + 1)
        return values[start : end_idx + 1]
    start = max(0, end_idx - length)
    return values[start:end_idx]


def compute_feature_rows(rows: list[MarketRow], params: CoreModeParams) -> list[FeatureRow]:
    if not rows:
        return []

    closes = [r.close for r in rows]
    volumes = [r.volume for r in rows]
    total_nets = [r.total_net or 0.0 for r in rows]

    features: list[FeatureRow] = []

    for idx, row in enumerate(rows):
        close = row.close

        prev_breakout_window = _window(closes, idx, params.breakout_lookback, include_current=False)
        breakout_line = max(prev_breakout_window) if prev_breakout_window else close
        breakout_strength = clip(_safe_div(close - breakout_line, breakout_line if breakout_line else 1.0) / 0.08)

        momentum_window = _window(closes, idx, params.momentum_window, include_current=True)
        base_close = momentum_window[0] if momentum_window else close
        if base_close <= 0:
            base_close = close
        return_window = _safe_div(close - base_close, base_close)

        prev_volume_window = _window(volumes, idx - len(momentum_window), params.momentum_window, include_current=True)
        curr_volume_mean = _safe_mean(momentum_window and volumes[max(0, idx - len(momentum_window) + 1) : idx + 1] or [row.volume])
        prev_volume_mean = _safe_mean(prev_volume_window)
        volume_ratio = curr_volume_mean / prev_volume_mean if prev_volume_mean > 0 else 1.0

        abs_moves = [abs(momentum_window[i] - momentum_window[i - 1]) for i in range(1, len(momentum_window))]
        efficiency = _safe_div(abs(close - base_close), sum(abs_moves), fallback=0.0)
        trend_efficiency = clip(efficiency / 0.85, 0.0, 1.0)

        recent_peak = max(momentum_window) if momentum_window else close
        pullback_depth = _safe_div(recent_peak - close, recent_peak if recent_peak else 1.0)

        ma_terms = []
        if row.ma20:
            ma_terms.append(_to_strength(_safe_div(close - row.ma20, row.ma20), 0.03))
        if row.ma5 and row.ma20:
            ma_terms.append(_to_strength(_safe_div(row.ma5 - row.ma20, row.ma20), 0.03))
        if row.ma20 and row.ma60:
            ma_terms.append(_to_strength(_safe_div(row.ma20 - row.ma60, row.ma60), 0.04))
        ma_score = _safe_mean(ma_terms)

        macd_terms = []
        if row.macd is not None and row.macd_signal is not None:
            macd_terms.append(0.6 * _to_strength(row.macd - row.macd_signal, 0.8))
        if row.macd_hist is not None:
            macd_terms.append(0.4 * _to_strength(row.macd_hist, 0.8))
        macd_score = sum(macd_terms)

        rsi_score = 0.0 if row.rsi14 is None else clip((row.rsi14 - 50.0) / 25.0)
        kd_score = 0.0
        if row.k_value is not None and row.d_value is not None:
            kd_score = clip((row.k_value - row.d_value) / 20.0)

        technical_score = clip((0.40 * ma_score) + (0.25 * macd_score) + (0.20 * rsi_score) + (0.15 * kd_score))

        institutional_window = _window(total_nets, idx, 20, include_current=True)
        sum_net = sum(institutional_window)
        avg_abs_net = _safe_mean([abs(v) for v in institutional_window]) or 1.0
        sum_strength = clip(sum_net / (avg_abs_net * max(1, len(institutional_window))))
        latest_strength = clip((row.total_net or 0.0) / (avg_abs_net * 3.0))
        institutional_score = clip((0.7 * sum_strength) + (0.3 * latest_strength))

        return_score = clip(return_window / 0.10)
        vol_amp = clip(volume_ratio - 1.0)
        volume_score = (1.0 if return_window >= 0 else -1.0) * vol_amp
        momentum_score = clip((0.7 * return_score) + (0.3 * volume_score))

        news_score = clip(row.news_score)

        weighted_score = clip(
            (0.38 * technical_score)
            + (0.30 * institutional_score)
            + (0.15 * news_score)
            + (0.17 * momentum_score)
        )

        features.append(
            FeatureRow(
                date=row.date,
                close=close,
                breakout_line=breakout_line,
                breakout_strength=breakout_strength,
                return_window=return_window,
                volume_ratio=volume_ratio,
                trend_efficiency=trend_efficiency,
                pullback_depth=pullback_depth,
                technical_score=technical_score,
                institutional_score=institutional_score,
                momentum_score=momentum_score,
                news_score=news_score,
                weighted_score=weighted_score,
            )
        )

    return features


def compute_score_rows(rows: list[MarketRow], features: list[FeatureRow], params: CoreModeParams) -> list[ScoreRow]:
    if not rows or not features:
        return []

    scores: list[ScoreRow] = []

    for idx, feature in enumerate(features):
        ma20_now = rows[idx].ma20
        ma20_prev = rows[idx - 5].ma20 if idx >= 5 else None
        ma_slope = 0.0
        if ma20_now is not None and ma20_prev is not None and ma20_prev != 0:
            ma_slope = _safe_div(ma20_now - ma20_prev, ma20_prev)

        slope_score = clip(ma_slope / 0.03)
        pullback_score = clip(1.0 - _safe_div(feature.pullback_depth, max(params.max_pullback_depth, 1e-6)), -1.0, 1.0)
        efficiency_score = clip((feature.trend_efficiency - 0.5) / 0.5)

        state_score = clip(
            (0.55 * feature.weighted_score)
            + (0.25 * feature.momentum_score)
            + (0.20 * feature.institutional_score)
        )

        trend_shape_score = clip(
            (0.35 * feature.breakout_strength)
            + (0.25 * slope_score)
            + (0.25 * efficiency_score)
            + (0.15 * pullback_score)
        )

        trend_score = clip(
            (0.45 * state_score)
            + (0.35 * trend_shape_score)
            + (0.20 * feature.breakout_strength)
        )

        breakout_pass = feature.breakout_strength > 0.10
        pullback_ok = feature.pullback_depth <= params.max_pullback_depth
        acceptable_shape = feature.trend_efficiency >= 0.45

        scores.append(
            ScoreRow(
                date=feature.date,
                state_score=state_score,
                trend_shape_score=trend_shape_score,
                trend_score=trend_score,
                breakout_pass=breakout_pass,
                pullback_ok=pullback_ok,
                acceptable_shape=acceptable_shape,
            )
        )

    return scores


def _classify_conclusion(score: ScoreRow, params: CoreModeParams) -> TrendConclusion:
    if (
        score.trend_score >= params.trend_threshold
        and score.state_score >= params.state_threshold
        and score.trend_shape_score >= params.shape_threshold
    ):
        return "偏多"
    if score.trend_score <= -(params.trend_threshold * 0.8):
        return "偏空"
    if abs(score.trend_score) < (params.trend_threshold * 0.45):
        return "趨勢不明"
    return "偏震盪"


def _classify_confidence(score: ScoreRow, params: CoreModeParams) -> ConfidenceLevel:
    passed = 0
    if score.state_score >= params.state_threshold:
        passed += 1
    if score.trend_shape_score >= params.shape_threshold:
        passed += 1
    if score.trend_score >= params.trend_threshold:
        passed += 1
    if score.breakout_pass:
        passed += 1
    if score.pullback_ok:
        passed += 1
    if score.acceptable_shape:
        passed += 1

    if passed >= 5 and score.trend_score >= params.trend_threshold * 1.2:
        return "高"
    if passed >= 3:
        return "中"
    return "低"


def compute_signal_rows(features: list[FeatureRow], scores: list[ScoreRow], params: CoreModeParams) -> list[SignalRow]:
    signals: list[SignalRow] = []

    for feature, score in zip(features, scores, strict=True):
        early_signal: Optional[str] = None
        formal_signal: Optional[str] = None

        if score.breakout_pass and score.state_score >= params.state_threshold * 0.80 and score.trend_score >= params.trend_threshold * 0.80:
            early_signal = "偏多候選"
        elif feature.breakout_strength >= 0.25:
            early_signal = "突破預警"
        elif score.state_score >= params.state_threshold * 0.75 and feature.momentum_score > 0:
            early_signal = "轉強觀察"

        if (
            score.state_score >= params.state_threshold
            and score.trend_shape_score >= params.shape_threshold
            and score.trend_score >= params.trend_threshold
            and score.breakout_pass
            and score.pullback_ok
            and score.acceptable_shape
        ):
            formal_signal = "確認買進"
        elif (
            score.trend_score >= params.trend_threshold * 1.1
            and score.state_score >= params.state_threshold
            and score.trend_shape_score >= params.shape_threshold
            and score.breakout_pass
            and score.pullback_ok
        ):
            formal_signal = "趨勢成立"

        conclusion = _classify_conclusion(score, params)
        confidence = _classify_confidence(score, params)

        reason_points = []
        if conclusion == "偏多":
            reason_points.append("狀態、型態與綜合趨勢分數同時達標")
        elif conclusion == "偏空":
            reason_points.append("綜合趨勢分數轉負，價格結構偏弱")
        elif conclusion == "偏震盪":
            reason_points.append("趨勢分數未形成一致方向，屬區間震盪")
        else:
            reason_points.append("有效趨勢訊號不足，暫列趨勢不明")

        if not score.breakout_pass:
            reason_points.append("尚未形成有效突破結構")
        if not score.pullback_ok:
            reason_points.append("拉回深度超出容許範圍")
        if score.state_score < params.state_threshold:
            reason_points.append("狀態分數未達門檻")

        reason_points = reason_points[:3]

        signals.append(
            SignalRow(
                date=feature.date,
                trend_conclusion=conclusion,
                confidence_level=confidence,
                early_signal=early_signal,
                formal_signal=formal_signal,
                is_trend_candidate=(early_signal is not None or formal_signal is not None),
                reason_points=reason_points,
            )
        )

    return signals


def compute_future_trend_quality(rows: list[MarketRow], horizon: int = _DEFAULT_HORIZON) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    closes = [r.close for r in rows]

    for idx, close in enumerate(closes):
        start = idx + 1
        end = start + horizon
        # 正式 future label 必須有完整 n+1~n+horizon 交易日；不足者一律標記 unavailable。
        if start >= len(closes) or end > len(closes):
            out.append({"quality": 0.0, "passed": False, "available": False})
            continue

        window = closes[start:end]
        if len(window) < horizon:
            out.append({"quality": 0.0, "passed": False, "available": False})
            continue
        future_max = max(window)
        future_min = min(window)
        future_return = _safe_div(future_max - close, close)
        downside = _safe_div(close - future_min, close)
        persistence = _safe_div(sum(1 for v in window if v >= close), len(window))

        quality = (
            0.50 * clip(future_return / 0.12, 0.0, 1.0)
            + 0.25 * clip((future_return - downside + 0.05) / 0.15, 0.0, 1.0)
            + 0.25 * clip(persistence, 0.0, 1.0)
        )
        quality = clip(quality, 0.0, 1.0)

        out.append({"quality": quality, "passed": quality >= 0.55, "available": True})

    return out


def run_backtest(
    rows: list[MarketRow],
    scores: list[ScoreRow],
    signals: list[SignalRow],
    params: CoreModeParams,
) -> tuple[list[TradeRecord], list[dict[str, Any]], dict[str, Any]]:
    trades: list[TradeRecord] = []
    equity_curve: list[dict[str, Any]] = []
    backtest_meta: dict[str, Any] = {
        "tail_position_excluded": False,
        "tail_exclusion_reason": None,
        "tail_entry_signal_date": None,
        "tail_entry_date": None,
    }

    equity = 1.0
    pending_entry: Optional[dict[str, Any]] = None
    pending_exit: Optional[dict[str, Any]] = None
    position: Optional[dict[str, Any]] = None

    for idx, row in enumerate(rows):
        score = scores[idx]
        signal = signals[idx]

        if pending_exit is not None and position is not None:
            exit_price = row.open if row.open > 0 else row.close
            ret = _safe_div(exit_price - position["entry_price"], position["entry_price"])
            equity *= (1 + ret)

            trades.append(
                TradeRecord(
                    entry_signal_date=position["entry_signal_date"],
                    entry_date=position["entry_date"],
                    exit_signal_date=pending_exit["signal_date"],
                    exit_date=row.date,
                    entry_price=position["entry_price"],
                    exit_price=exit_price,
                    return_pct=ret,
                    holding_days=max(1, idx - position["entry_index"]),
                    mfe=max(0.0, position["mfe"]),
                    mae=abs(min(0.0, position["mae"])),
                    entry_reason=position["entry_reason"],
                    exit_reason=pending_exit["reason"],
                )
            )
            position = None
            pending_exit = None

        if pending_entry is not None and position is None:
            entry_price = row.open if row.open > 0 else row.close
            position = {
                "entry_signal_date": pending_entry["signal_date"],
                "entry_date": row.date,
                "entry_index": idx,
                "entry_price": entry_price,
                "entry_reason": pending_entry["reason"],
                "peak": entry_price,
                "mfe": 0.0,
                "mae": 0.0,
            }
            pending_entry = None

        if position is not None:
            position["peak"] = max(position["peak"], row.high)
            position["mfe"] = max(position["mfe"], _safe_div(row.high - position["entry_price"], position["entry_price"]))
            position["mae"] = min(position["mae"], _safe_div(row.low - position["entry_price"], position["entry_price"]))

        if position is None:
            can_enter = signal.formal_signal is not None or (
                signal.early_signal is not None and score.trend_score >= params.trend_threshold * 1.05
            )
            if can_enter and idx + 1 < len(rows):
                reason = signal.formal_signal or signal.early_signal or "早期趨勢訊號"
                pending_entry = {"signal_date": row.date, "reason": reason}
        else:
            entry_price = position["entry_price"]
            trailing_line = position["peak"] * (1.0 - params.trailing_stop_pct)
            hard_stop_line = entry_price * (1.0 - params.hard_stop_pct)

            exit_reason: Optional[str] = None
            if row.close <= hard_stop_line:
                exit_reason = "硬停損觸發"
            elif row.close <= trailing_line:
                exit_reason = "移動停損觸發"
            elif not score.pullback_ok:
                exit_reason = "拉回深度超標"
            elif score.trend_score < 0:
                exit_reason = "趨勢分數轉弱"
            elif idx - position["entry_index"] >= max(12, params.momentum_window * 2) and _safe_div(row.close - entry_price, entry_price) < 0:
                exit_reason = "持有逾期且未獲利"

            if exit_reason and idx + 1 < len(rows):
                pending_exit = {"signal_date": row.date, "reason": exit_reason}

        mark_price = row.close if position is not None else None
        if mark_price is not None:
            unrealized = _safe_div(mark_price - position["entry_price"], position["entry_price"])
            equity_curve.append({"date": row.date.isoformat(), "equity": equity * (1 + unrealized)})
        else:
            equity_curve.append({"date": row.date.isoformat(), "equity": equity})

    # 尾端若無 n+1 可交易日，不允許以同日 close 強制平倉混入正式績效。
    if position is not None:
        backtest_meta["tail_position_excluded"] = True
        backtest_meta["tail_exclusion_reason"] = "尾端無 n+1 可交易日，未平倉部位已自績效排除"
        backtest_meta["tail_entry_signal_date"] = position["entry_signal_date"].isoformat()
        backtest_meta["tail_entry_date"] = position["entry_date"].isoformat()

    return trades, equity_curve, backtest_meta


def summarize_backtest(
    trades: list[TradeRecord],
    signals: list[SignalRow],
    future_quality: list[dict[str, Any]],
    equity_curve: list[dict[str, Any]],
    *,
    stability: float = 0.0,
) -> BacktestSummary:
    trade_returns = [t.return_pct for t in trades]
    wins = [r for r in trade_returns if r > 0]
    losses = [r for r in trade_returns if r <= 0]

    candidate_indices = [idx for idx, signal in enumerate(signals) if signal.is_trend_candidate]
    valid_candidates = [idx for idx in candidate_indices if future_quality[idx]["available"]]
    ac_hits = sum(1 for idx in valid_candidates if future_quality[idx]["passed"])
    ac = _safe_div(ac_hits, len(valid_candidates))
    avg_future_quality = _safe_mean([future_quality[idx]["quality"] for idx in valid_candidates])

    win_rate = _safe_div(len(wins), len(trade_returns))
    expectancy = _safe_mean(trade_returns)
    avg_mfe = _safe_mean([t.mfe for t in trades])
    avg_mae = _safe_mean([t.mae for t in trades])
    gain_sum = sum(wins)
    loss_sum = abs(sum(losses))
    profit_factor = gain_sum / loss_sum if loss_sum > 0 else (999.0 if gain_sum > 0 else 0.0)

    cumulative = 1.0
    for r in trade_returns:
        cumulative *= (1 + r)
    cumulative_return = cumulative - 1.0

    peak = 1.0
    max_drawdown = 0.0
    for point in equity_curve:
        val = float(point["equity"])
        if val > peak:
            peak = val
        drawdown = _safe_div(peak - val, peak)
        max_drawdown = max(max_drawdown, drawdown)

    return BacktestSummary(
        ac=round(ac, 4),
        win_rate=round(win_rate, 4),
        expectancy=round(expectancy, 4),
        profit_factor=round(min(profit_factor, 999.0), 4),
        cumulative_return=round(cumulative_return, 4),
        max_drawdown=round(max_drawdown, 4),
        trade_count=len(trades),
        avg_mfe=round(avg_mfe, 4),
        avg_mae=round(avg_mae, 4),
        future_trend_quality=round(avg_future_quality, 4),
        stability=round(stability, 4),
    )


def build_regime_breakdown(
    rows: list[MarketRow],
    signals: list[SignalRow],
    trades: list[TradeRecord],
    future_quality: list[dict[str, Any]],
) -> list[RegimeBucketSummary]:
    if len(rows) < 3:
        return [
            RegimeBucketSummary(
                regime="資料不足",
                sample_count=len(rows),
                candidate_count=0,
                ac=0.0,
                win_rate=0.0,
                future_trend_quality=0.0,
            )
        ]

    closes = [r.close for r in rows]
    vol_proxy = []
    for idx in range(len(closes)):
        window = closes[max(0, idx - 10) : idx + 1]
        if len(window) < 2:
            vol_proxy.append(0.0)
            continue
        returns = []
        for w_idx in range(1, len(window)):
            prev = window[w_idx - 1]
            curr = window[w_idx]
            returns.append(_safe_div(curr - prev, prev))
        vol_proxy.append(pstdev(returns) if len(returns) >= 2 else 0.0)

    regime_of_idx = []
    history_vol: list[float] = []
    for vol in vol_proxy:
        # 以 expanding quantile 分桶，只使用當下以前資料，避免全樣本後見資訊。
        history_vol.append(vol)
        sorted_history = sorted(history_vol)
        low_th = _linear_quantile(sorted_history, 0.33)
        high_th = _linear_quantile(sorted_history, 0.66)
        if vol <= low_th:
            regime_of_idx.append("低波動")
        elif vol <= high_th:
            regime_of_idx.append("中波動")
        else:
            regime_of_idx.append("高波動")

    trade_return_by_exit_date: dict[date, list[float]] = {}
    for trade in trades:
        trade_return_by_exit_date.setdefault(trade.exit_date, []).append(trade.return_pct)

    result: list[RegimeBucketSummary] = []
    for regime in ["低波動", "中波動", "高波動"]:
        indices = [idx for idx, label in enumerate(regime_of_idx) if label == regime]
        candidates = [idx for idx in indices if signals[idx].is_trend_candidate and future_quality[idx]["available"]]
        ac_hits = sum(1 for idx in candidates if future_quality[idx]["passed"])
        regime_trade_returns = []
        for idx in indices:
            day = rows[idx].date
            regime_trade_returns.extend(trade_return_by_exit_date.get(day, []))

        result.append(
            RegimeBucketSummary(
                regime=regime,
                sample_count=len(indices),
                candidate_count=len(candidates),
                ac=round(_safe_div(ac_hits, len(candidates)), 4),
                win_rate=round(_safe_div(sum(1 for r in regime_trade_returns if r > 0), len(regime_trade_returns)), 4),
                future_trend_quality=round(_safe_mean([future_quality[idx]["quality"] for idx in candidates]), 4),
            )
        )

    return result


def build_price_chart_payload(
    rows: list[MarketRow],
    signals: list[SignalRow],
    scores: list[ScoreRow],
    trades: list[TradeRecord],
) -> dict[str, Any]:
    candles = []
    volume = []
    ma20 = []
    ma60 = []
    markers = []

    trade_entry_dates = {t.entry_date: t for t in trades}
    trade_exit_dates = {t.exit_date: t for t in trades}
    previous_action: Optional[str] = None

    for row, signal, score in zip(rows, signals, scores, strict=True):
        day = row.date.isoformat()
        candles.append({"time": day, "open": row.open, "high": row.high, "low": row.low, "close": row.close})
        volume_color = "#ef4444" if row.close >= row.open else "#22c55e"
        volume.append({"time": day, "value": row.volume, "color": volume_color})
        ma20.append({"time": day, "value": row.ma20})
        ma60.append({"time": day, "value": row.ma60})

        if signal.formal_signal or signal.early_signal:
            action = "buy"
        elif signal.trend_conclusion == "偏空":
            action = "sell"
        else:
            action = "hold"

        if action != previous_action:
            if action == "buy":
                markers.append(
                    {
                        "time": day,
                        "position": "belowBar",
                        "shape": "arrowUp",
                        "color": "#ef4444",
                        "text": "訊號：轉為買進",
                        "type": "state_buy",
                    }
                )
            elif action == "sell":
                markers.append(
                    {
                        "time": day,
                        "position": "aboveBar",
                        "shape": "arrowDown",
                        "color": "#22c55e",
                        "text": "訊號：轉為賣出",
                        "type": "state_sell",
                    }
                )
            else:
                markers.append(
                    {
                        "time": day,
                        "position": "aboveBar",
                        "shape": "circle",
                        "color": "#64748b",
                        "text": "訊號：轉為持平",
                        "type": "state_hold",
                    }
                )
            previous_action = action

        if signal.early_signal:
            markers.append(
                {
                    "time": day,
                    "position": "belowBar",
                    "shape": "circle",
                    "color": "#f59e0b",
                    "text": signal.early_signal,
                    "type": "early",
                }
            )
        if signal.formal_signal:
            markers.append(
                {
                    "time": day,
                    "position": "belowBar",
                    "shape": "arrowUp",
                    "color": "#ef4444",
                    "text": signal.formal_signal,
                    "type": "formal",
                }
            )
        if not score.pullback_ok:
            markers.append(
                {
                    "time": day,
                    "position": "aboveBar",
                    "shape": "arrowDown",
                    "color": "#f97316",
                    "text": "拉回過深",
                    "type": "failure",
                }
            )
        if row.date in trade_entry_dates:
            markers.append(
                {
                    "time": day,
                    "position": "belowBar",
                    "shape": "arrowUp",
                    "color": "#0ea5e9",
                    "text": f"成交買進：{trade_entry_dates[row.date].entry_reason}",
                    "type": "entry",
                }
            )
        if row.date in trade_exit_dates:
            markers.append(
                {
                    "time": day,
                    "position": "aboveBar",
                    "shape": "arrowDown",
                    "color": "#22c55e",
                    "text": f"賣出：{trade_exit_dates[row.date].exit_reason}",
                    "type": "exit",
                }
            )

    return {
        "candles": candles,
        "volume": volume,
        "overlays": {
            "MA20": ma20,
            "MA60": ma60,
        },
        "markers": markers,
    }


def build_score_chart_payload(scores: list[ScoreRow]) -> dict[str, Any]:
    return {
        "series": [
            {
                "id": "state_score",
                "name": "狀態分數",
                "data": [{"time": s.date.isoformat(), "value": s.state_score} for s in scores],
            },
            {
                "id": "trend_score",
                "name": "綜合趨勢分數",
                "data": [{"time": s.date.isoformat(), "value": s.trend_score} for s in scores],
            },
        ]
    }


def build_trend_reasoning(score: ScoreRow, signal: SignalRow, params: CoreModeParams) -> dict[str, Any]:
    checks = [
        {
            "key": "state_threshold",
            "label": "狀態分數是否達標",
            "passed": score.state_score >= params.state_threshold,
            "value": round(score.state_score, 4),
            "threshold": params.state_threshold,
        },
        {
            "key": "shape_threshold",
            "label": "型態分數是否達標",
            "passed": score.trend_shape_score >= params.shape_threshold,
            "value": round(score.trend_shape_score, 4),
            "threshold": params.shape_threshold,
        },
        {
            "key": "trend_threshold",
            "label": "綜合趨勢分數是否達標",
            "passed": score.trend_score >= params.trend_threshold,
            "value": round(score.trend_score, 4),
            "threshold": params.trend_threshold,
        },
        {
            "key": "breakout_pass",
            "label": "是否有突破結構",
            "passed": score.breakout_pass,
            "value": score.breakout_pass,
            "threshold": True,
        },
        {
            "key": "pullback_ok",
            "label": "拉回深度是否合理",
            "passed": score.pullback_ok,
            "value": score.pullback_ok,
            "threshold": True,
        },
        {
            "key": "acceptable_shape",
            "label": "是否屬於可接受的趨勢型態",
            "passed": score.acceptable_shape,
            "value": score.acceptable_shape,
            "threshold": True,
        },
    ]

    return {
        "trend_conclusion": signal.trend_conclusion,
        "confidence_level": signal.confidence_level,
        "checks": checks,
        "reason_points": signal.reason_points[:3],
    }


def run_core_mode_pipeline(rows: list[MarketRow], params: CoreModeParams) -> dict[str, Any]:
    features = compute_feature_rows(rows, params)
    scores = compute_score_rows(rows, features, params)
    signals = compute_signal_rows(features, scores, params)
    future_quality = compute_future_trend_quality(rows)
    trades, equity_curve, backtest_meta = run_backtest(rows, scores, signals, params)
    summary = summarize_backtest(trades, signals, future_quality, equity_curve)
    regime = build_regime_breakdown(rows, signals, trades, future_quality)

    return {
        "features": features,
        "scores": scores,
        "signals": signals,
        "future_quality": future_quality,
        "trades": trades,
        "equity_curve": equity_curve,
        "backtest_meta": backtest_meta,
        "summary": summary,
        "regime": regime,
    }


def to_summary_dict(summary: BacktestSummary) -> dict[str, Any]:
    return asdict(summary)


def to_trade_dict(trade: TradeRecord) -> dict[str, Any]:
    return {
        "entry_signal_date": trade.entry_signal_date.isoformat(),
        "entry_date": trade.entry_date.isoformat(),
        "exit_signal_date": trade.exit_signal_date.isoformat(),
        "exit_date": trade.exit_date.isoformat(),
        "entry_price": round(trade.entry_price, 4),
        "exit_price": round(trade.exit_price, 4),
        "return_pct": round(trade.return_pct, 4),
        "holding_days": trade.holding_days,
        "mfe": round(trade.mfe, 4),
        "mae": round(trade.mae, 4),
        "entry_reason": trade.entry_reason,
        "exit_reason": trade.exit_reason,
    }


def to_regime_dict(item: RegimeBucketSummary) -> dict[str, Any]:
    return asdict(item)


def to_walk_forward_fold_dict(item: WalkForwardFoldSummary) -> dict[str, Any]:
    return {
        "fold_id": item.fold_id,
        "overlap_ratio": round(item.overlap_ratio, 4),
        "train_start": item.train_start.isoformat(),
        "train_end": item.train_end.isoformat(),
        "validation_start": item.validation_start.isoformat(),
        "validation_end": item.validation_end.isoformat(),
        "test_start": item.test_start.isoformat(),
        "test_end": item.test_end.isoformat(),
        "validation_metrics": to_summary_dict(item.validation_metrics),
        "test_metrics": to_summary_dict(item.test_metrics),
    }
