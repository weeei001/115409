from contextlib import contextmanager
from datetime import datetime, timedelta
from threading import Event, Thread
import time

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.exc import SQLAlchemyError
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


def test_crawler_timeout_reaches_admin_api_and_preserves_successful_articles(tmp_path, settings, monkeypatch):
    import json
    from pathlib import Path
    import httpx
    from fastapi.testclient import TestClient
    from app.main import create_app
    from app.db.session import get_db
    from app.db.models.news_article import NewsArticle
    from app.features.admin.router import get_administrator
    from app.jobs import crawlers
    from app.jobs.diagnostics import DIAGNOSTICS_ENV
    from app.jobs.impact import migrate

    jobs, factory, user_id, engine = make_runtime(tmp_path, settings)
    jobs.status = 'running'
    attempts, paths = [], []
    def provider(request):
        if request.url.host == 'api.cnyes.com':
            return httpx.Response(200, json={'items': [
                {'newsId': number, 'title': f'News {number}', 'publishAt': 1704067200}
                for number in (12345, 12346)]})
        if request.url.path.endswith('/12346'):
            attempts.append(request.url.path)
            raise httpx.ReadTimeout('private upstream credentials', request=request)
        payload = {'@type': 'NewsArticle', 'headline': 'News 12345',
            'articleBody': 'Company revenue and operating results increased this quarter. ' * 5}
        return httpx.Response(200, text=f'<script type="application/ld+json">{json.dumps(payload)}</script>')

    monkeypatch.setattr(crawlers, 'CNYES_CATEGORIES', ('tw_stock_news',))
    monkeypatch.setattr(crawlers, 'get_settings', lambda: settings)
    monkeypatch.setattr(crawlers, 'make_engine', lambda _: engine)
    monkeypatch.setattr(crawlers, 'make_sync_http_client',
        lambda _: httpx.Client(transport=httpx.MockTransport(provider)))
    monkeypatch.setattr(crawlers, 'sleep', lambda _: None)
    monkeypatch.setattr(migrate, 'migrate_news_impact', lambda _: None)

    class Child:
        def __init__(self, command, *, cwd, env):
            paths.append(Path(env[DIAGNOSTICS_ENV]))
            with monkeypatch.context() as child_env:
                child_env.setenv(DIAGNOSTICS_ENV, env[DIAGNOSTICS_ENV])
                self.result = crawlers.crawler_main('cnyes', command[4:])
        def wait(self, timeout):
            return self.result

    monkeypatch.setattr(runtime.subprocess, 'Popen', Child)
    try:
        with factory() as db:
            run_id = service.perform_job(db, db.get(User, user_id), jobs, 'cnyes', 'run', None)['run_id']
        assert jobs._execute(run_id) == 1
        settings.JOBS_ENABLED = False
        app = create_app(settings)
        def database():
            with factory() as db:
                yield db
        app.dependency_overrides[get_db] = database
        app.dependency_overrides[get_administrator] = lambda: User(id=user_id)
        with TestClient(app) as client:
            response = client.get(f'/admin/runs/{run_id}')
        assert response.status_code == 200
        data = response.json()
        assert data['status'] == 'failed' and data['exit_code'] == 1
        assert data['diagnostics']['failed_stages'] == [{'stage': 'crawl-cnyes', 'exit_code': 1,
            'phase': 'http', 'reason': 'crawl_incomplete', 'failure_reasons': {'crawl_timeout': 1}}]
        assert 'private' not in response.text
        assert len(attempts) == 3
        assert all(not path.exists() for path in paths)
        with factory() as db:
            articles = list(db.scalars(select(NewsArticle)))
            assert len(articles) == 1 and articles[0].content_kind == 'full_text'
    finally:
        engine.dispose()


@pytest.mark.parametrize("existing_pause", [None, False, True])
def test_ltn_is_retired_even_with_legacy_enabled_controls(
        tmp_path, settings, monkeypatch, existing_pause):
    jobs, factory, user_id, engine = make_runtime(tmp_path, settings)
    if existing_pause is not None:
        with factory() as db:
            db.add(AdminJobControl(job_name="ltn", paused=existing_pause))
            db.commit()

    @contextmanager
    def lock(name):
        yield

    monkeypatch.setattr(runtime, "worker_lock", lock)
    jobs.start()
    try:
        wait_until(lambda: jobs.status == "running")
        with factory() as db:
            assert db.get(AdminJobControl, "ltn").paused is True
            actor = db.get(User, user_id)
            for action in ("run", "retry", "resume"):
                with pytest.raises(AppError, match="retired"):
                    jobs.perform(db, actor, "ltn", action)
        jobs.apply_control("ltn", "resume")
        assert not jobs._enabled("ltn")
        assert jobs._enabled("cnyes")
    finally:
        jobs.stop()
        engine.dispose()


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


def test_duplicate_rejected_and_completed_manual_run_can_rerun(tmp_path, settings, monkeypatch):
    jobs, factory, user_id, engine = make_runtime(tmp_path, settings)
    jobs.status = "running"
    monkeypatch.setattr(runtime, "run_pipeline", lambda name, **kwargs: 7)
    try:
        with factory() as db:
            actor = db.get(User, user_id)
            for action in ("pause", "resume"):
                with pytest.raises(AppError, match="Manual"):
                    jobs.perform(db, actor, "market", action)
            first = service.perform_job(db, actor, jobs, "cnyes", "run", None)["run_id"]
            with pytest.raises(AppError) as exc:
                service.perform_job(db, actor, jobs, "cnyes", "run", None)
            assert exc.value.status_code == 409
        assert jobs._execute(first) == 7
        with factory() as db:
            previous = db.get(AdminJobRun, first)
            assert previous.status == "failed" and previous.error == "Job failed"
            next_id = service.perform_job(db, db.get(User, user_id), jobs, "cnyes", "retry", first)["run_id"]
            assert db.get(AdminJobRun, next_id).retry_of == first
            with pytest.raises(AppError) as exc:
                service.perform_job(db, db.get(User, user_id), jobs, "cnyes", "pause", first)
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


def test_manual_job_runs_once_without_automatic_followup(tmp_path, settings, monkeypatch):
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
            service.perform_job(db, db.get(User, user_id), jobs, "market", "run", None)
        assert entered.wait(5)
        finish.set()
        wait_until(lambda: not jobs.active)
        assert calls == ["market"]
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
        run_id = service.perform_job(db, db.get(User, user_id), jobs, "impact", "run", None)["run_id"]
    thread = Thread(target=jobs._execute, args=(run_id,))
    try:
        thread.start()
        assert entered.wait(5)
        with factory() as db:
            live = service.get_run(db, run_id, jobs)["diagnostics"]
            assert live["stage"] == "news-impact-sync" and live["activity_kind"] == "stage_started"
            assert live["last_activity_at"] == live["stage_started_at"]
            assert live["worker_progress"] == "unknown"
            card = next(job for job in service.overview(db, jobs, "development")["jobs"] if job["name"] == "impact")
            assert card["active_run"]["id"] == run_id
            assert card["active_run"]["diagnostics"]["stage"] == "news-impact-sync"
            jobs.heartbeat = "2026-10-01T13:00:00Z"
            assert service.get_run(db, run_id, jobs)["diagnostics"]["last_activity_at"] == live["last_activity_at"]
        finish.set()
        thread.join(5)
        assert not thread.is_alive()
        assert calls == ["migrate-news-impact-schema", "news-impact-batch", "news-impact-sync"]
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


@pytest.mark.parametrize("stopping", [False, True])
def test_indexing_interrupt_before_lifespan_stop_is_retryable(tmp_path, settings, monkeypatch, stopping):
    jobs, factory, user_id, engine = make_runtime(tmp_path, settings)
    jobs.status = "running"
    calls = []

    def worker(command):
        calls.append(command[0])
        if command[0] == "news-ingest":
            if stopping:
                jobs.stop_event.set()
            return 130
        return 0

    monkeypatch.setattr(jobs, "_worker", worker)
    try:
        with factory() as db:
            run_id = service.perform_job(db, db.get(User, user_id), jobs, "rag", "run", None)["run_id"]
        assert jobs._execute(run_id) == 130
        assert calls == ["migrate-news-impact-schema", "news-ingest"]
        with factory() as db:
            data = service.get_run(db, run_id, jobs)
            assert data["status"] == "interrupted" and data["exit_code"] == 130
            assert data["diagnostics"]["error_category"] == ("service_stop" if stopping else "worker_interrupted")
            assert data["diagnostics"]["failed_stages"] == []
            overview = service.overview(db, jobs, "development")
            card = next(item for item in overview["jobs"] if item["name"] == "rag")
            assert card["result_summary"]["last_failure"] is None
            assert card["result_summary"]["consecutive_failed"] == 0
            jobs.stop_event.clear()
            retry_id = service.perform_job(db, db.get(User, user_id), jobs, "rag", "retry", run_id)["run_id"]
        monkeypatch.setattr(jobs, "_worker", lambda command: 0)
        assert jobs._execute(retry_id) == 0
        with factory() as db:
            retry = service.get_run(db, retry_id, jobs)
            assert retry["status"] == "succeeded" and retry["retry_of"] == run_id
        assert jobs.snapshot()["run_activity"] == {}
    finally:
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
            run_id = service.perform_job(db, db.get(User, user_id), jobs, "impact", "run", None)["run_id"]
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


@pytest.mark.parametrize("retired", ["pipeline", "all", "ltn"])
def test_retired_jobs_keep_history_but_cannot_execute_queued_runs(tmp_path, settings, monkeypatch, retired):
    jobs, factory, user_id, engine = make_runtime(tmp_path, settings)
    jobs.status = "running"
    monkeypatch.setattr(runtime, "run_pipeline", lambda *a, **k: pytest.fail("Retired worker ran"))
    try:
        with factory() as db:
            old = AdminJobRun(job_name=retired, status="failed", trigger="scheduled", exit_code=1)
            queued = AdminJobRun(job_name=retired, status="queued", trigger="manual")
            db.add_all([old, queued]); db.commit()
            old_id, queued_id = old.id, queued.id
            for action in ("run", "retry", "resume"):
                with pytest.raises(AppError):
                    jobs.perform(db, db.get(User, user_id), retired, action)
        assert jobs._execute(queued_id) == 1
        assert not jobs._enabled(retired)
        assert retired not in {job["name"] for job in jobs.snapshot()["jobs"]}
        assert {job["name"] for job in jobs.snapshot()["jobs"] if job["schedule"] == "Manual"} == {"market", "stock-backfill"}
        with factory() as db:
            assert db.get(AdminJobRun, old_id).status == "failed"
            assert db.get(AdminJobRun, queued_id).status == "interrupted"
            assert service.get_run(db, queued_id)["diagnostics"]["error_category"] == "job_retired"
    finally:
        engine.dispose()
