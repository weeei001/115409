from __future__ import annotations

from datetime import date, timedelta
from types import SimpleNamespace

from trend_core.core_mode_auto_search import run_auto_parameter_search
from trend_core.core_mode_splits import split_train_validation_final_holdout
from trend_core.core_mode_types import (
    BacktestSummary,
    MarketRow,
    normalize_auto_search_settings,
    normalize_core_mode_params,
    normalize_time_series_ml_settings,
)
from trend_core.core_mode_validation import ValidationConfig


def _make_market_rows(count: int) -> list[MarketRow]:
    start = date(2024, 1, 1)
    rows: list[MarketRow] = []
    for idx in range(count):
        close = 100.0 + (idx * 0.3)
        rows.append(
            MarketRow(
                date=start + timedelta(days=idx),
                open=close - 0.2,
                high=close + 0.8,
                low=close - 0.9,
                close=close,
                volume=1_000_000 + (idx * 1000),
                ma5=close - 0.4,
                ma20=close - 1.0,
                ma60=close - 1.8,
                rsi14=50.0,
                k_value=55.0,
                d_value=52.0,
                macd=0.4,
                macd_signal=0.3,
                macd_hist=0.1,
                total_net=1000.0,
                news_score=0.0,
            )
        )
    return rows


def _fake_pipeline(rows: list[MarketRow], params) -> dict[str, BacktestSummary]:  # type: ignore[no-untyped-def]
    lookback = float(getattr(params, "breakout_lookback", 30))
    if len(rows) == 30:
        ac = min(0.95, 0.4 + (lookback / 200.0))
    elif len(rows) == 20:
        # 60/20/20 下 validation 與 holdout 都是 20 筆；用區段位置區分：
        # validation（較早區段）偏好較大的 lookback，holdout（最後區段）偏好較小的 lookback。
        first_close = float(rows[0].close) if rows else 0.0
        if first_close < 122.0:
            ac = min(0.95, 0.4 + (lookback / 200.0))
        else:
            ac = max(0.05, 0.95 - (lookback / 200.0))
    else:
        ac = 0.6
    summary = BacktestSummary(
        ac=round(ac, 6),
        win_rate=0.55,
        expectancy=0.02,
        profit_factor=1.4,
        cumulative_return=round(ac - 0.35, 6),
        max_drawdown=0.12,
        trade_count=24,
        avg_mfe=0.03,
        avg_mae=0.02,
        future_trend_quality=0.6,
        stability=0.65,
    )
    return {"summary": summary}


def _fake_eval_result(*_, **__):  # type: ignore[no-untyped-def]
    return SimpleNamespace(aggregate_summary=SimpleNamespace(stability=0.62))


def _base_settings(**overrides: object):
    payload = {
        "enabled": True,
        "mode": "single_stock_search",
        "symbols": ["2330"],
        "top_n": 2,
        "candidate_pool_size": 60,
        "ml_prefilter_top_n": 10,
        "final_verify_top_n": 2,
        "use_ml_prefilter": False,
        "final_holdout_settings": {
            "enabled": True,
            "mode": "ratio",
            "train_ratio": 0.6,
            "validation_ratio": 0.2,
            "final_holdout_ratio": 0.2,
            "min_final_holdout_days": 20,
        },
    }
    payload.update(overrides)
    return normalize_auto_search_settings(payload)


def test_split_train_validation_final_holdout_ratio() -> None:
    rows = _make_market_rows(100)
    settings = _base_settings().final_holdout_settings
    split = split_train_validation_final_holdout(rows=rows, final_holdout_settings=settings)
    assert len(split["search_rows"]) == 60
    assert len(split["validation_rows"]) == 20
    assert len(split["final_holdout_rows"]) == 20
    assert split["train_range"]["start_index"] == 0
    assert split["train_range"]["end_index"] == 59
    assert split["validation_range"]["start_index"] == 60
    assert split["validation_range"]["end_index"] == 79
    assert split["final_holdout_range"]["start_index"] == 80
    assert split["final_holdout_range"]["end_index"] == 99


def test_auto_search_ml_prefilter_uses_train_plus_validation_only(monkeypatch) -> None:
    captured: dict[str, int] = {}

    def _fake_rank_candidates_with_ml(*, rows, candidate_params, ml_settings):  # type: ignore[no-untyped-def]
        captured["row_count"] = len(rows)
        return SimpleNamespace(warnings=[], ranked_candidates=[])

    base_params = normalize_core_mode_params({})
    monkeypatch.setattr(
        "trend_core.core_mode_auto_search.generate_candidate_pool",
        lambda **_: [{"params": base_params, "source_tags": {"test"}}],
    )
    monkeypatch.setattr("trend_core.core_mode_auto_search.rank_candidates_with_ml", _fake_rank_candidates_with_ml)
    monkeypatch.setattr("trend_core.core_mode_auto_search.run_core_mode_pipeline", _fake_pipeline)
    monkeypatch.setattr("trend_core.core_mode_auto_search.evaluate_params_with_walk_forward", _fake_eval_result)

    settings = _base_settings(use_ml_prefilter=True)
    rows = _make_market_rows(100)
    result = run_auto_parameter_search(
        settings=settings,
        rows_by_symbol={"2330": rows},
        active_params=base_params,
        base_params=base_params,
        ml_settings=normalize_time_series_ml_settings({"enabled": True, "enable_candidate_ranking": True}),
        validation_config=ValidationConfig(),
    )
    assert result["enabled"] is True
    assert captured["row_count"] == 80


def test_final_holdout_does_not_change_rank_order(monkeypatch) -> None:
    base = normalize_core_mode_params({})
    better_validation = normalize_core_mode_params({**base.__dict__, "breakout_lookback": 40})
    worse_validation = normalize_core_mode_params({**base.__dict__, "breakout_lookback": 20})
    monkeypatch.setattr(
        "trend_core.core_mode_auto_search.generate_candidate_pool",
        lambda **_: [
            {"params": better_validation, "source_tags": {"test"}},
            {"params": worse_validation, "source_tags": {"test"}},
        ],
    )
    monkeypatch.setattr("trend_core.core_mode_auto_search.run_core_mode_pipeline", _fake_pipeline)
    monkeypatch.setattr("trend_core.core_mode_auto_search.evaluate_params_with_walk_forward", _fake_eval_result)

    result = run_auto_parameter_search(
        settings=_base_settings(),
        rows_by_symbol={"2330": _make_market_rows(100)},
        active_params=base,
        base_params=base,
        ml_settings=normalize_time_series_ml_settings({"enabled": False}),
        validation_config=ValidationConfig(),
    )
    rows = result["results"]
    assert rows[0]["params"]["breakout_lookback"] == 40
    assert rows[0]["validation_score"] >= rows[1]["validation_score"]
    assert rows[0]["final_holdout_score"] <= rows[1]["final_holdout_score"]


def test_phase9_response_contains_split_and_final_holdout_fields(monkeypatch) -> None:
    base_params = normalize_core_mode_params({})
    monkeypatch.setattr(
        "trend_core.core_mode_auto_search.generate_candidate_pool",
        lambda **_: [{"params": base_params, "source_tags": {"test"}}],
    )
    monkeypatch.setattr("trend_core.core_mode_auto_search.run_core_mode_pipeline", _fake_pipeline)
    monkeypatch.setattr("trend_core.core_mode_auto_search.evaluate_params_with_walk_forward", _fake_eval_result)

    result = run_auto_parameter_search(
        settings=_base_settings(),
        rows_by_symbol={"2330": _make_market_rows(100)},
        active_params=base_params,
        base_params=base_params,
        ml_settings=normalize_time_series_ml_settings({"enabled": False}),
        validation_config=ValidationConfig(),
    )

    assert "split_summary" in result
    assert result["split_summary"]["train_count"] == 60
    assert result["split_summary"]["validation_count"] == 20
    assert result["split_summary"]["final_holdout_count"] == 20
    row = result["results"][0]
    assert "validation_score" in row
    assert "final_holdout_score" in row
    assert "final_holdout_summary" in row
    assert "final_holdout_symbol_results" in row


def test_final_holdout_disabled_keeps_null_score_and_warning(monkeypatch) -> None:
    base_params = normalize_core_mode_params({})
    monkeypatch.setattr(
        "trend_core.core_mode_auto_search.generate_candidate_pool",
        lambda **_: [{"params": base_params, "source_tags": {"test"}}],
    )
    monkeypatch.setattr("trend_core.core_mode_auto_search.run_core_mode_pipeline", _fake_pipeline)
    monkeypatch.setattr("trend_core.core_mode_auto_search.evaluate_params_with_walk_forward", _fake_eval_result)

    settings = _base_settings(final_holdout_settings={"enabled": False})
    result = run_auto_parameter_search(
        settings=settings,
        rows_by_symbol={"2330": _make_market_rows(100)},
        active_params=base_params,
        base_params=base_params,
        ml_settings=normalize_time_series_ml_settings({"enabled": False}),
        validation_config=ValidationConfig(),
    )
    row = result["results"][0]
    assert row["final_holdout_score"] is None
    assert any("final holdout 已停用" in item for item in result["warnings"])
