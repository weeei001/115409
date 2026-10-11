import asyncio
from contextlib import asynccontextmanager
from decimal import Decimal
from threading import Barrier, Lock, get_ident
from types import SimpleNamespace

import pytest

from app.jobs.impact import parallel


@pytest.fixture
def harness(monkeypatch, tmp_path):
    articles = {str(i): SimpleNamespace(article_id=str(i), source="cnyes", content="latest") for i in range(12)}
    sessions, processed, lock = [], [], Lock()
    class Session:
        def __init__(self):
            self.owner = get_ident()
            self.closed = False
            sessions.append(self)
        def __enter__(self):
            return self
        def __exit__(self, *args):
            self.closed = True
        def expire_all(self):
            assert self.owner == get_ident()
        def get(self, model, key):
            assert self.owner == get_ident()
            return articles[key]
        def rollback(self):
            pass
    class Runner:
        behavior = None
        def __init__(self, db_session, **kwargs):
            assert kwargs["max_cost_usd"] is None
            self.db = db_session
            self.counts = dict(pending=0, success=0, failed=0, skipped=0, reused=0, api_calls=0)
            self.known_cost = self.spent = Decimal(0)
            self.config_hash = "config"
            self.run_id = "run"
            self.failure_reasons = {}
            self.stopped_reason = None
        def pending(self, since):
            self.counts["pending"] = len(articles)
            return [(a, "old") for a in articles.values()]
        async def _process(self, article, digest):
            assert sessions[0].closed
            assert digest == "latest"
            with lock:
                processed.append((article.article_id, id(self.db), get_ident(), id(asyncio.get_running_loop())))
            if type(self).behavior:
                await type(self).behavior(self, article)
            else:
                await asyncio.sleep(.005)
                self.counts["success"] += 1
            self.counts["api_calls"] += 1
            self.known_cost += Decimal("0.01")
            self.spent += Decimal("0.02")
    @asynccontextmanager
    async def http(settings):
        yield object()
    monkeypatch.setattr(parallel, "ImpactBatchRunner", Runner)
    monkeypatch.setattr(parallel, "make_http_client", http)
    monkeypatch.setattr(parallel, "source_states", lambda db, rows: {a.article_id: {"eligible": True} for a in rows})
    monkeypatch.setattr(parallel, "article_hash", lambda article: article.content)
    monkeypatch.setattr(parallel, "contains_simulation", lambda values: False)
    def run(**kwargs):
        return parallel.run_parallel_impact(session_factory=Session, settings=SimpleNamespace(LLM_MODEL="mock"),
            catalog={}, work_dir=tmp_path, since=None, **kwargs)
    return SimpleNamespace(run=run, runner=Runner, articles=articles, processed=processed, sessions=sessions)


def test_unique_parallel_workers_isolate_sessions_and_loops(harness):
    barrier = Barrier(4)
    async def behavior(runner, article):
        barrier.wait(timeout=5)
        runner.counts["success"] += 1
    harness.runner.behavior = behavior
    updates = []
    result = harness.run(workers=4, progress=updates.append)
    assert result["success"] == result["completed"] == 12
    assert result["estimated_cost_usd"] == .12
    assert len({row[0] for row in harness.processed}) == 12
    assert len({row[1] for row in harness.processed}) == 4
    assert len({row[2] for row in harness.processed}) == 4
    assert len({row[3] for row in harness.processed}) == 4
    assert [item["completed"] for item in updates] == list(range(13))
    assert all(session.closed for session in harness.sessions)


@pytest.mark.parametrize("reason", ["auth_error_401", "model_not_found", "client_uninitialized"])
def test_fatal_error_stops_dispatch_but_finishes_inflight(harness, reason):
    barrier = Barrier(4)
    async def behavior(runner, article):
        barrier.wait(timeout=5)
        if article.article_id == "0":
            runner.counts["failed"] += 1
            runner.failure_reasons[reason] = 1
            runner.stopped_reason = reason
        else:
            await asyncio.sleep(.05)
            runner.counts["success"] += 1
    harness.runner.behavior = behavior
    result = harness.run(workers=4)
    assert result["stopped_reason"] == reason
    assert result["completed"] == 4
    assert result["success"] == 3


def test_unexpected_error_propagates_after_join(harness):
    barrier = Barrier(2)
    async def behavior(runner, article):
        barrier.wait(timeout=5)
        if article.article_id == "0":
            raise RuntimeError("unexpected")
        await asyncio.sleep(.05)
        runner.counts["success"] += 1
    harness.runner.behavior = behavior
    with pytest.raises(RuntimeError, match="unexpected"):
        harness.run(workers=2)
    assert len(harness.processed) == 2
    assert all(session.closed for session in harness.sessions)


def test_consecutive_failures_are_global_and_reset_on_success(harness):
    async def behavior(runner, article):
        failed = article.article_id != "2"
        runner.counts["failed" if failed else "success"] += 1
        if failed:
            runner.failure_reasons["timeout"] = runner.failure_reasons.get("timeout", 0) + 1
    harness.runner.behavior = behavior
    result = harness.run(workers=1)
    assert result["completed"] == 6
    assert result["stopped_reason"] == "consecutive_failures"


def test_source_filter_applies_before_limit(harness):
    harness.articles["0"].source = "other"
    result = harness.run(workers=1, source="cnyes", limit=2)
    assert result["completed"] == 2
    assert [row[0] for row in harness.processed] == ["1", "2"]


@pytest.mark.parametrize("workers", [0, 33, True, 1.5])
def test_invalid_workers(harness, workers):
    with pytest.raises(ValueError):
        harness.run(workers=workers)


def test_global_failure_threshold_across_workers(harness):
    barrier = Barrier(3)
    async def behavior(runner, article):
        if int(article.article_id) < 3:
            barrier.wait(timeout=5)
        else:
            await asyncio.sleep(.05)
        runner.counts["failed"] += 1
        runner.failure_reasons["timeout"] = runner.failure_reasons.get("timeout", 0) + 1
    harness.runner.behavior = behavior
    result = harness.run(workers=3)
    assert result["stopped_reason"] == "consecutive_failures"
    assert 3 <= result["completed"] <= 5
