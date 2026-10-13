from contextlib import contextmanager
from datetime import datetime, time, timedelta

import pytest
from sqlalchemy import select

from app.core.errors import AppError
from app.db.models.admin import AdminJobControl, AdminJobRun
from app.db.models.user import User
from app.features.admin import service
from app.jobs import runtime, scheduler
from test_job_runtime import make_runtime, wait_until


AUTO_JOBS = {"market", "cnyes", "rag", "impact", "text-brief"}


def taipei(hour, minute=0, day=13):
    return datetime(2026, 7, day, hour, minute, tzinfo=scheduler.TAIPEI)


def test_automatic_deadlines_are_staggered_and_strictly_future():
    worker = scheduler.Scheduler(lambda name: 0, taipei(8))
    assert worker.next_runs == {
        "cnyes": taipei(9), "rag": taipei(8, 10),
        "impact": taipei(8, 20), "text-brief": taipei(22, 30),
        "market": taipei(8, 40),
    }
    assert worker.schedules == {
        "cnyes": "Hourly :00 Asia/Taipei", "rag": "Hourly :10 Asia/Taipei",
        "impact": "Hourly :20 Asia/Taipei", "text-brief": "Daily 22:30 Asia/Taipei",
        "market": "Weekdays 17:40, 18:40, 19:40, 20:40, 21:40; Mon-Sat 08:40 Asia/Taipei",
    }
    for name, deadline in worker.next_runs.items():
        restarted = scheduler.Scheduler(lambda job: 0, deadline)
        assert restarted.next_runs[name] > deadline


def test_custom_brief_time_and_utc_initialization():
    worker = scheduler.Scheduler(lambda name: 0,
        datetime.fromisoformat("2026-07-13T14:30:00+00:00"), brief_at=time(22, 30))
    assert worker.next_runs["text-brief"] == taipei(22, 30, day=14)
    custom = scheduler.Scheduler(lambda name: 0, taipei(8), brief_at=time(21, 45))
    assert custom.next_runs["text-brief"] == taipei(21, 45)
    assert custom.schedules["text-brief"] == "Daily 21:45 Asia/Taipei"


def test_overdue_jobs_coalesce_in_deadline_order_without_hot_loop():
    calls = []
    worker = scheduler.Scheduler(lambda name: calls.append(name) or 7, taipei(8, 1))
    delayed = taipei(23, day=15)
    worker.tick(delayed)
    assert calls == ["rag", "impact", "market", "cnyes", "text-brief"]
    assert all(deadline > delayed for deadline in worker.next_runs.values())
    worker.tick(delayed)
    assert len(calls) == 5


def test_paused_deadlines_advance_without_catchup_on_resume():
    calls, paused = [], {"rag"}
    worker = scheduler.Scheduler(lambda name: calls.append(name) or 0, taipei(8, 1),
        enabled=lambda name: name not in paused)
    worker.tick(taipei(8, 10))
    assert calls == []
    assert worker.next_runs["rag"] == taipei(9, 10)
    paused.clear()
    worker.tick(taipei(8, 11))
    assert calls == []
    worker.tick(taipei(9, 10))
    assert calls == ["impact", "market", "cnyes", "rag"]


def test_queue_failure_keeps_deadline_for_retry():
    calls = []

    def enqueue(name):
        calls.append(name)
        if len(calls) == 1:
            raise RuntimeError("Queue unavailable")
        return 0

    worker = scheduler.Scheduler(enqueue, taipei(8, 1))
    due = worker.next_runs["rag"]
    with pytest.raises(RuntimeError, match="Queue unavailable"):
        worker.tick(due)
    assert worker.next_runs["rag"] == due
    worker.tick(due)
    assert calls == ["rag", "rag"]
    assert worker.next_runs["rag"] == due + timedelta(hours=1)


@pytest.fixture
def jobs_runtime(tmp_path, settings):
    jobs, factory, actor_id, engine = make_runtime(tmp_path, settings)
    jobs.status = "running"
    yield jobs, factory, actor_id
    engine.dispose()


@pytest.mark.parametrize("name", sorted(AUTO_JOBS))
def test_scheduled_dispatch_persists_queue_without_executing(jobs_runtime, monkeypatch, name):
    jobs, factory, _ = jobs_runtime
    monkeypatch.setattr(jobs, "_execute", lambda run_id: pytest.fail("Dispatch executed worker"))
    assert jobs._scheduled(name) == 0
    with factory() as db:
        rows = list(db.scalars(select(AdminJobRun)))
        assert len(rows) == 1
        assert (rows[0].job_name, rows[0].status, rows[0].trigger, rows[0].symbol) == (
            name, "queued", "scheduled", None)
        assert rows[0].started_at is None


@pytest.mark.parametrize("status", ["queued", "running"])
def test_existing_run_prevents_scheduled_duplicate(jobs_runtime, status):
    jobs, factory, _ = jobs_runtime
    with factory() as db:
        db.add(AdminJobRun(job_name="rag", status=status, trigger="manual"))
        db.commit()
    assert jobs._scheduled("rag") == 0
    with factory() as db:
        assert len(list(db.scalars(select(AdminJobRun)))) == 1


@pytest.mark.parametrize("name", sorted(AUTO_JOBS))
def test_pause_is_durable_and_manual_run_still_allowed(jobs_runtime, name):
    jobs, factory, actor_id = jobs_runtime
    with factory() as db:
        actor = db.get(User, actor_id)
        service.perform_job(db, actor, jobs, name, "pause", None)
        assert db.get(AdminJobControl, name).paused
        assert name in jobs.paused
        assert jobs._scheduled(name) == 0
        result = service.perform_job(db, actor, jobs, name, "run", None)
        assert db.get(AdminJobRun, result["run_id"]).trigger == "manual"
        service.perform_job(db, actor, jobs, name, "resume", None)
        assert not db.get(AdminJobControl, name).paused
        assert name not in jobs.paused


@pytest.mark.parametrize("name", ["stock-backfill"])
@pytest.mark.parametrize("action", ["pause", "resume"])
def test_manual_only_jobs_reject_automatic_controls(jobs_runtime, name, action):
    jobs, factory, actor_id = jobs_runtime
    with factory() as db, pytest.raises(AppError) as exc:
        jobs.perform(db, db.get(User, actor_id), name, action)
    assert exc.value.status_code == 422


def test_snapshot_exposes_automatic_deadlines_and_retirement(jobs_runtime):
    jobs, _, _ = jobs_runtime
    jobs.paused.add("rag")
    jobs.active["impact"] = 42
    jobs.pending["text-brief"] = 43
    snapshot = {row["name"]: row for row in jobs.snapshot()["jobs"]}
    assert not {"pipeline", "all", "ltn"} & snapshot.keys()
    assert snapshot["rag"]["paused"] is True
    assert snapshot["rag"]["next_run_at"] is None
    for name in AUTO_JOBS - {"rag"}:
        assert snapshot[name]["next_run_at"] == jobs.scheduler.next_runs[name].isoformat()
        assert snapshot[name]["schedule"] == jobs.scheduler.schedules[name]
    for name in ("stock-backfill",):
        assert snapshot[name]["schedule"] == "Manual"
        assert snapshot[name]["next_run_at"] is None
    jobs.status = "disabled"
    assert all(row["next_run_at"] is None for row in jobs.snapshot()["jobs"])


def test_runtime_market_refresh_uses_daily_mode(jobs_runtime, monkeypatch):
    jobs, factory, _ = jobs_runtime
    calls = []
    monkeypatch.setattr(runtime, "run_pipeline", lambda name, **kwargs: calls.append((name, kwargs)) or 0)
    jobs._scheduled("market")
    with factory() as db:
        run_id = db.scalar(select(AdminJobRun.id))
    assert jobs._execute(run_id) == 0
    assert calls[0][0] == "market"
    assert calls[0][1]["daily_only"] is True
    with factory() as db:
        assert db.get(AdminJobRun, run_id).status == "succeeded"


def test_serial_runtime_continues_other_schedules_after_news_failure(
        jobs_runtime, monkeypatch):
    jobs, factory, _ = jobs_runtime
    jobs.settings.NOTIFICATIONS_ENABLED = False
    calls = []

    @contextmanager
    def lock(name):
        yield

    def pipeline(name, **kwargs):
        calls.append((name, kwargs["symbols"]))
        return 7 if name == "cnyes" else 0

    monkeypatch.setattr(runtime, "worker_lock", lock)
    monkeypatch.setattr(runtime, "run_pipeline", pipeline)
    fixed = taipei(12, 30)

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed.astimezone(tz) if tz else fixed.replace(tzinfo=None)

    monkeypatch.setattr(runtime, "datetime", Clock)
    jobs.scheduler.next_runs["market"] = taipei(17, 40)
    for offset, name in enumerate(("cnyes", "rag", "impact", "text-brief")):
        jobs.scheduler.next_runs[name] = fixed - timedelta(minutes=4 - offset)

    def completed():
        with factory() as db:
            return len(list(db.scalars(select(AdminJobRun).where(
                AdminJobRun.status.in_(["succeeded", "failed"]))))) == 4

    jobs.start()
    try:
        wait_until(completed)
        assert calls == [("cnyes", None), ("rag", None), ("impact", None), ("text-brief", None)]
        with factory() as db:
            rows = list(db.scalars(select(AdminJobRun).order_by(AdminJobRun.id)))
            assert [row.status for row in rows] == ["failed", "succeeded", "succeeded", "succeeded"]
            assert all(row.trigger == "scheduled" for row in rows)
            assert all(row.started_at is not None and row.finished_at is not None for row in rows)
        assert all(deadline > fixed for deadline in jobs.scheduler.next_runs.values())
    finally:
        jobs.stop()
