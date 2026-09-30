import asyncio
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.core.errors import AppError
from app.features.analysis.prediction import PredictionOutput, call_llm_for_prediction, StrategyConfig
from app.features.analysis.service import AnalysisService
from app.jobs.indicators import _calc_rsi


def test_rsi_flat_rising_and_falling_sequences():
    assert _calc_rsi([100.0] * 8, 5)[5:] == [50.0] * 3
    assert _calc_rsi(list(range(100, 108)), 5)[5:] == [100.0] * 3
    assert _calc_rsi(list(range(108, 100, -1)), 5)[5:] == [0.0] * 3


def test_prediction_rejects_direction_mismatch_and_accepts_neutral():
    with pytest.raises(ValidationError):
        PredictionOutput(direction="up", change_pct_total=-10, confidence=3, summary="x")
    assert PredictionOutput(direction="neutral", change_pct_total=0, confidence=1, summary="x").direction == "neutral"


def test_prediction_failure_does_not_invent_direction():
    class Llm:
        async def generate(self, **kwargs):
            raise AppError("unavailable", status_code=503)
    with pytest.raises(AppError):
        asyncio.run(call_llm_for_prediction(Llm(), "prompt"))


@pytest.mark.parametrize("pct, expected", [(10, "up"), (0, "neutral"), (-10, "down"), (None, None)])
def test_weekly_predictions_are_cumulative_and_failure_is_error(monkeypatch, settings, pct, expected):
    class Llm:
        async def generate(self, **kwargs):
            assert "累積" in kwargs["system_prompt"]
            if pct is None:
                raise AppError("unavailable", status_code=503)
            return SimpleNamespace(payload={"pct": pct, "reason": "fixture"})

    async def context(self, stock_id):
        return "2330", None, [{"date": "2026-09-01", "close": 100.0}], [], StrategyConfig(name="test")

    monkeypatch.setattr(AnalysisService, "_trend_context", context)
    service = AnalysisService(db=None, settings=settings, http=None, llm=Llm(), rag=object())

    async def collect():
        return [event async for event in service.stream_trend_prediction("2330")]

    events = asyncio.run(collect())
    if pct is None:
        assert [e["type"] for e in events] == ["init", "error"]
    else:
        assert events[-1]["direction"] == expected
        assert events[-1]["target_price"] == 100 + pct
        assert {e["price"] for e in events if e["type"] == "node"} == {100 + pct}
