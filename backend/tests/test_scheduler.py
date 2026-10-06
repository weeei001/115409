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
        "market-backfill", "market-fetch", "market-import", "paper-reconcile", "crawl-cnyes", "crawl-ltn", "migrate-news-impact-schema",
        "news-ingest", "news-impact-batch", "news-impact-sync", "cache-warmup"]
    assert commands[1] == ["market-fetch", "--stocks", "2330,2317", "--start", "2026-07-01", "--out", str(tmp_path)]
    assert commands[2] == ["market-import", "--input-dir", str(tmp_path)]
    assert commands[0] == ["market-backfill", "--benchmark-only", "--incremental", "--start", "2026-07-01"]
    assert commands[3] == ["paper-reconcile", "--execute"]
    assert commands[4] == ["crawl-cnyes", "--scheduled-once"]
    assert commands[5] == ["crawl-ltn", "--scheduled-once", "--lookback-days", "30"]
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
    assert [command[0] for command in commands[:5]] == [
        "market-backfill", "market-fetch", "market-import", "market-fetch", "market-import"]
    assert commands[1] == ["market-fetch", "--from-stock-info", "--start", "2026-07-01",
                            "--out", str(tmp_path / "backfill")]
    assert commands[-1] == ["cache-warmup"]


@pytest.mark.parametrize("failures,expected,commands", [
    ({}, 0, ["migrate-news-impact-schema", "news-ingest", "news-impact-batch", "news-impact-sync"]),
    ({"news-ingest": 7}, 7, ["migrate-news-impact-schema", "news-ingest"]),
    ({"news-ingest": 7, "news-impact-batch": 9}, 7, ["migrate-news-impact-schema", "news-ingest"]),
    ({"news-impact-sync": 8}, 8, ["migrate-news-impact-schema", "news-ingest", "news-impact-batch", "news-impact-sync"]),
    ({"news-impact-batch": 9}, 9, ["migrate-news-impact-schema", "news-ingest", "news-impact-batch", "news-impact-sync"]),
])
def test_news_index_reports_its_own_result_without_warming_briefs(failures, expected, commands, tmp_path):
    called = []
    def run(command):
        called.append(command[0])
        return failures.get(command[0], 0)
    assert scheduler.run_pipeline("rag", start=date(2026, 7, 1), symbols="2330", output=tmp_path,
        run=run) == expected
    assert called == commands


@pytest.mark.parametrize("failure", ["market-backfill", "market-fetch", "market-import", "paper-reconcile", "migrate-news-impact-schema", "news-ingest", "news-impact-sync"])
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


def test_daily_pipeline_runs_once_without_independent_followups():
    calls = []
    start = datetime(2026, 7, 13, 16, tzinfo=scheduler.TAIPEI)
    worker = scheduler.Scheduler(lambda job: calls.append(job) or 0, start, 0)
    worker.tick(start + timedelta(minutes=30), 1800)
    assert calls == []
    worker.tick(start + timedelta(hours=1), 3600)
    worker.tick(start + timedelta(hours=2), 7200)
    assert calls == ["pipeline"]
    assert worker.next_market == datetime(2026, 7, 14, 17, tzinfo=scheduler.TAIPEI)


@pytest.mark.parametrize("failure", ["crawl-cnyes", "crawl-ltn", "news-impact-batch"])
def test_partial_failures_finish_pipeline_but_preserve_failure(failure, tmp_path):
    calls = []
    def run(command):
        calls.append(command[0])
        return 7 if command[0] == failure else 0
    assert scheduler.run_pipeline("pipeline", start=date(2026, 7, 1), symbols=None,
        output=tmp_path, run=run) == 7
    assert calls[-1] == "cache-warmup"
    assert "news-impact-sync" in calls


def test_pipeline_skips_disabled_news_source_but_manual_source_can_run(tmp_path):
    calls = []
    for job in ["pipeline", "ltn"]:
        assert scheduler.run_pipeline(job, start=date(2026, 7, 1), symbols=None,
            output=tmp_path, source_enabled=lambda name: name != "ltn",
            run=lambda command: calls.append(command[0]) or 0) == 0
        if job == "pipeline":
            assert "crawl-ltn" not in calls and "crawl-cnyes" in calls
    assert calls[-1] == "crawl-ltn"


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
            "backfill": False, "impact_execute": True, "impact_limit": 100, "impact_max_cost_usd": 0.5, "impact_since": None}
        operations.append(("run", job))
        return 9

    monkeypatch.setattr(scheduler.signal, "signal", signal_handler)
    monkeypatch.setattr(scheduler, "run_pipeline", run)
    assert scheduler.main(["--job", "rag", "--start", "2026-07-01", "--symbols", " 2330,2317,2330 ", "--out", str(tmp_path)]) == 9
    assert active == {sig: f"previous-{sig}" for sig in (scheduler.signal.SIGINT, scheduler.signal.SIGTERM)}
    assert operations[0] == ("lock", "scheduler") and operations[-1] == ("unlock", "scheduler")


@pytest.mark.parametrize("job", ["rag", "all", "impact"])
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
                      if job == "impact" or execute else [])


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
    assert ("run", "pipeline") in operations and ("tick", None) in operations
    assert active == {sig: f"previous-{sig}" for sig in (scheduler.signal.SIGINT, scheduler.signal.SIGTERM)}
    assert operations[-1] == ("unlock", "scheduler")


@pytest.mark.parametrize("failure", ["crawl-cnyes", "crawl-ltn", "news-impact-batch", "market-fetch"])
@pytest.mark.parametrize("mode", ["--run-now", "--job"])
def test_failed_startup_keeps_scheduling_and_one_shot_preserves_failure_exit(
        failure, mode, monkeypatch, tmp_path, capsys):
    operations, active, commands = [], {}, []
    _fake_lock(monkeypatch, operations)

    def signal_handler(sig, handler):
        previous = active.get(sig, f"previous-{sig}")
        active[sig] = handler
        return previous

    def run_worker(command):
        assert callable(active.get(scheduler.signal.SIGINT))
        assert callable(active.get(scheduler.signal.SIGTERM))
        commands.append(command[0])
        return 7 if command[0] == failure else 0

    class Scheduled:
        def __init__(self, *args, **kwargs):
            pass
        def tick(self, now, monotonic):
            operations.append(("tick", None))
            active[scheduler.signal.SIGTERM](scheduler.signal.SIGTERM, None)

    monkeypatch.setattr(scheduler.signal, "signal", signal_handler)
    monkeypatch.setattr(scheduler, "run_worker", run_worker)
    monkeypatch.setattr(scheduler, "Scheduler", Scheduled)
    args = [mode, *(["pipeline"] if mode == "--job" else []), "--symbols", "2330", "--out", str(tmp_path)]
    result = scheduler.main(args)
    if mode == "--run-now":
        assert result == 0
        assert ("tick", None) in operations
        assert "job=pipeline exit_code=7 scheduler=continue" in capsys.readouterr().out
    else:
        assert result == 7
        assert ("tick", None) not in operations
    assert failure in commands
    if failure == "market-fetch":
        assert commands[-1] == failure and "cache-warmup" not in commands
    else:
        assert commands[-1] == "cache-warmup"
    assert active == {sig: f"previous-{sig}" for sig in (scheduler.signal.SIGINT, scheduler.signal.SIGTERM)}
    assert operations[-1] == ("unlock", "scheduler")


@pytest.mark.parametrize("args", [
    ["--interval-minutes", "0"], ["--interval-minutes", "nan"], ["--interval-minutes", "inf"],
    ["--rag-delay-minutes", "-1"], ["--rag-delay-minutes", "nan"], ["--rag-delay-minutes", "inf"],
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
    assert scheduler.main(["--job", "rag", "--impact-since", "2026-01-01"]) == 0
    batch = next(command for command in commands if command[0] == "news-impact-batch")
    assert batch[batch.index("--since") + 1] == "2026-01-01"
    sync = next(command for command in commands if command[0] == "news-impact-sync")
    assert int(sync[sync.index("--backfill-days") + 1]) == max(1, (datetime.now(scheduler.TAIPEI).date() - date(2026, 1, 1)).days + 1)


def test_paused_pipeline_does_not_run():
    calls = []
    now = datetime(2026, 7, 13, 8, tzinfo=scheduler.TAIPEI)
    worker = scheduler.Scheduler(lambda job: calls.append(job) or 0, now, 0,
        enabled=lambda job: False)
    worker.tick(now + timedelta(days=1), 86400)
    assert calls == []
