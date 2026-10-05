"""One serial scheduler owned by the FastAPI lifespan, with durable admin controls."""
from datetime import datetime, timedelta, timezone
import logging
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from threading import Event, RLock, Thread
import time as clock

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import state_directory
from app.core.errors import AppError, Conflict, NotFound, ServiceUnavailable
from app.db.models.admin import AdminJobControl, AdminJobRun
from app.db.models.stock_info import StockInfo
from app.features.admin.diagnostics import STAGES, format_failure
from app.jobs.diagnostics import DIAGNOSTICS_ENV, failure_record, read_failure
from app.jobs.locking import JobAlreadyRunning, worker_lock
from app.jobs.scheduler import ROOT, TAIPEI, Scheduler, next_daily, run_pipeline


JOBS = {
    "market": "Market data", "cnyes": "Cnyes news", "ltn": "Liberty Times news",
    "rag": "News indexing and analysis", "impact": "Event analysis", "text-brief": "Brief warmup",
    "stock-backfill": "Stock market history",
}
logger = logging.getLogger(__name__)


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class JobRuntime:
    def __init__(self, settings, session_factory):
        self.settings, self.session_factory = settings, session_factory
        self.lock = RLock()
        self.stop_event = Event()
        self.thread = None
        self.child = None
        self.worker_diagnostic = {}
        self.status = "disabled" if not settings.JOBS_ENABLED else "starting"
        self.error = None
        self.heartbeat = None
        self.paused = set()
        self.active = {}
        self.pending = {}
        self.run_activity = {}
        self.next_notifications = 0.0
        self.scheduler = Scheduler(self._scheduled, datetime.now(TAIPEI), clock.monotonic(),
            interval=settings.JOBS_INTERVAL_MINUTES * 60,
            delay=settings.JOBS_RAG_DELAY_MINUTES * 60,
            market_at=settings.JOBS_MARKET_TIME, enabled=self._enabled)

    def start(self):
        if not self.settings.JOBS_ENABLED:
            return
        if self.settings.JOBS_MARKET_TIME.tzinfo is not None:
            self.status, self.error = "unavailable", "JOBS_MARKET_TIME must be Taiwan local time"
            return
        self.thread = Thread(target=self._loop, name="admin-jobs", daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.thread is None:
            return
        # Shutdown must not wait on a control transaction that is blocked in the database.
        self.status = "stopping"
        self.thread.join(timeout=30)
        self._stop_child()
        self.thread.join(timeout=10)
        self._stop_child(kill=True)
        self.thread.join(timeout=5)

    def _stop_child(self, *, kill=False):
        child = self.child
        if child is not None and child.poll() is None:
            try:
                if kill:
                    child.kill()
                else:
                    child.terminate()
            except OSError as exc:
                logger.warning("Child stop failed or child already exited: %s", type(exc).__name__)

    def _enabled(self, name):
        with self.lock:
            return not self.stop_event.is_set() and name not in self.paused

    def _loop(self):
        # ponytail: one owner per environment; use one ASGI worker for direct job controls.
        try:
            with worker_lock("scheduler"):
                initialized = False
                while not self.stop_event.is_set():
                    try:
                        with self.lock, self.session_factory() as db:
                            if not initialized:
                                for run in db.scalars(select(AdminJobRun).where(
                                        AdminJobRun.status.in_(["queued", "running"]))):
                                    run.status, run.finished_at = "interrupted", utcnow()
                                    run.error = "Service restarted before this run completed"
                                db.commit()
                                initialized = True
                            else:
                                orphaned = list(db.scalars(select(AdminJobRun).where(
                                    AdminJobRun.status == "running")))
                                for run in orphaned:
                                    run.status, run.finished_at = "interrupted", utcnow()
                                    run.error = "Run completion could not be recorded"
                                if orphaned:
                                    db.commit()
                            self.paused = {row.job_name for row in db.scalars(
                                select(AdminJobControl).where(AdminJobControl.paused.is_(True)))}
                            queued_runs = list(db.scalars(select(AdminJobRun).where(
                                AdminJobRun.status == "queued").order_by(AdminJobRun.id)))
                            self.pending = {row.job_name: row.id for row in queued_runs}
                            queued = queued_runs[0] if queued_runs else None
                            queued_id = queued.id if queued else None
                            queued_name = queued.job_name if queued else None
                            self.status, self.error = "running", None
                            self.heartbeat = datetime.now(timezone.utc).isoformat()
                        self._notification_tick()
                        if queued_id is not None:
                            if queued_name == "rag":
                                self.scheduler.followup = None
                            result = self._execute(queued_id)
                            if queued_name in self.scheduler.next_news:
                                self.scheduler.next_news[queued_name] = clock.monotonic() + self.scheduler.interval
                            elif queued_name == "market":
                                self.scheduler.next_market = next_daily(datetime.now(TAIPEI), self.scheduler.market_at)
                            if (queued_name in {"cnyes", "ltn"} or queued_name == "market" and result == 0):
                                if self.scheduler.followup is None:
                                    self.scheduler.followup = clock.monotonic() + self.scheduler.delay
                        else:
                            self.scheduler.tick(datetime.now(TAIPEI), clock.monotonic())
                    except SQLAlchemyError:
                        with self.lock:
                            self.status = "unavailable"
                            self.error = "Jobs database unavailable; initialize the admin tables before scheduling"
                        logger.error("Jobs database unavailable")
                        if self.stop_event.wait(5):
                            break
                    except Exception as exc:
                        with self.lock:
                            self.status, self.error = "unavailable", f"Scheduler failed ({type(exc).__name__})"
                        logger.error("Scheduler failed: %s", type(exc).__name__)
                        if self.stop_event.wait(5):
                            break
                    self.stop_event.wait(1)
        except JobAlreadyRunning:
            with self.lock:
                self.status = "standby"
                self.error = "Another scheduler owns this environment; stop the standalone scheduler or extra ASGI worker"
        except OSError:
            with self.lock:
                self.status, self.error = "unavailable", "Scheduler lock unavailable"
        finally:
            if self.stop_event.is_set():
                with self.lock:
                    self.status = "stopped"

    def _scheduled(self, name):
        with self.lock, self.session_factory() as db:
            if not self._enabled(name):
                return 0
            # A queued manual run takes precedence over the same scheduled job.
            existing = db.scalar(select(AdminJobRun).where(AdminJobRun.job_name == name,
                AdminJobRun.status.in_(["queued", "running"])).limit(1))
            if existing is not None:
                return 0
            row = AdminJobRun(job_name=name, status="queued", trigger="scheduled", created_at=utcnow())
            db.add(row)
            db.commit()
            run_id = row.id
        return self._execute(run_id)

    def _notification_tick(self):
        if not self.settings.NOTIFICATIONS_ENABLED or self.stop_event.is_set() or clock.monotonic() < self.next_notifications:
            return
        self.next_notifications = clock.monotonic() + 60
        try:
            result = self._worker(["notifications", "--execute"])
            if result:
                logger.warning("Notification worker failed (exit code %s)", result)
        except Exception as exc:
            logger.warning("Notification worker failed (%s)", type(exc).__name__)

    def _execute(self, run_id):
        with self.lock, self.session_factory() as db:
            row = db.get(AdminJobRun, run_id)
            if row is None or row.status != "queued" or self.stop_event.is_set():
                return 1
            name, symbol = row.job_name, row.symbol
            row.status, row.started_at = "running", utcnow()
            db.commit()
            self.active[name] = run_id
            self.pending.pop(name, None)
        failures = []

        def worker(command):
            stage = command[0] if command and command[0] in STAGES else None
            started = datetime.now(timezone.utc).isoformat()
            with self.lock:
                self.run_activity[name] = {"run_id": run_id, "stage": stage,
                    "stage_started_at": started, "last_activity_at": started}
            print(f"admin_run={run_id} stage={stage or 'unknown'} event=started at={started}", flush=True)
            try:
                self.worker_diagnostic = {}
                result = self._worker(command)
            except Exception as exc:
                failures.append(format_failure(command[0], 1, failure_record("dispatch", error=exc)))
                print(f"admin_run={run_id} stage={stage or 'unknown'} event=exception at={datetime.now(timezone.utc).isoformat()}", flush=True)
                raise
            print(f"admin_run={run_id} stage={stage or 'unknown'} event=finished exit_code={result} at={datetime.now(timezone.utc).isoformat()}", flush=True)
            with self.lock:
                self.run_activity.pop(name, None)
            if result:
                failures.append(format_failure(command[0], result, self.worker_diagnostic))
            return result

        error = None
        try:
            result = run_pipeline(name, start=self.settings.JOBS_START_DATE, symbols=symbol,
                output=state_directory() / "market", run=worker,
                impact_limit=self.settings.JOBS_IMPACT_LIMIT,
                impact_max_cost_usd=self.settings.JOBS_IMPACT_MAX_COST_USD,
                impact_since=self.settings.JOBS_IMPACT_SINCE)
            status = "succeeded" if result == 0 else "failed"
            error = "; ".join(failures) or ("Job failed" if result else None)
        except Exception as exc:
            result, status, error = 1, "failed", "; ".join(failures) or f"Job failed ({type(exc).__name__})"
        if self.stop_event.is_set() and result != 0:
            status, error = "interrupted", "Service stopped before this run completed"
        try:
            with self.lock, self.session_factory() as db:
                row = db.get(AdminJobRun, run_id)
                row.status, row.finished_at, row.exit_code, row.error = status, utcnow(), result, error
                followup = None
                if name == "rag" and self._enabled("text-brief"):
                    existing = db.scalar(select(AdminJobRun.id).where(
                        AdminJobRun.job_name == "text-brief",
                        AdminJobRun.status.in_(["queued", "running"])).limit(1))
                    if existing is None:
                        followup = AdminJobRun(job_name="text-brief", status="queued", trigger="scheduled",
                                               created_at=utcnow())
                        db.add(followup)
                db.commit()
                if followup is not None:
                    self.pending["text-brief"] = followup.id
        finally:
            with self.lock:
                self.active.pop(name, None)
                self.run_activity.pop(name, None)
        return result

    def _worker(self, command):
        self.worker_diagnostic = {}
        with TemporaryDirectory(prefix="app-job-diagnostics-") as directory:
            diagnostic_path = Path(directory) / "failure.json"
            environment = dict(os.environ, **{DIAGNOSTICS_ENV: str(diagnostic_path)})
            return self._wait_worker(command, diagnostic_path, environment)

    def _wait_worker(self, command, diagnostic_path, environment):
        with self.lock:
            if self.stop_event.is_set():
                raise InterruptedError("Service stopping")
            child = subprocess.Popen([sys.executable, "-m", "app.jobs", *command], cwd=ROOT, env=environment)
            self.child = child
            if self.stop_event.is_set():
                self._stop_child()
        try:
            while True:
                try:
                    result = child.wait(timeout=1)
                    if result:
                        self.worker_diagnostic = read_failure(diagnostic_path)
                    return result
                except subprocess.TimeoutExpired:
                    with self.lock:
                        self.heartbeat = datetime.now(timezone.utc).isoformat()
        finally:
            with self.lock:
                self.child = None

    def perform(self, db, actor, job_name, action, run_id=None, symbol=None):
        if job_name not in JOBS:
            raise NotFound("Unknown job")
        if action not in {"run", "retry", "pause", "resume"}:
            raise AppError("Unknown job action", 422)
        if action == "retry" and run_id is None or action != "retry" and run_id is not None:
            raise AppError("A run_id is required only for retry", 422)
        if symbol is not None:
            if job_name not in {"text-brief", "stock-backfill"} or action != "run":
                raise AppError("A symbol is supported only for text-brief or stock-backfill run", 422)
            if db.get(StockInfo, symbol) is None:
                raise NotFound("Stock not found")
        if job_name == "stock-backfill":
            if action in {"pause", "resume"}:
                raise AppError("Stock backfill is a manual job", 422)
            if action == "run" and symbol is None:
                raise AppError("Stock backfill requires a symbol", 422)
        if self.status != "running" or self.stop_event.is_set():
            raise ServiceUnavailable("Scheduler is not available for job controls")
        if action in {"pause", "resume"}:
            row = db.get(AdminJobControl, job_name)
            if row is None:
                row = AdminJobControl(job_name=job_name)
                db.add(row)
            row.paused = action == "pause"
            db.flush()
            return None
        if db.scalar(select(AdminJobRun.id).where(AdminJobRun.job_name == job_name,
                AdminJobRun.status.in_(["queued", "running"])).limit(1)) is not None:
            raise Conflict("Job is already queued or running")
        retry_of = None
        if action == "retry":
            previous = db.get(AdminJobRun, run_id) if run_id is not None else None
            if previous is None or previous.job_name != job_name:
                raise NotFound("Job run not found")
            if previous.status not in {"succeeded", "failed", "interrupted"}:
                raise Conflict("Only completed runs can be rerun")
            retry_of = previous.id
            symbol = previous.symbol
            if job_name == "stock-backfill" and (not symbol or db.get(StockInfo, symbol) is None):
                raise NotFound("Stock not found")
        row = AdminJobRun(job_name=job_name, status="queued", trigger="retry" if retry_of else "manual",
            actor_id=actor.id, retry_of=retry_of, symbol=symbol, created_at=utcnow())
        db.add(row)
        db.flush()
        return row

    def apply_control(self, job_name, action, run_id=None):
        with self.lock:
            if action == "pause":
                self.paused.add(job_name)
            elif action == "resume":
                self.paused.discard(job_name)
            elif action in {"run", "retry"}:
                self.pending[job_name] = run_id

    def snapshot(self):
        with self.lock:
            now, monotonic = datetime.now(timezone.utc), clock.monotonic()
            jobs = []
            for name, label in JOBS.items():
                next_at = None
                schedule = "Manual"
                if name == "market":
                    next_at, schedule = self.scheduler.next_market, f"Daily {self.settings.JOBS_MARKET_TIME:%H:%M} Asia/Taipei"
                elif name in self.scheduler.next_news:
                    next_at = now + timedelta(seconds=self.scheduler.next_news[name] - monotonic)
                    schedule = f"Every {self.settings.JOBS_INTERVAL_MINUTES:g} minutes"
                elif name == "rag":
                    if self.scheduler.followup is not None:
                        next_at = now + timedelta(seconds=self.scheduler.followup - monotonic)
                    schedule = f"After data jobs + {self.settings.JOBS_RAG_DELAY_MINUTES:g} minutes"
                elif name == "text-brief":
                    schedule = "After news indexing"
                jobs.append({"name": name, "label": label, "schedule": schedule,
                    "paused": name in self.paused,
                    "next_run_at": (next_at.isoformat() if next_at and self.status == "running"
                        and name not in self.paused and name not in self.active and name not in self.pending else None),
                    "active_run_id": self.active.get(name), "queued_run_id": self.pending.get(name)})
            return {"status": self.status, "heartbeat": self.heartbeat, "error": self.error, "jobs": jobs,
                "run_activity": {name: dict(value) for name, value in self.run_activity.items()}}
