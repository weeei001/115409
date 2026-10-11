"""Usage-only instrumentation; never persists prompts or model response text."""
from __future__ import annotations

import asyncio
from contextlib import aclosing
from datetime import datetime, timezone
import logging
from threading import BoundedSemaphore
from uuid import uuid4

from app.db.models.ai_usage import AiUsageLog


_LOG = logging.getLogger(__name__)
_SAVE_SLOTS = BoundedSemaphore(16)
_SAVE_TIMEOUT_SECONDS = 2
_WRITERS: set[asyncio.Task] = set()


def _count(value):
    return value if type(value) is int and 0 <= value <= 9223372036854775807 else None


def _write(session_factory, values):
    try:
        with session_factory() as db, db.begin():
            db.add(AiUsageLog(**values))
    except Exception as exc:
        # Database exceptions can contain parameters; do not log their text.
        _LOG.warning("AI usage unavailable: %s", type(exc).__name__)
    finally:
        _SAVE_SLOTS.release()


async def _persist(session_factory, values):
    if session_factory is None:
        return
    if not _SAVE_SLOTS.acquire(blocking=False):
        _LOG.warning("AI usage unavailable: writer_busy")
        return
    task = asyncio.create_task(asyncio.to_thread(_write, session_factory, values))
    _WRITERS.add(task)
    task.add_done_callback(_WRITERS.discard)
    try:
        await asyncio.wait_for(asyncio.shield(task), _SAVE_TIMEOUT_SECONDS)
    except TimeoutError:
        # The bounded independent writer can finish after the response deadline.
        _LOG.warning("AI usage unavailable: write_timeout")


class _TrackedClient:
    def __init__(self, client, session_factory, feature, request_id):
        self._client = client
        self._session_factory = session_factory
        self._feature = feature
        self._request_id = request_id

    def __getattr__(self, name):
        return getattr(self._client, name)

    def _record(self):
        return dict(id=str(uuid4()), feature=self._feature, request_id=self._request_id,
                    model=str(getattr(self._client, "model_name", "unknown"))[:255],
                    input_tokens=None, output_tokens=None, status="failed",
                    created_at=datetime.now(timezone.utc).replace(tzinfo=None))

    @staticmethod
    def _metadata(values, metadata):
        if not isinstance(metadata, dict):
            return
        for source, target in (("prompt_tokens", "input_tokens"),
                               ("completion_tokens", "output_tokens")):
            count = _count(metadata.get(source))
            if count is not None:
                # Streaming usage is cumulative. Never add repeated snapshots.
                values[target] = count
        if metadata.get("model_name"):
            values["model"] = str(metadata["model_name"])[:255]

    async def _invoke(self, method, kwargs):
        values = self._record()
        try:
            result = await getattr(self._client, method)(**kwargs)
            self._metadata(values, getattr(result, "metadata", None))
            values["status"] = "completed"
            return result
        except asyncio.CancelledError:
            values["status"] = "cancelled"
            raise
        finally:
            await _persist(self._session_factory, values)

    async def generate(self, **kwargs):
        return await self._invoke("generate", kwargs)

    async def text(self, **kwargs):
        return await self._invoke("text", kwargs)

    async def stream_text(self, **kwargs):
        values = self._record()
        try:
            # Invoke the original client so its text fallback is counted once.
            async with aclosing(self._client.stream_text(**kwargs)) as stream:
                async for chunk in stream:
                    self._metadata(values, getattr(chunk, "metadata", None))
                    yield chunk
            values["status"] = "completed"
        except (asyncio.CancelledError, GeneratorExit):
            values["status"] = "cancelled"
            raise
        finally:
            await _persist(self._session_factory, values)


def tracked_client(client, session_factory, feature, request_id):
    """Group calls under a request; SDK-internal retries are not separate calls.

    Persistence is best effort, independently committed, and contains no content.
    Missing provider usage remains NULL, including failed or interrupted calls.
    """
    if isinstance(client, _TrackedClient):
        client = client._client
    return _TrackedClient(client, session_factory, feature, request_id)
