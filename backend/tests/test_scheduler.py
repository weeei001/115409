import ast
from contextlib import contextmanager
from datetime import date, datetime, time, timedelta, timezone
import inspect
from pathlib import Path
import subprocess

import pytest

from app.jobs import locking, scheduler


def test_pipeline_uses_native_jobs_in_dependency_order(tmp_path):
    commands = []
    assert scheduler.run_pipeline("all", start=date(2026, 7, 1), symbols="2330,2317", output=tmp_path,
        run=lambda command: commands.append(command) or 0) == 0
    assert [command[0] for command in commands] == [
        "market-fetch", "market-import", "market-backfill", "crawl-cnyes", "crawl-ltn", "migrate-news-impact-schema",
        "news-ingest", "news-impact-batch", "news-impact-sync", "cache-warmup"]
    assert commands[0] == ["market-fetch", "--stocks", "2330,2317", "--start", "2026-07-01", "--out", str(tmp_path)]
    assert commands[1] == ["market-import", "--input-dir", str(tmp_path)]
    assert commands[2] == ["market-backfill", "--benchmark-only", "--incremental", "--start", "2026-07-01"]
    assert commands[3] == ["crawl-cnyes", "--scheduled-once"]
    assert commands[4] == ["crawl-ltn", "--scheduled-once", "--lookback-days", "30"]
    assert commands[-1] == ["cache-warmup", "--symbols", "2330,2317"]
    assert commands[-3] == ["news-impact-batch", "--limit", "100",
                            "--max-cost-usd", "0.5", "--execute"]
    assert commands[-2] == ["news-impact-sync", "--execute"]


def test_text_brief_without_symbols_lets_warmup_read_stock_info(tmp_path):
    commands = []
    assert scheduler.run_pipeline("text-brief", start=date(2026, 7, 1), symbols=None, output=tmp_path,
        run=lambda command: commands.append(command) or 0) == 0
    assert commands == [["cache-warmup"]]


def test_backfill_runs_before_market_import_and_ai(tmp_path):
    commands = []
    assert scheduler.run_pipeline("all", start=date(2026, 7, 1), symbols=None, output=tmp_path,
        backfill=True, run=lambda command: commands.append(command) or 0) == 0
    assert [command[0] for command in commands[:4]] == [
        "market-fetch", "market-import", "market-fetch", "market-import"]
    assert commands[0] == ["market-fetch", "--from-stock-info", "--start", "2026-07-01",
                            "--out", str(tmp_path / "backfill")]
    assert commands[-1] == ["cache-warmup"]


def test_incremental_sentiment_execution_and_preview_carry_budget(tmp_path):
    for execute in (False, True):
        commands = []
        assert scheduler.run_pipeline("sentiment", start=date(2026, 7, 1), symbols="2330", output=tmp_path,
            sentiment_execute=execute, sentiment_limit=25, sentiment_max_cost_usd=0.2,
            run=lambda command: commands.append(command) or 0) == 0
        assert commands == [["sentiment-batch", "--incremental", "--limit", "25",
                             "--max-cost-usd", "0.2", *(["--execute"] if execute else [])]]
    commands = []
    scheduler.run_pipeline("rag", start=date(2026, 7, 1), symbols="2330", output=tmp_path,
        run=lambda command: commands.append(command) or 0)
    assert [command[0] for command in commands] == ["migrate-news-impact-schema", "news-ingest",
                                                   "news-impact-batch", "news-impact-sync", "cache-warmup"]


@pytest.mark.parametrize("failures,expected,commands", [
    ({"news-ingest": 7}, 7, ["migrate-news-impact-schema", "news-ingest"]),
    ({"cache-warmup": 7}, 7, ["migrate-news-impact-schema", "news-ingest", "news-impact-batch", "news-impact-sync", "cache-warmup"]),
    ({"news-impact-batch": 9}, 9, ["migrate-news-impact-schema", "news-ingest", "news-impact-batch", "news-impact-sync", "cache-warmup"]),
    ({"cache-warmup": 7, "news-impact-batch": 9}, 9, ["migrate-news-impact-schema", "news-ingest", "news-impact-batch", "news-impact-sync", "cache-warmup"]),
])
def test_warmup_and_sentiment_run_independently_after_ingestion(failures, expected, commands, tmp_path):
    called = []
    def run(command):
        called.append(command[0])
        return failures.get(command[0], 0)
    assert scheduler.run_pipeline("rag", start=date(2026, 7, 1), symbols="2330", output=tmp_path,
        run=run) == expected
    assert called == commands


@pytest.mark.parametrize("failure", ["market-fetch", "market-import", "crawl-cnyes", "crawl-ltn", "migrate-news-impact-schema", "news-ingest"])
def test_pipeline_stops_on_failure_before_warming_stale_cache(failure, tmp_path):
    commands = []

    def run(command):
        commands.append(command[0])
        return 7 if command[0] == failure else 0

    assert scheduler.run_pipeline("all", start=date(2026, 7, 1), symbols="2330", output=tmp_path, run=run) == 7
    assert commands[-1] == failure and "cache-warmup" not in commands


@pytest.mark.parametrize("now, at, expected", [
    ("2026-07-13T16:59:59+08:00", time(17), "2026-07-13T17:00:00+08:00"),
    ("2026-07-13T17:00:00+08:00", time(17), "2026-07-14T17:00:00+08:00"),
    ("2026-07-13T23:00:00+00:00", time(6), "2026-07-15T06:00:00+08:00"),
])
def test_daily_deadline_is_future_taipei_time(now, at, expected):
    assert scheduler.next_daily(datetime.fromisoformat(now), at) == datetime.fromisoformat(expected)


def test_daily_and_news_jobs_coalesce_one_followup(monkeypatch):
    calls = []
    elapsed = [0]
    monkeypatch.setattr(scheduler.clock, "monotonic", lambda: elapsed[0])
    start = datetime(2026, 7, 13, 16, tzinfo=scheduler.TAIPEI)
    worker = scheduler.Scheduler(lambda job: calls.append(job) or 0, start, 0, interval=1800, delay=600)

    def tick(seconds):
        elapsed[0] = seconds
        worker.tick(start + timedelta(seconds=seconds), seconds)

    tick(1800)
    assert calls == ["cnyes", "ltn"] and worker.followup == 2400
    tick(2399)
    assert calls == ["cnyes", "ltn"]
    tick(2400)
    assert calls == ["cnyes", "ltn", "rag"] and worker.followup is None
    tick(3600)
    assert calls[-3:] == ["market", "cnyes", "ltn"] and worker.followup == 4200
    assert worker.next_market == datetime(2026, 7, 14, 17, tzinfo=scheduler.TAIPEI)
    tick(4200)
    assert calls.count("rag") == 2 and calls.count("market") == 1


@pytest.mark.parametrize("successful", [None, "ltn"])
def test_failed_crawl_does_not_arm_followup(successful, monkeypatch):
    calls = []
    elapsed = [0]
    monkeypatch.setattr(scheduler.clock, "monotonic", lambda: elapsed[0])
    now = datetime(2026, 7, 13, 8, tzinfo=scheduler.TAIPEI)

    def run(job):
        calls.append(job)
        return 0 if job == successful or job == "rag" else 1

    worker = scheduler.Scheduler(run, now, 0, interval=1800, delay=600)
    elapsed[0] = 1800
    worker.tick(now + timedelta(minutes=30), 1800)
    assert worker.followup == (2400 if successful else None)
    elapsed[0] = 2400
    worker.tick(now + timedelta(minutes=40), 2400)
    assert ("rag" in calls) is bool(successful)


def test_followup_delay_starts_after_successful_crawl_finishes(monkeypatch):
    elapsed = [10]
    monkeypatch.setattr(scheduler.clock, "monotonic", lambda: elapsed[0])
    now = datetime(2026, 7, 13, 8, tzinfo=scheduler.TAIPEI)

    def run(job):
        elapsed[0] += 120 if job == "cnyes" else 240
        return 0

    worker = scheduler.Scheduler(run, now, 0, interval=10, delay=600)
    worker.tick(now + timedelta(seconds=10), 10)
    assert worker.followup == 730


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
            "backfill": False, "sentiment_execute": True, "sentiment_limit": 100, "sentiment_max_cost_usd": 0.5}
        operations.append(("run", job))
        return 9

    monkeypatch.setattr(scheduler.signal, "signal", signal_handler)
    monkeypatch.setattr(scheduler, "run_pipeline", run)
    assert scheduler.main(["--job", "rag", "--start", "2026-07-01", "--symbols", " 2330,2317,2330 ", "--out", str(tmp_path)]) == 9
    assert active == {sig: f"previous-{sig}" for sig in (scheduler.signal.SIGINT, scheduler.signal.SIGTERM)}
    assert operations[0] == ("lock", "scheduler") and operations[-1] == ("unlock", "scheduler")


@pytest.mark.parametrize("job", ["rag", "all", "sentiment"])
@pytest.mark.parametrize("flags,execute", [([], True), (["--sentiment-execute"], True),
                                         (["--no-sentiment-execute"], False)])
def test_cli_sentiment_defaults_opt_out_and_compatible_flag(job, flags, execute, monkeypatch):
    commands = []
    _fake_lock(monkeypatch, [])
    monkeypatch.setattr(scheduler, "run_worker", lambda command: commands.append(command) or 0)
    assert scheduler.main(["--job", job, "--symbols", "2330", "--sentiment-limit", "25",
                           "--sentiment-max-cost-usd", "0.2", *flags]) == 0
    sentiment = [command for command in commands if command[0] == "sentiment-batch"]
    assert sentiment == ([["sentiment-batch", "--incremental", "--limit", "25",
                           "--max-cost-usd", "0.2", *(["--execute"] if execute else [])]]
                         if job == "sentiment" else [])
    impact = [command for command in commands if command[0] == "news-impact-batch"]
    assert impact == ([["news-impact-batch", "--limit", "25", "--max-cost-usd", "0.2", "--execute"]]
                      if job in {"rag", "all"} and execute else [])


@pytest.mark.parametrize("flags,execute", [([], True), (["--no-sentiment-execute"], False)])
def test_regular_scheduler_followup_honors_sentiment_setting(flags, execute, monkeypatch):
    commands = []
    elapsed = [0]
    _fake_lock(monkeypatch, [])
    monkeypatch.setattr(scheduler.clock, "monotonic", lambda: elapsed[0])
    monkeypatch.setattr(scheduler, "run_worker", lambda command: commands.append(command) or 0)

    def advance(seconds):
        if elapsed[0] >= 2400:
            raise KeyboardInterrupt
        elapsed[0] += 600

    monkeypatch.setattr(scheduler.clock, "sleep", advance)
    assert scheduler.main(flags) == 0
    assert [command[0] for command in commands] == [
        "crawl-cnyes", "crawl-ltn", "migrate-news-impact-schema", "news-ingest",
        *(["news-impact-batch", "news-impact-sync"] if execute else []), "cache-warmup"]
    if execute:
        assert "--execute" in next(command for command in commands if command[0] == "news-impact-batch")


def test_run_now_has_stop_handlers_and_cleanly_stops_scheduler(monkeypatch):
    operations, active = [], {}
    _fake_lock(monkeypatch, operations)

    def signal_handler(sig, handler):
        previous = active.get(sig, f"previous-{sig}")
        active[sig] = handler
        return previous

    def run(job, **kwargs):
        assert callable(active.get(scheduler.signal.SIGTERM))
        operations.append(("run", job))
        return 0

    class Scheduled:
        def __init__(self, run, now, monotonic, **kwargs):
            assert now.utcoffset() == timedelta(hours=8)
            assert kwargs["interval"] == 120 and kwargs["delay"] == 30
        def tick(self, now, monotonic):
            operations.append(("tick", None))
            active[scheduler.signal.SIGTERM](scheduler.signal.SIGTERM, None)

    monkeypatch.setattr(scheduler.signal, "signal", signal_handler)
    monkeypatch.setattr(scheduler, "run_pipeline", run)
    monkeypatch.setattr(scheduler, "Scheduler", Scheduled)
    assert scheduler.main(["--run-now", "--interval-minutes", "2", "--rag-delay-minutes", "0.5"]) == 0
    assert ("run", "market") in operations and ("tick", None) in operations
    assert active == {sig: f"previous-{sig}" for sig in (scheduler.signal.SIGINT, scheduler.signal.SIGTERM)}
    assert operations[-1] == ("unlock", "scheduler")


@pytest.mark.parametrize("args", [
    ["--interval-minutes", "0"], ["--interval-minutes", "nan"], ["--interval-minutes", "inf"],
    ["--rag-delay-minutes", "-1"], ["--rag-delay-minutes", "nan"], ["--rag-delay-minutes", "inf"],
    ["--symbols", ","], ["--finmind-time", "17:00+01:00"],
    ["--sentiment-limit", "0"], ["--sentiment-max-cost-usd", "-1"],
    ["--sentiment-max-cost-usd", "nan"], ["--sentiment-max-cost-usd", "inf"],
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
