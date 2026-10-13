import ast
from contextlib import contextmanager
from datetime import date, datetime, time, timedelta, timezone
import inspect
from pathlib import Path
import subprocess

import pytest

from app.jobs import locking, scheduler


@pytest.mark.parametrize("job", ["pipeline", "all", "ltn"])
def test_retired_jobs_never_dispatch(job, tmp_path):
    with pytest.raises(ValueError, match="retired"):
        scheduler.run_pipeline(job, start=date(2026, 7, 1), symbols=None, output=tmp_path,
            run=lambda command: pytest.fail("Retired job dispatched"))


def test_interrupted_impact_stage_does_not_start_sync(tmp_path):
    calls = []
    def run(command):
        calls.append(command[0])
        return 130 if command[0] == "news-impact-batch" else 0
    assert scheduler.run_pipeline("impact", start=date(2026, 7, 1), symbols=None,
        output=tmp_path, run=run) == 130
    assert calls == ["migrate-news-impact-schema", "news-impact-batch"]


def test_text_brief_without_symbols_lets_warmup_read_stock_info(tmp_path):
    commands = []
    assert scheduler.run_pipeline("text-brief", start=date(2026, 7, 1), symbols=None, output=tmp_path,
        run=lambda command: commands.append(command) or 0) == 0
    assert commands == [["cache-warmup"]]


@pytest.mark.parametrize("failure", ["market-backfill", "market-fetch", "market-import",
    "market-supplemental-backfill", "paper-reconcile"])
def test_independent_market_job_stops_at_failed_stage(failure, tmp_path):
    calls = []
    def run(command):
        calls.append(command[0])
        return 7 if command[0] == failure else 0
    assert scheduler.run_pipeline("market", start=date(2026, 7, 1), symbols="2330",
        output=tmp_path, run=run) == 7
    assert calls[-1] == failure
    assert not set(calls) & {"crawl-cnyes", "news-ingest", "news-impact-batch", "cache-warmup"}


@pytest.mark.parametrize("ingest_result", [0, 7])
def test_indexing_is_independent_of_ai_analysis(ingest_result, tmp_path):
    calls = []
    def run(command):
        calls.append(command[0])
        if command[0] == "news-ingest":
            return ingest_result
        if command[0] in {"news-impact-batch", "news-impact-sync", "cache-warmup"}:
            pytest.fail("Indexing must not run AI analysis or warmup")
        return 0
    assert scheduler.run_pipeline("rag", start=date(2026, 7, 1), symbols=None,
        output=tmp_path, run=run) == ingest_result
    assert calls == ["migrate-news-impact-schema", "news-ingest"]


@pytest.mark.parametrize("now, at, expected", [
    ("2026-07-13T16:59:59+08:00", time(17), "2026-07-13T17:00:00+08:00"),
    ("2026-07-13T17:00:00+08:00", time(17), "2026-07-14T17:00:00+08:00"),
    ("2026-07-13T23:00:00+00:00", time(6), "2026-07-15T06:00:00+08:00"),
])
def test_daily_deadline_is_future_taipei_time(now, at, expected):
    assert scheduler.next_daily(datetime.fromisoformat(now), at) == datetime.fromisoformat(expected)


def test_daily_tick_never_dispatches_retired_pipeline():
    start = datetime(2026, 7, 13, 16, tzinfo=scheduler.TAIPEI)
    calls = []
    worker = scheduler.Scheduler(lambda job: calls.append(job), start)
    for days in (0, 1, 30):
        worker.tick(start + timedelta(days=days, hours=3))
    assert set(calls) == {"market", "cnyes", "rag", "impact", "text-brief"}


@pytest.mark.parametrize("now,expected", [
    ("2026-10-13T08:39:00+08:00", "2026-10-13T08:40:00+08:00"),
    ("2026-10-13T08:40:00+08:00", "2026-10-13T17:40:00+08:00"),
    ("2026-10-13T17:40:00+08:00", "2026-10-13T18:40:00+08:00"),
    ("2026-10-13T13:40:00+00:00", "2026-10-14T08:40:00+08:00"),
    ("2026-10-16T21:40:00+08:00", "2026-10-17T08:40:00+08:00"),
    ("2026-10-17T08:40:00+08:00", "2026-10-19T08:40:00+08:00"),
])
def test_market_refresh_covers_late_publication_and_skips_weekend_evenings(now, expected):
    worker = scheduler.Scheduler(lambda job: None, datetime.fromisoformat(now))
    assert worker.next_runs["market"] == datetime.fromisoformat(expected)


def test_daily_market_refresh_bounds_history_and_skips_supplemental_work(monkeypatch, tmp_path):
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 10, 13, 17, 40, tzinfo=tz)

    monkeypatch.setattr(scheduler, "datetime", Clock)
    calls = []
    assert scheduler.run_pipeline("market", start=date(2021, 1, 1), symbols=None,
        output=tmp_path, daily_only=True, run=lambda command: calls.append(command) or 0) == 0
    assert calls == [
        ["market-backfill", "--benchmark-only", "--incremental", "--start", "2026-10-06"],
        ["market-fetch", "--from-stock-info", "--daily-only", "--start", "2026-10-06", "--out", str(tmp_path)],
        ["market-import", "--input-dir", str(tmp_path)],
        ["paper-reconcile", "--execute"],
    ]


@pytest.mark.parametrize("symbols", [None, "2330,2317"])
@pytest.mark.parametrize("today,revenue_start", [
    ("2026-01-10", "2025-11-01"), ("2026-10-10", "2026-08-01"),
])
def test_supplemental_jobs_refresh_recent_revenue_and_a_full_year_of_metrics(
        monkeypatch, tmp_path, symbols, today, revenue_start):
    fixed = date.fromisoformat(today)

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return cls.combine(fixed, time(17), tz)

    monkeypatch.setattr(scheduler, "datetime", Clock)
    calls = []
    scheduler.run_pipeline("market", start=date(2021, 1, 1), symbols=symbols,
                           output=tmp_path, run=lambda command: calls.append(command) or 0)
    selected = ["--stocks", symbols] if symbols else []
    assert calls[3:5] == [
        ["market-supplemental-backfill", *selected, "--start", revenue_start, "--end", today,
         "--datasets", "monthly_revenue", "--out", str(tmp_path / "revenue_report.json")],
        ["market-supplemental-backfill", *selected, "--start", (fixed - timedelta(days=400)).isoformat(),
         "--end", today, "--datasets", "financial_metrics", "--out", str(tmp_path / "financial_metrics_report.json")],
    ]
    assert calls[-1] == ["paper-reconcile", "--execute"]


def test_child_command_uses_current_python_v2_module_and_propagates_exit(monkeypatch):
    invocations = []

    class Child:
        def wait(self):
            return 7
        def terminate(self):
            raise AssertionError("Completed child must not be terminated")

    def spawn(command, **kwargs):
        invocations.append((command, kwargs))
        return Child()
    monkeypatch.setattr(scheduler.subprocess, "Popen", spawn)
    assert scheduler.run_worker(["news-ingest", "--symbols", "2330"]) == 7
    assert invocations == [([scheduler.sys.executable, "-m", "app.jobs", "news-ingest", "--symbols", "2330"],
                            {"cwd": scheduler.ROOT})]
    assert scheduler.ROOT == Path(__file__).resolve().parents[1]


@pytest.mark.parametrize("kill_required", [False, True])
def test_stop_terminates_only_owned_child_and_reaps_it(monkeypatch, kill_required):
    operations = []

    class Child:
        def wait(self, timeout=None):
            operations.append(("wait", timeout))
            if len(operations) == 1:
                raise KeyboardInterrupt
            if timeout is not None and kill_required:
                raise subprocess.TimeoutExpired("owned child", timeout)
            return -9 if kill_required else -15
        def terminate(self):
            operations.append(("terminate", None))
        def kill(self):
            operations.append(("kill", None))

    monkeypatch.setattr(scheduler.subprocess, "Popen", lambda *args, **kwargs: Child())
    with pytest.raises(KeyboardInterrupt):
        scheduler.run_worker(["crawl-cnyes", "--scheduled-once"])
    assert operations[:3] == [("wait", None), ("terminate", None), ("wait", 10)]
    assert operations[3:] == ([("kill", None), ("wait", None)] if kill_required else [])


def _fake_lock(monkeypatch, operations):
    @contextmanager
    def locked(name):
        operations.append(("lock", name))
        try:
            yield
        finally:
            operations.append(("unlock", name))
    monkeypatch.setattr(locking, "worker_lock", locked)


def test_one_shot_cli_has_stop_handlers_and_restores_them(monkeypatch, tmp_path):
    operations, active = [], {}
    _fake_lock(monkeypatch, operations)

    def signal_handler(sig, handler):
        old = active.get(sig, f"previous-{sig}")
        active[sig] = handler
        operations.append(("signal", sig))
        return old

    def run(job, **kwargs):
        assert callable(active.get(scheduler.signal.SIGINT))
        assert callable(active.get(scheduler.signal.SIGTERM))
        assert job == "rag" and kwargs == {"start": date(2026, 7, 1), "symbols": "2330,2317", "output": tmp_path,
            "impact_execute": True, "impact_limit": 100, "impact_max_cost_usd": 0.5, "impact_since": None}
        operations.append(("run", job))
        return 9

    monkeypatch.setattr(scheduler.signal, "signal", signal_handler)
    monkeypatch.setattr(scheduler, "run_pipeline", run)
    assert scheduler.main(["--job", "rag", "--start", "2026-07-01", "--symbols", " 2330,2317,2330 ", "--out", str(tmp_path)]) == 9
    assert active == {sig: f"previous-{sig}" for sig in (scheduler.signal.SIGINT, scheduler.signal.SIGTERM)}
    assert operations[0] == ("lock", "scheduler") and operations[-1] == ("unlock", "scheduler")


@pytest.mark.parametrize("job", ["rag", "impact"])
@pytest.mark.parametrize("flags,execute", [([], True), (["--impact-execute"], True),
                                         (["--no-impact-execute"], False)])
def test_cli_impact_defaults_opt_out_and_compatible_flag(job, flags, execute, monkeypatch):
    commands = []
    _fake_lock(monkeypatch, [])
    monkeypatch.setattr(scheduler, "run_worker", lambda command: commands.append(command) or 0)
    assert scheduler.main(["--job", job, "--symbols", "2330", "--impact-limit", "25",
                           "--impact-max-cost-usd", "0.2", *flags]) == 0
    impact = [command for command in commands if command[0] == "news-impact-batch"]
    assert impact == ([["news-impact-batch", "--limit", "25", "--max-cost-usd", "0.2",
                         *(["--execute"] if execute else [])]]
                      if job == "impact" else [])


@pytest.mark.parametrize("args", [[], ["--run-now"], ["--job", "pipeline"], ["--job", "all"], ["--job", "ltn"]])
def test_retired_cli_paths_cannot_dispatch(args, monkeypatch):
    monkeypatch.setattr(scheduler, "run_pipeline", lambda *a, **k: pytest.fail("Unexpected dispatch"))
    with pytest.raises(SystemExit) as error:
        scheduler.main(args)
    assert error.value.code == 2


@pytest.mark.parametrize("args", [
    ["--symbols", ","], ["--market-time", "17:00+01:00"],
    ["--impact-limit", "0"], ["--impact-max-cost-usd", "-1"],
    ["--impact-max-cost-usd", "nan"], ["--impact-max-cost-usd", "inf"],
])
def test_cli_rejects_invalid_scheduling_arguments_before_lock(args, monkeypatch):
    def fail(name):
        raise AssertionError("Invalid arguments must not acquire a worker lock")
    monkeypatch.setattr(locking, "worker_lock", fail)
    with pytest.raises(SystemExit) as result:
        scheduler.main(args)
    assert result.value.code == 2


def test_scheduler_is_an_explicit_worker_without_asgi_dependencies():
    tree = ast.parse(inspect.getsource(scheduler))
    imports = [name for node in ast.walk(tree)
        for name in ([node.module or ""] if isinstance(node, ast.ImportFrom)
                     else [alias.name for alias in node.names] if isinstance(node, ast.Import) else [])]
    assert not any(name.startswith(("fastapi", "starlette", "app.main", "backend", "rag", "schedule.")) for name in imports)
    assert "subprocess" in imports


@pytest.mark.parametrize("args", [
    ["--job", "sentiment"], ["--sentiment-execute"], ["--no-sentiment-execute"],
    ["--sentiment-limit", "25"], ["--sentiment-max-cost-usd", "0.2"],
    ["--backfill"], ["--interval-minutes", "30"], ["--rag-delay-minutes", "10"],
])
def test_removed_sentiment_options_fail_before_any_worker(args, monkeypatch):
    monkeypatch.setattr(scheduler, "run_worker", lambda *_: pytest.fail("No worker may run"))
    with pytest.raises(SystemExit) as result:
        scheduler.main(args)
    assert result.value.code == 2


def test_fixed_impact_start_reaches_worker_and_sync_without_changing_default(monkeypatch):
    commands = []
    _fake_lock(monkeypatch, [])
    monkeypatch.setattr(scheduler, "run_worker", lambda command: commands.append(command) or 0)
    assert scheduler.main(["--job", "impact", "--impact-since", "2026-01-01"]) == 0
    batch = next(command for command in commands if command[0] == "news-impact-batch")
    assert batch[batch.index("--since") + 1] == "2026-01-01"
    sync = next(command for command in commands if command[0] == "news-impact-sync")
    assert int(sync[sync.index("--backfill-days") + 1]) == max(1, (datetime.now(scheduler.TAIPEI).date() - date(2026, 1, 1)).days + 1)


def test_paused_pipeline_does_not_run():
    calls = []
    now = datetime(2026, 7, 13, 8, tzinfo=scheduler.TAIPEI)
    worker = scheduler.Scheduler(lambda job: calls.append(job) or 0, now,
        enabled=lambda job: False)
    worker.tick(now + timedelta(days=1))
    assert calls == []
