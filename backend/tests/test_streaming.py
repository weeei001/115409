import asyncio
from types import SimpleNamespace

import pytest

from app.core.streaming import encode_sse
from app.features.analysis.router import _bounded_prediction_events


@pytest.mark.parametrize("stop", ["complete", "close", "provider_error", "encoding_error"])
def test_sse_preserves_frames_and_closes_source(stop):
    closed = []

    async def events():
        try:
            yield {"message": "台積電\n最新消息"}
            if stop == "provider_error":
                raise RuntimeError("Provider failed")
            yield {"value": object() if stop == "encoding_error" else 1}
        finally:
            closed.append(True)

    async def run():
        source = events()
        stream = encode_sse(source)
        assert await anext(stream) == 'data: {"message": "台積電\\n最新消息"}\n\n'
        if stop == "close":
            await stream.aclose()
        elif stop in {"provider_error", "encoding_error"}:
            with pytest.raises(RuntimeError if stop == "provider_error" else TypeError):
                await anext(stream)
        else:
            assert [frame async for frame in stream] == ['data: {"value": 1}\n\n']
        # Check before event-loop shutdown can clean up an unclosed source.
        assert closed == [True]

    asyncio.run(run())


@pytest.mark.parametrize("strict", [False, True])
def test_sse_preserves_endpoint_nonfinite_number_policy(strict):
    closed = []

    async def events():
        try:
            yield {"value": float("nan")}
        finally:
            closed.append(True)

    async def run():
        source = events()
        stream = encode_sse(source, allow_nan=False) if strict else encode_sse(source)
        if strict:
            with pytest.raises(ValueError):
                await anext(stream)
        else:
            assert [frame async for frame in stream] == ['data: {"value": NaN}\n\n']
        assert closed == [True]

    asyncio.run(run())


@pytest.mark.parametrize("stop", ["close", "timeout"])
def test_prediction_stream_closes_nested_source(stop):
    closed = []

    async def events():
        try:
            yield {"type": "init"}
            await asyncio.Event().wait()
        finally:
            closed.append(True)

    async def run():
        source = events()
        service = SimpleNamespace(stream_trend_prediction=lambda stock_id: source)
        stream = encode_sse(_bounded_prediction_events(service, "2330", 0.01))
        assert await anext(stream) == 'data: {"type": "init"}\n\n'
        if stop == "close":
            await stream.aclose()
        else:
            assert [frame async for frame in stream] == [
                'data: {"type": "error", "message": "預測逾時，請稍後重試"}\n\n',
            ]
        assert closed == [True]

    asyncio.run(run())
