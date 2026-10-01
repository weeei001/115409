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
    jobs.scheduler.next_news = {"cnyes": 0, "ltn": 0}
    jobs.start()
    try:
        assert entered.wait(5)
        with factory() as db:
            actor = db.get(User, user_id)
            service.perform_job(db, actor, jobs, "ltn", "pause", None)
            service.perform_job(db, actor, jobs, "cnyes", "pause", None)
        assert jobs.snapshot()["jobs"][1]["active_run_id"] is not None
        finish.set()
        wait_until(lambda: not jobs.active)
        jobs.stop()
        assert calls == ["cnyes"]
        with factory() as db:
            run = db.scalar(select(AdminJobRun))
            assert run.status == "succeeded" and run.exit_code == 0
            assert db.get(AdminJobControl, "ltn").paused
        restarted = runtime.JobRuntime(settings, factory)
        restarted.start()
        try:
            wait_until(lambda: restarted.status == "running")
            assert {item["name"] for item in restarted.snapshot()["jobs"] if item["paused"]} == {"cnyes", "ltn"}
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
            service.perform_job(db, actor, jobs, "market", "pause", None)
            first = service.perform_job(db, actor, jobs, "market", "run", None)["run_id"]
            with pytest.raises(AppError) as exc:
                service.perform_job(db, actor, jobs, "market", "run", None)
            assert exc.value.status_code == 409
        assert jobs._execute(first) == 7
        with factory() as db:
            previous = db.get(AdminJobRun, first)
            assert previous.status == "failed" and previous.error == "Job failed"
            next_id = service.perform_job(db, db.get(User, user_id), jobs, "market", "retry", first)["run_id"]
            assert db.get(AdminJobRun, next_id).retry_of == first
            with pytest.raises(AppError) as exc:
                service.perform_job(db, db.get(User, user_id), jobs, "market", "pause", first)
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
            service.perform_job(db, db.get(User, user_id), jobs, "cnyes", "run", None)
        assert entered.wait(5)
        jobs.scheduler.next_news["cnyes"] = 0
        finish.set()
        wait_until(lambda: jobs.scheduler.next_news["cnyes"] > time.monotonic())
        assert calls == ["cnyes"]
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
        if command[0] == "cache-warmup":
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
            assert live["stage"] == "cache-warmup" and live["activity_kind"] == "stage_started"
            assert live["last_activity_at"] == live["stage_started_at"]
            assert live["worker_progress"] == "unknown"
            jobs.heartbeat = "2026-10-01T13:00:00Z"
            assert service.get_run(db, run_id, jobs)["diagnostics"]["last_activity_at"] == live["last_activity_at"]
        finish.set()
        thread.join(5)
        assert not thread.is_alive()
        assert calls == ["migrate-news-impact-schema", "news-ingest", "news-impact-batch", "news-impact-sync", "cache-warmup"]
        with factory() as db:
            result = service.get_run(db, run_id, jobs)
            assert result["status"] == "failed" and result["exit_code"] == 3
            assert result["diagnostics"]["failed_stages"] == [{"stage": "news-impact-batch", "exit_code": 3}]
            assert result["diagnostics"]["stage"] is None
        output = capsys.readouterr().out
        assert f"admin_run={run_id} stage=cache-warmup event=started" in output
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


def test_cnyes_only_policy_uses_durable_pause_without_duplicate_followup(tmp_path, settings, monkeypatch):
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
    jobs.scheduler.next_news = {"cnyes": 0, "ltn": 0}
    jobs.scheduler.delay = 0
    jobs.start()
    try:
        wait_until(lambda: calls == ["cnyes", "rag"] and not jobs.active)
        snapshot = jobs.snapshot()
        ltn = next(item for item in snapshot["jobs"] if item["name"] == "ltn")
        cnyes = next(item for item in snapshot["jobs"] if item["name"] == "cnyes")
        assert ltn["paused"] and ltn["next_run_at"] is None
        assert not cnyes["paused"] and cnyes["next_run_at"] is not None
        with factory() as db:
            assert db.get(AdminJobRun, old_id).status == "failed"
            names = [row.job_name for row in db.scalars(select(AdminJobRun).order_by(AdminJobRun.id))]
            assert names == ["ltn", "cnyes", "rag"]
    finally:
        jobs.stop()
    restarted = runtime.JobRuntime(settings, factory)
    restarted.start()
    try:
        wait_until(lambda: restarted.status == "running")
        assert "ltn" in restarted.paused and not restarted._enabled("ltn")
        assert restarted._enabled("cnyes") and calls == ["cnyes", "rag"]
    finally:
        restarted.stop()
        engine.dispose()
