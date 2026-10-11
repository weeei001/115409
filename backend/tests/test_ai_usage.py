import asyncio
from contextlib import aclosing
from types import SimpleNamespace

import pytest
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app.clients.usage import tracked_client
from app.db.models.ai_usage import AiUsageLog


class Client:
    model_name = "configured-model"
    settings = SimpleNamespace(LLM_STREAMING=True)

    def require_enabled(self):
        return None

    async def generate(self, **kwargs):
        return SimpleNamespace(metadata={"prompt_tokens": 20, "completion_tokens": 5,
                                         "model_name": "reported-model"})

    async def text(self, **kwargs):
        return SimpleNamespace(metadata={"prompt_tokens": 0})

    async def stream_text(self, **kwargs):
        yield SimpleNamespace(metadata={"prompt_tokens": 20, "completion_tokens": 2})
        yield SimpleNamespace(metadata={"prompt_tokens": 20, "completion_tokens": 5})


def rows(db):
    return list(db.scalars(select(AiUsageLog).order_by(AiUsageLog.created_at)))


def test_usage_calls_are_independent_and_unknown_is_not_zero(db_session):
    factory = sessionmaker(db_session.get_bind())

    async def run():
        client = tracked_client(Client(), factory, "chat", "request-1")
        assert client.settings.LLM_STREAMING
        assert client.model_name == "configured-model"
        client.require_enabled()
        await client.generate()
        await client.generate()  # Application retry gets its own row.
        await client.text()
    asyncio.run(run())
    records = rows(db_session)
    assert len(records) == 3
    assert len({record.id for record in records}) == 3
    assert {record.request_id for record in records} == {"request-1"}
    assert [(r.input_tokens, r.output_tokens) for r in records] == [(20, 5), (20, 5), (0, None)]
    assert records[0].model == "reported-model"
    assert {record.status for record in records} == {"completed"}


def test_stream_usage_uses_final_snapshot_and_closes_on_interruption(db_session):
    factory = sessionmaker(db_session.get_bind())

    async def run():
        client = tracked_client(Client(), factory, "chat", "request-2")
        async for _ in client.stream_text():
            pass
        async with aclosing(client.stream_text()) as stream:
            await anext(stream)
    asyncio.run(run())
    records = rows(db_session)
    assert [(r.input_tokens, r.output_tokens, r.status) for r in records] == [
        (20, 5, "completed"), (20, 2, "cancelled")]


def test_fallback_and_nested_wrappers_do_not_double_count(db_session):
    class Fallback(Client):
        async def stream_text(self, **kwargs):
            yield await self.text(**kwargs)
    factory = sessionmaker(db_session.get_bind())

    async def run():
        client = tracked_client(Fallback(), factory, "analysis", "request-3")
        client = tracked_client(client, factory, "chat", "request-4")
        async for _ in client.stream_text():
            pass
    asyncio.run(run())
    record, = rows(db_session)
    assert (record.feature, record.request_id, record.input_tokens) == ("chat", "request-4", 0)


@pytest.mark.parametrize("error,status", [(ValueError, "failed"), (asyncio.CancelledError, "cancelled")])
def test_failed_and_cancelled_calls_are_recorded_without_masking_error(db_session, error, status):
    class Failing(Client):
        async def generate(self, **kwargs):
            raise error()
    factory = sessionmaker(db_session.get_bind())

    async def run():
        with pytest.raises(error):
            await tracked_client(Failing(), factory, "news_impact", "request-5").generate()
    asyncio.run(run())
    record, = rows(db_session)
    assert (record.input_tokens, record.output_tokens, record.status) == (None, None, status)


def test_usage_storage_failure_does_not_break_model_response(caplog):
    def unavailable():
        raise RuntimeError("must not leak database details")

    async def run():
        return await tracked_client(Client(), unavailable, "chat", "request-6").generate()
    result = asyncio.run(run())
    assert result.metadata["prompt_tokens"] == 20
    assert "RuntimeError" in caplog.text
    assert "must not leak" not in caplog.text


def test_stream_failure_retains_usage_and_closes_underlying_stream(db_session):
    closed = []

    class FailingStream(Client):
        async def stream_text(self, **kwargs):
            try:
                yield SimpleNamespace(metadata={"prompt_tokens": 10, "completion_tokens": 3})
                raise ValueError("provider failed")
            finally:
                closed.append(True)
    factory = sessionmaker(db_session.get_bind())

    async def run():
        with pytest.raises(ValueError, match="provider failed"):
            async for _ in tracked_client(FailingStream(), factory, "chat", "request-7").stream_text():
                pass
    asyncio.run(run())
    record, = rows(db_session)
    assert (record.input_tokens, record.output_tokens, record.status) == (10, 3, "failed")
    assert closed == [True]


def test_actual_task_cancellation_persists_once(db_session):
    factory = sessionmaker(db_session.get_bind())

    async def run():
        started = asyncio.Event()

        class Waiting(Client):
            async def text(self, **kwargs):
                started.set()
                await asyncio.Event().wait()

        task = asyncio.create_task(tracked_client(Waiting(), factory, "chat", "request-8").text())
        await started.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    asyncio.run(run())
    record, = rows(db_session)
    assert record.status == "cancelled"


def test_invalid_counts_remain_unknown(db_session):
    class Invalid(Client):
        async def text(self, **kwargs):
            return SimpleNamespace(metadata={"prompt_tokens": -1, "completion_tokens": True})
    factory = sessionmaker(db_session.get_bind())
    asyncio.run(tracked_client(Invalid(), factory, "analysis", "request-9").text())
    record, = rows(db_session)
    assert (record.input_tokens, record.output_tokens) == (None, None)
