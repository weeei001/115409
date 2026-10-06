from contextlib import contextmanager
from datetime import datetime, timedelta
from threading import Event, Thread
import time

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.core.errors import AppError
from app.db.base import Base
from app.db.models.admin import AdminAccount, AdminJobControl, AdminJobRun
from app.db.models.user import User
from app.features.admin import service
from app.jobs import runtime


def make_runtime(tmp_path, settings):
    engine = create_engine(f"sqlite:///{tmp_path / 'jobs.sqlite'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine, expire_on_commit=False)
    with factory() as db:
        user = User(email="operator@example.com", is_active=True)
        db.add(user)
        db.flush()
        db.add(AdminAccount(user_id=user.id))
        db.commit()
        user_id = user.id
    settings.JOBS_ENABLED = True
    jobs = runtime.JobRuntime(settings, factory)
    return jobs, factory, user_id, engine


def wait_until(predicate):
    deadline = time.monotonic() + 5
    while not predicate():
        assert time.monotonic() < deadline, "Runtime did not reach the expected state"
        time.sleep(0.01)


@pytest.mark.parametrize("result,paused,existing,stopped", [
    (0, False, False, False), (1, False, False, False),
    (0, True, False, False), (0, False, True, False), (1, False, False, True),
])
def test_manual_rag_does_not_enqueue_a_brief(tmp_path, settings, monkeypatch,
                                                         result, paused, existing, stopped):
    jobs, factory, user_id, engine = make_runtime(tmp_path, settings)
    jobs.status = "running"
    if paused:
        jobs.paused.add("text-brief")
    def pipeline(name, **kwargs):
        if stopped:
            jobs.stop_event.set()
        return result
    monkeypatch.setattr(runtime, "run_pipeline", pipeline)
    try:
        with factory() as db:
            if existing:
                db.add(AdminJobRun(job_name="text-brief", status="queued", trigger="manual", symbol="2330"))
                db.commit()
            run_id = service.perform_job(db, db.get(User, user_id), jobs, "rag", "run", None)["run_id"]
        assert jobs._execute(run_id) == result
        with factory() as db:
            assert db.get(AdminJobRun, run_id).finished_at is not None
            briefs = list(db.scalars(select(AdminJobRun).where(AdminJobRun.job_name == "text-brief")))
            assert len(briefs) == int(existing)
            if briefs:
                assert briefs[0].status == "queued"
                assert briefs[0].symbol == ("2330" if existing else None)
    finally:
        engine.dispose()


def test_pause_during_run_prevents_sibling_jobs_and_survives_restart(tmp_path, settings, monkeypatch):
    jobs, factory, user_id, engine = make_runtime(tmp_path, settings)
    entered, finish = Event(), Event()
    calls = []

    @contextmanager
    def lock(name):
        yield

    def pipeline(name, **kwargs):
        calls.append(name)
        entered.set()
        assert finish.wait(5)
        return 0

    monkeypatch.setattr(runtime, "worker_lock", lock)
    monkeypatch.setattr(runtime, "run_pipeline", pipeline)
    jobs.scheduler.next_market = datetime.now(runtime.TAIPEI) - timedelta(seconds=1)
    jobs.start()
    try:
        assert entered.wait(5)
        with factory() as db:
            actor = db.get(User, user_id)
            service.perform_job(db, actor, jobs, "ltn", "pause", None)
            service.perform_job(db, actor, jobs, "pipeline", "pause", None)
        assert jobs.snapshot()["jobs"][0]["active_run_id"] is not None
        finish.set()
        wait_until(lambda: not jobs.active)
        jobs.stop()
        assert calls == ["pipeline"]
        with factory() as db:
            run = db.scalar(select(AdminJobRun))
            assert run.status == "succeeded" and run.exit_code == 0
            assert db.get(AdminJobControl, "ltn").paused
        restarted = runtime.JobRuntime(settings, factory)
        restarted.start()
        try:
            wait_until(lambda: restarted.status == "running")
            assert {item["name"] for item in restarted.snapshot()["jobs"] if item["paused"]} == {"pipeline", "ltn"}
        finally:
            restarted.stop()
    finally:
        finish.set()
        jobs.stop()
        engine.dispose()


def test_duplicate_rejected_and_completed_run_can_rerun_while_paused(tmp_path, settings, monkeypatch):
    jobs, factory, user_id, engine = make_runtime(tmp_path, settings)
    jobs.status = "running"
    monkeypatch.setattr(runtime, "run_pipeline", lambda name, **kwargs: 7)
    try:
        with factory() as db:
            actor = db.get(User, user_id)
            service.perform_job(db, actor, jobs, "pipeline", "pause", None)
            first = service.perform_job(db, actor, jobs, "pipeline", "run", None)["run_id"]
            with pytest.raises(AppError) as exc:
                service.perform_job(db, actor, jobs, "pipeline", "run", None)
            assert exc.value.status_code == 409
        assert jobs._execute(first) == 7
        with factory() as db:
            previous = db.get(AdminJobRun, first)
            assert previous.status == "failed" and previous.error == "Job failed"
            next_id = service.perform_job(db, db.get(User, user_id), jobs, "pipeline", "retry", first)["run_id"]
            assert db.get(AdminJobRun, next_id).retry_of == first
            with pytest.raises(AppError) as exc:
                service.perform_job(db, db.get(User, user_id), jobs, "pipeline", "pause", first)
            assert exc.value.status_code == 422
    finally:
        engine.dispose()


def test_startup_marks_old_runs_interrupted_and_lock_contention_cannot_run(tmp_path, settings, monkeypatch):
    jobs, factory, user_id, engine = make_runtime(tmp_path, settings)
    with factory() as db:
        db.add(AdminJobRun(job_name="market", status="running", trigger="manual", actor_id=user_id,
                           started_at=datetime.now() - timedelta(minutes=1)))
        db.commit()

    @contextmanager
    def lock(name):
        yield

    monkeypatch.setattr(runtime, "worker_lock", lock)
    monkeypatch.setattr(runtime, "run_pipeline", lambda *args, **kwargs: pytest.fail("Unexpected worker"))
    jobs.start()
    try:
        wait_until(lambda: jobs.status == "running")
        with factory() as db:
            assert db.scalar(select(AdminJobRun)).status == "interrupted"
    finally:
        jobs.stop()

    @contextmanager
    def unavailable(name):
        raise runtime.JobAlreadyRunning("Busy")
        yield

    monkeypatch.setattr(runtime, "worker_lock", unavailable)
    competing = runtime.JobRuntime(settings, factory)
    competing.start()
    try:
        wait_until(lambda: competing.status == "standby")
        assert all(job["next_run_at"] is None for job in competing.snapshot()["jobs"])
        with factory() as db, pytest.raises(AppError) as exc:
            competing.perform(db, db.get(User, user_id), "market", "run")
        assert exc.value.status_code == 503
    finally:
        competing.stop()
        engine.dispose()


def test_shutdown_can_stop_a_child_while_database_control_holds_lock(tmp_path, settings):
    jobs, factory, user_id, engine = make_runtime(tmp_path, settings)
    held, release, stopped = Event(), Event(), Event()

    def hold_lock():
        with jobs.lock:
            held.set()
            release.wait(5)

    class Child:
        terminated = False
        def poll(self):
            return 0 if self.terminated else None
        def terminate(self):
            self.terminated = True
            raise ProcessLookupError("Child exited between poll and terminate")

    class FinishedThread:
        def join(self, timeout):
            pass

    blocker = Thread(target=hold_lock)
    blocker.start()
    assert held.wait(1)
    jobs.thread, jobs.child = FinishedThread(), Child()
    stopper = Thread(target=lambda: (jobs.stop(), stopped.set()), daemon=True)
    try:
        stopper.start()
        assert stopped.wait(1), "Shutdown blocked on the database control lock"
        assert jobs.child.terminated and jobs.stop_event.is_set()
    finally:
        release.set()
        blocker.join(2)
        stopper.join(2)
        engine.dispose()


def test_manual_run_advances_due_schedule_instead_of_running_twice(tmp_path, settings, monkeypatch):
    jobs, factory, user_id, engine = make_runtime(tmp_path, settings)
    entered, finish = Event(), Event()
    calls = []

    @contextmanager
    def lock(name):
        yield

    def pipeline(name, **kwargs):
        calls.append(name)
        entered.set()
        assert finish.wait(5)
        return 0

    monkeypatch.setattr(runtime, "worker_lock", lock)
    monkeypatch.setattr(runtime, "run_pipeline", pipeline)
    jobs.start()
    try:
        wait_until(lambda: jobs.status == "running")
        with factory() as db:
            service.perform_job(db, db.get(User, user_id), jobs, "pipeline", "run", None)
        assert entered.wait(5)
        jobs.scheduler.next_market = datetime.now(runtime.TAIPEI) - timedelta(seconds=1)
        finish.set()
        wait_until(lambda: jobs.scheduler.next_market > datetime.now(runtime.TAIPEI))
        assert calls == ["pipeline"]
    finally:
        finish.set()
        jobs.stop()
        engine.dispose()


def test_fully_completed_job_is_successful_during_shutdown_grace(tmp_path, settings, monkeypatch):
    jobs, factory, user_id, engine = make_runtime(tmp_path, settings)
    jobs.status = "running"
    entered, finish = Event(), Event()
    def pipeline(name, **kwargs):
        entered.set()
        assert finish.wait(5)
        return 0
    monkeypatch.setattr(runtime, "run_pipeline", pipeline)
    with factory() as db:
        run_id = service.perform_job(db, db.get(User, user_id), jobs, "market", "run", None)["run_id"]
    thread = Thread(target=jobs._execute, args=(run_id,))
    try:
        thread.start()
        assert entered.wait(5)
        jobs.stop_event.set()
        finish.set()
        thread.join(5)
        assert not thread.is_alive()
        with factory() as db:
            assert db.get(AdminJobRun, run_id).status == "succeeded"
    finally:
        finish.set()
        thread.join(5)
        engine.dispose()


def test_stage_diagnostics_keep_partial_failure_and_long_running_progress_unknown(tmp_path, settings, monkeypatch, capsys):
    jobs, factory, user_id, engine = make_runtime(tmp_path, settings)
    jobs.status = "running"
    entered, finish = Event(), Event()
    calls = []

    def worker(command):
        calls.append(command[0])
        if command[0] == "news-impact-sync":
            entered.set()
            assert finish.wait(5)
        return 3 if command[0] == "news-impact-batch" else 0

    monkeypatch.setattr(jobs, "_worker", worker)
    with factory() as db:
        run_id = service.perform_job(db, db.get(User, user_id), jobs, "rag", "run", None)["run_id"]
    thread = Thread(target=jobs._execute, args=(run_id,))
    try:
        thread.start()
        assert entered.wait(5)
        with factory() as db:
            live = service.get_run(db, run_id, jobs)["diagnostics"]
            assert live["stage"] == "news-impact-sync" and live["activity_kind"] == "stage_started"
            assert live["last_activity_at"] == live["stage_started_at"]
            assert live["worker_progress"] == "unknown"
            card = next(job for job in service.overview(db, jobs, "development")["jobs"] if job["name"] == "rag")
            assert card["active_run"]["id"] == run_id
            assert card["active_run"]["diagnostics"]["stage"] == "news-impact-sync"
            jobs.heartbeat = "2026-10-01T13:00:00Z"
            assert service.get_run(db, run_id, jobs)["diagnostics"]["last_activity_at"] == live["last_activity_at"]
        finish.set()
        thread.join(5)
        assert not thread.is_alive()
        assert calls == ["migrate-news-impact-schema", "news-ingest", "news-impact-batch", "news-impact-sync"]
        with factory() as db:
            result = service.get_run(db, run_id, jobs)
            assert result["status"] == "failed" and result["exit_code"] == 3
            assert result["diagnostics"]["failed_stages"] == [{"stage": "news-impact-batch", "exit_code": 3}]
            assert result["diagnostics"]["stage"] is None
        output = capsys.readouterr().out
        assert f"admin_run={run_id} stage=news-impact-sync event=started" in output
        assert f"admin_run={run_id} stage=news-impact-batch event=finished exit_code=3" in output
        assert "--execute" not in output and "--max-cost-usd" not in output
    finally:
        finish.set()
        thread.join(5)
        engine.dispose()


def test_exception_and_service_stop_have_safe_distinct_diagnostics(tmp_path, settings, monkeypatch):
    jobs, factory, user_id, engine = make_runtime(tmp_path, settings)
    jobs.status = "running"
    def fail(command):
        raise ValueError("private-key private endpoint and content")
    monkeypatch.setattr(jobs, "_worker", fail)
    try:
        with factory() as db:
            run_id = service.perform_job(db, db.get(User, user_id), jobs, "cnyes", "run", None)["run_id"]
        assert jobs._execute(run_id) == 1
        with factory() as db:
            data = service.get_run(db, run_id, jobs)
            assert data["diagnostics"]["error_category"] == "execution_exception"
            assert data["diagnostics"]["failed_stages"] == [{"stage": "crawl-cnyes", "exit_code": 1,
                "phase": "dispatch", "reason": "worker_exception", "error_type": "ValueError"}]
            assert "private" not in str(data)
            next_id = service.perform_job(db, db.get(User, user_id), jobs, "cnyes", "run", None)["run_id"]
        def stopping(command):
            jobs.stop_event.set()
            return 1
        monkeypatch.setattr(jobs, "_worker", stopping)
        assert jobs._execute(next_id) == 1
        with factory() as db:
            data = service.get_run(db, next_id, jobs)
            assert data["status"] == "interrupted"
            assert data["diagnostics"]["error_category"] == "service_stop"
        assert jobs.snapshot()["run_activity"] == {}
    finally:
        engine.dispose()


def test_worker_failure_reason_is_retained_after_child_and_later_stage_finish(tmp_path, settings, monkeypatch):
    import json
    from pathlib import Path
    from app.jobs.diagnostics import DIAGNOSTICS_ENV
    jobs, factory, user_id, engine = make_runtime(tmp_path, settings)
    jobs.status = "running"
    paths = []
    class Child:
        def __init__(self, command, environment):
            self.stage = command[3]
            self.path = Path(environment[DIAGNOSTICS_ENV])
            paths.append(self.path)
        def wait(self, timeout):
            if self.stage == "news-impact-batch":
                self.path.write_text(json.dumps({"phase": "analysis", "reason": "budget_exhausted",
                    "token": "private-key", "failure_reasons": {"validation_failed": 2, "private-content": 1}}))
                return 1
            return 0
    monkeypatch.setattr(runtime.subprocess, "Popen", lambda command, *, cwd, env: Child(command, env))
    try:
        with factory() as db:
            run_id = service.perform_job(db, db.get(User, user_id), jobs, "rag", "run", None)["run_id"]
        assert jobs._execute(run_id) == 1
        assert all(not path.parent.exists() for path in paths), "Per-child diagnostics must be cleaned up."
        with factory() as db:
            data = service.get_run(db, run_id, jobs)
            assert data["diagnostics"]["failed_stages"] == [{"stage": "news-impact-batch", "exit_code": 1,
                "phase": "analysis", "reason": "budget_exhausted", "failure_reasons": {"validation_failed": 2}}]
            assert "budget_exhausted" in data["error"] and "private" not in str(data)
            assert db.get(AdminJobRun, run_id).status == "failed"
    finally:
        engine.dispose()


def test_cnyes_only_policy_keeps_durable_source_pause_in_daily_pipeline(tmp_path, settings, monkeypatch):
    jobs, factory, user_id, engine = make_runtime(tmp_path, settings)
    with factory() as db:
        db.add(AdminJobControl(job_name="ltn", paused=True))
        old = AdminJobRun(job_name="ltn", status="failed", trigger="scheduled", exit_code=1)
        db.add(old)
        db.commit()
        old_id = old.id
    calls = []

    @contextmanager
    def lock(name):
        yield

    monkeypatch.setattr(runtime, "worker_lock", lock)
    monkeypatch.setattr(runtime, "run_pipeline", lambda name, **kwargs: calls.append(name) or 0)
    jobs.scheduler.next_market = datetime.now(runtime.TAIPEI) - timedelta(seconds=1)
    jobs.start()
    try:
        wait_until(lambda: calls == ["pipeline"] and not jobs.active)
        snapshot = jobs.snapshot()
        ltn = next(item for item in snapshot["jobs"] if item["name"] == "ltn")
        cnyes = next(item for item in snapshot["jobs"] if item["name"] == "cnyes")
        assert ltn["paused"] and ltn["next_run_at"] is None
        assert not cnyes["paused"] and cnyes["next_run_at"] is None
        with factory() as db:
            assert db.get(AdminJobRun, old_id).status == "failed"
            names = [row.job_name for row in db.scalars(select(AdminJobRun).order_by(AdminJobRun.id))]
            assert names == ["ltn", "pipeline"]
    finally:
        jobs.stop()
    restarted = runtime.JobRuntime(settings, factory)
    restarted.start()
    try:
        wait_until(lambda: restarted.status == "running")
        assert "ltn" in restarted.paused and not restarted._enabled("ltn")
        assert restarted._enabled("cnyes") and calls == ["pipeline"]
    finally:
        restarted.stop()
        engine.dispose()


@pytest.mark.parametrize("legacy_paused,explicit_pipeline,expected", [
    ("market", None, True), ("rag", None, True), ("text-brief", None, True),
    ("ltn", None, False), ("market", False, False), (None, True, True),
])
def test_pipeline_pause_migration_is_conservative_and_only_runs_once(
        tmp_path, settings, monkeypatch, legacy_paused, explicit_pipeline, expected):
    jobs, factory, user_id, engine = make_runtime(tmp_path, settings)
    with factory() as db:
        if legacy_paused:
            db.add(AdminJobControl(job_name=legacy_paused, paused=True))
        if explicit_pipeline is not None:
            db.add(AdminJobControl(job_name="pipeline", paused=explicit_pipeline))
        db.commit()
    @contextmanager
    def lock(name):
        yield
    monkeypatch.setattr(runtime, "worker_lock", lock)
    jobs.start()
    try:
        wait_until(lambda: jobs.status == "running")
        with factory() as db:
            assert db.get(AdminJobControl, "pipeline").paused is expected
        assert ("pipeline" in jobs.paused) is expected
    finally:
        jobs.stop()
        engine.dispose()


def test_pipeline_owns_all_stages_in_one_run_and_keeps_partial_failures(tmp_path, settings, monkeypatch):
    jobs, factory, user_id, engine = make_runtime(tmp_path, settings)
    jobs.status = "running"
    jobs.paused.add("ltn")
    calls = []
    def worker(command):
        calls.append(command[0])
        return 3 if command[0] == "news-impact-batch" else 0
    monkeypatch.setattr(jobs, "_worker", worker)
    try:
        with factory() as db:
            run_id = service.perform_job(db, db.get(User, user_id), jobs, "pipeline", "run", None)["run_id"]
        assert jobs._execute(run_id) == 3
        assert calls == ["market-backfill", "market-fetch", "market-import", "paper-reconcile",
            "crawl-cnyes", "migrate-news-impact-schema", "news-ingest", "news-impact-batch",
            "news-impact-sync", "cache-warmup"]
        with factory() as db:
            runs = list(db.scalars(select(AdminJobRun)))
            assert len(runs) == 1 and runs[0].status == "failed"
            assert "news-impact-batch" in runs[0].error
    finally:
        engine.dispose()
