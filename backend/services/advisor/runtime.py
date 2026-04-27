from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from threading import RLock
from typing import Any, AsyncIterator


@dataclass
class RequestStreamState:
    request_id: str
    created_at: float
    pending_tasks: int
    events: list[dict[str, Any]] = field(default_factory=list)
    failed: bool = False
    closed: bool = False


@dataclass
class CacheEntry:
    payload: dict[str, Any]
    expires_at: float


class AdvisorRuntimeStore:
    def __init__(self, *, backtest_cache_ttl_seconds: int = 1800) -> None:
        self._lock = RLock()
        self._requests: dict[str, RequestStreamState] = {}
        self._report_jobs: dict[str, dict[str, Any]] = {}
        self._report_tasks: dict[str, asyncio.Task[bool]] = {}
        self._backtest_cache: dict[str, CacheEntry] = {}
        self._backtest_inflight: dict[str, asyncio.Task[bool]] = {}
        self._backtest_cache_ttl_seconds = max(1, int(backtest_cache_ttl_seconds))

    def create_request(self, request_id: str, *, pending_tasks: int) -> None:
        now = time.time()
        with self._lock:
            self._requests[request_id] = RequestStreamState(
                request_id=request_id,
                created_at=now,
                pending_tasks=max(0, pending_tasks),
            )

    def has_request(self, request_id: str) -> bool:
        with self._lock:
            return request_id in self._requests

    def append_request_event(self, request_id: str, *, event: str, data: dict[str, Any]) -> None:
        payload = {
            "event": event,
            "data": data,
            "ts": time.time(),
        }
        with self._lock:
            state = self._requests.get(request_id)
            if state is None:
                return
            state.events.append(payload)

    def mark_request_task_done(self, request_id: str, *, failed: bool = False) -> None:
        with self._lock:
            state = self._requests.get(request_id)
            if state is None or state.closed:
                return
            if failed:
                state.failed = True
            state.pending_tasks = max(0, state.pending_tasks - 1)
            if state.pending_tasks == 0:
                state.closed = True
                state.events.append(
                    {
                        "event": "completed",
                        "data": {"request_id": request_id, "ok": not state.failed},
                        "ts": time.time(),
                    }
                )

    def close_request(self, request_id: str, *, ok: bool) -> None:
        with self._lock:
            state = self._requests.get(request_id)
            if state is None or state.closed:
                return
            state.failed = not ok
            state.pending_tasks = 0
            state.closed = True
            state.events.append(
                {
                    "event": "completed",
                    "data": {"request_id": request_id, "ok": ok},
                    "ts": time.time(),
                }
            )

    def _events_since(self, request_id: str, cursor: int) -> tuple[list[dict[str, Any]], bool]:
        with self._lock:
            state = self._requests.get(request_id)
            if state is None:
                raise KeyError(request_id)
            items = state.events[cursor:]
            return items, state.closed

    async def stream_request_events(
        self,
        request_id: str,
        *,
        poll_interval: float = 0.2,
        keepalive_seconds: float = 15.0,
    ) -> AsyncIterator[dict[str, Any]]:
        cursor = 0
        last_emit = time.monotonic()
        while True:
            batch, closed = self._events_since(request_id, cursor)
            if batch:
                for item in batch:
                    cursor += 1
                    last_emit = time.monotonic()
                    yield item
                continue
            if closed:
                break
            if time.monotonic() - last_emit >= keepalive_seconds:
                last_emit = time.monotonic()
                yield {"event": "keepalive", "data": {"request_id": request_id}, "ts": time.time()}
            await asyncio.sleep(poll_interval)

    def create_report_job(self, job: dict[str, Any]) -> None:
        with self._lock:
            self._report_jobs[job["job_id"]] = job

    def update_report_job(self, job_id: str, **updates: Any) -> dict[str, Any] | None:
        with self._lock:
            job = self._report_jobs.get(job_id)
            if job is None:
                return None
            job.update(updates)
            job["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            return dict(job)

    def get_report_job(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            job = self._report_jobs.get(job_id)
            return dict(job) if job else None

    def attach_report_task(self, job_id: str, task: asyncio.Task[bool]) -> None:
        with self._lock:
            self._report_tasks[job_id] = task

    def get_report_task(self, job_id: str) -> asyncio.Task[bool] | None:
        with self._lock:
            return self._report_tasks.get(job_id)

    def clear_report_task(self, job_id: str) -> None:
        with self._lock:
            self._report_tasks.pop(job_id, None)

    def get_backtest_cache(self, cache_key: str) -> dict[str, Any] | None:
        now = time.time()
        with self._lock:
            entry = self._backtest_cache.get(cache_key)
            if entry is None:
                return None
            if now >= entry.expires_at:
                self._backtest_cache.pop(cache_key, None)
                return None
            return dict(entry.payload)

    def set_backtest_cache(self, cache_key: str, payload: dict[str, Any]) -> None:
        with self._lock:
            self._backtest_cache[cache_key] = CacheEntry(
                payload=dict(payload),
                expires_at=time.time() + self._backtest_cache_ttl_seconds,
            )

    def get_backtest_inflight(self, cache_key: str) -> asyncio.Task[bool] | None:
        with self._lock:
            task = self._backtest_inflight.get(cache_key)
            if task and task.done():
                self._backtest_inflight.pop(cache_key, None)
                return None
            return task

    def set_backtest_inflight(self, cache_key: str, task: asyncio.Task[bool]) -> None:
        with self._lock:
            self._backtest_inflight[cache_key] = task

    def clear_backtest_inflight(self, cache_key: str) -> None:
        with self._lock:
            self._backtest_inflight.pop(cache_key, None)
