import math

import pytest

from prediction_core import (
    StrategyConfig,
    build_prediction_prompt,
    call_llm_for_prediction,
    compute_momentum_meanreversion_curve,
    compute_weighted_regression,
    normalize_time,
)


class TestNormalizeTime:
    def test_iso_with_timezone(self):
        assert normalize_time("2024-05-01T12:00:00+08:00") == "2024-05-01 12:00:00"

    def test_iso_without_timezone(self):
        assert normalize_time("2024-05-01T12:00:00") == "2024-05-01 12:00:00"

    def test_empty_string(self):
        assert normalize_time("") == ""

    def test_none(self):
        assert normalize_time(None) == ""

    def test_already_space_separated(self):
        assert normalize_time("2024-05-01 12:00:00") == "2024-05-01 12:00:00"


class TestWeightedRegression:
    def test_flat_series_has_zero_slope(self):
        closes = [100.0] * 10
        history, slope, intercept = compute_weighted_regression(closes)
        assert slope == pytest.approx(0, abs=1e-9)
        assert all(v == pytest.approx(100.0) for v in history)

    def test_strictly_increasing_series_has_positive_slope(self):
        closes = [float(i) for i in range(20)]
        _, slope, _ = compute_weighted_regression(closes)
        assert slope > 0

    def test_strictly_decreasing_series_has_negative_slope(self):
        closes = [float(20 - i) for i in range(20)]
        _, slope, _ = compute_weighted_regression(closes)
        assert slope < 0

    def test_history_length_matches_input(self):
        closes = [1.0, 2.0, 3.0, 5.0, 4.0]
        history, _, _ = compute_weighted_regression(closes)
        assert len(history) == len(closes)


class TestMomentumMeanReversionCurve:
    def test_curve_length_matches_horizon(self):
        closes = [100.0 + i for i in range(30)]
        curve = compute_momentum_meanreversion_curve(closes, horizon_days=20)
        assert len(curve) == 20

    def test_default_horizon_is_20(self):
        closes = [100.0 + i for i in range(30)]
        curve = compute_momentum_meanreversion_curve(closes)
        assert len(curve) == 20

    def test_flat_series_stays_flat(self):
        closes = [100.0] * 25
        curve = compute_momentum_meanreversion_curve(closes)
        assert all(v == pytest.approx(100.0) for v in curve)

    def test_short_history_does_not_crash(self):
        closes = [100.0, 101.0, 99.0]
        curve = compute_momentum_meanreversion_curve(closes, horizon_days=5)
        assert len(curve) == 5


class TestBuildPredictionPrompt:
    def test_includes_stock_and_news(self):
        strategy = StrategyConfig(name="baseline_v1")
        prompt = build_prediction_prompt(
            "2330", "台積電", "近期上漲趨勢", ["新聞標題一", "新聞標題二"], strategy
        )
        assert "2330" in prompt
        assert "台積電" in prompt
        assert "新聞標題一" in prompt
        assert "新聞標題二" in prompt

    def test_no_news_uses_placeholder(self):
        strategy = StrategyConfig(name="baseline_v1")
        prompt = build_prediction_prompt("2330", "台積電", "近期上漲趨勢", [], strategy)
        assert "無近期新聞" in prompt


class TestCallLlmForPrediction:
    async def test_parses_valid_json_response(self):
        class FakeMessage:
            content = '{"direction": "up", "change_pct_total": 3.5, "confidence": 4, "summary": "測試理由"}'

        class FakeChoice:
            message = FakeMessage()

        class FakeResponse:
            choices = [FakeChoice()]

        class FakeCompletions:
            def create(self, **kwargs):
                return FakeResponse()

        class FakeChat:
            completions = FakeCompletions()

        class FakeClient:
            chat = FakeChat()

        result = await call_llm_for_prediction(FakeClient(), "prompt", "some-model")
        assert result["direction"] == "up"
        assert result["change_pct_total"] == 3.5
        assert result["confidence"] == 4
        assert result["summary"] == "測試理由"

    async def test_falls_back_on_exception(self):
        class FakeCompletions:
            def create(self, **kwargs):
                raise RuntimeError("API 掛了")

        class FakeChat:
            completions = FakeCompletions()

        class FakeClient:
            chat = FakeChat()

        result = await call_llm_for_prediction(FakeClient(), "prompt", "some-model")
        assert result["direction"] == "up"
        assert "AI 預測失敗" in result["summary"]

    async def test_falls_back_on_malformed_json(self):
        class FakeMessage:
            content = "這不是 JSON"

        class FakeChoice:
            message = FakeMessage()

        class FakeResponse:
            choices = [FakeChoice()]

        class FakeCompletions:
            def create(self, **kwargs):
                return FakeResponse()

        class FakeChat:
            completions = FakeCompletions()

        class FakeClient:
            chat = FakeChat()

        result = await call_llm_for_prediction(FakeClient(), "prompt", "some-model")
        assert result["direction"] == "up"
        assert result["confidence"] == 1
