from datetime import date
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.core.errors import AppError
from app.db.models.admin import AdminJobRun
from app.db.models.stock_info import StockInfo
from app.jobs import stock_backfill
from app.jobs.runtime import JobRuntime


def test_backfill_uses_official_snapshots_and_selected_stock_history(tmp_path):
    calls = []

    def run(job, args):
        calls.append((job, args))
        if job == "market-fetch":
            directory = Path(args[args.index("--out") + 1])
            assert directory.is_dir()
        return 0

    assert stock_backfill.backfill("1101", end=date(2026, 10, 4), output=tmp_path, run=run) == 0
    fetch, importer, history = calls
    assert fetch[1][:6] == ["--stock", "1101", "--start", "2024-10-04", "--end", "2026-10-04"]
    assert importer[1] == ["--input-dir", fetch[1][7], "--symbols", "1101"]
    assert [call[0] for call in calls] == ["market-fetch", "market-import", "market-backfill"]
    assert history[1] == ["--stocks", "1101", "--start", "2024-10-04", "--end", "2026-10-04",
                          "--include-institutional", "--skip-benchmark", "--out", str(tmp_path / "1101_history.json")]
    assert not Path(fetch[1][7]).exists()


@pytest.mark.parametrize("failed_job", ["market-fetch", "market-import", "market-backfill"])
def test_backfill_stops_after_failed_official_stage(tmp_path, failed_job):
    calls = []

    def run(job, args):
        calls.append(job)
        return 7 if job == failed_job else 0

    assert stock_backfill.backfill("1101", end=date(2026, 10, 4), output=tmp_path, run=run) == 7
    stages = ["market-fetch", "market-import", "market-backfill"]
    assert calls == stages[:stages.index(failed_job) + 1]
    assert list(tmp_path.iterdir()) == []


def test_backfill_requires_supported_symbol_and_preserves_retry(db_session, settings, monkeypatch):
    runtime = JobRuntime(settings, lambda: db_session)
    runtime.status = "running"
    actor = SimpleNamespace(id=None)
    for action, symbol in [("run", None), ("run", "9999"), ("pause", None)]:
        with pytest.raises(AppError):
            runtime.perform(db_session, actor, "stock-backfill", action, symbol=symbol)
    db_session.add(StockInfo(symbol="1101", name="Taiwan Cement"))
    db_session.commit()
    run = runtime.perform(db_session, actor, "stock-backfill", "run", symbol="1101")
    db_session.commit()
    run_id = run.id
    with pytest.raises(AppError):
        runtime.perform(db_session, actor, "stock-backfill", "run", symbol="1101")
    commands = []
    monkeypatch.setattr(runtime, "_worker", lambda command: commands.append(command) or 0)
    assert runtime._execute(run_id) == 0
    assert commands == [["stock-backfill", "--symbol", "1101"]]
    retry = runtime.perform(db_session, actor, "stock-backfill", "retry", run_id=run_id)
    assert retry.symbol == "1101" and retry.retry_of == run_id
    assert db_session.get(AdminJobRun, run_id).status == "succeeded"


def test_cli_rejects_unsupported_symbol_without_running_workers(monkeypatch):
    monkeypatch.setattr(stock_backfill, "stock_info_symbols", lambda: [])
    with pytest.raises(ValueError, match="not enabled"):
        stock_backfill.main(["--symbol", "1101"])
    assert stock_backfill.history_start(date(2024, 2, 29)) == date(2022, 2, 28)
