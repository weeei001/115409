from datetime import date
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.core.errors import AppError
from app.db.models.admin import AdminJobRun
from app.db.models.stock_info import StockInfo
from app.jobs import stock_backfill
from app.jobs.runtime import JobRuntime


def test_backfill_uses_fresh_selected_stock_exports_and_stops_on_fetch_failure(tmp_path):
    calls = []

    def run(job, args):
        calls.append((job, args))
        if job == "finmind-fetch":
            directory = Path(args[args.index("--out") + 1])
            for dataset in ("price_volume", "institutional"):
                (directory / f"1101_{dataset}.csv").write_text("date,symbol\n2026-10-02,1101\n")
        return 0

    assert stock_backfill.backfill("1101", end=date(2026, 10, 4), output=tmp_path, run=run) == 0
    fetch, importer = calls
    assert fetch[1][:6] == ["--stock", "1101", "--start", "2024-10-04", "--end", "2026-10-04"]
    assert importer[1] == ["--input-dir", fetch[1][7], "--symbols", "1101"]
    assert not Path(fetch[1][7]).exists()
    calls.clear()
    assert stock_backfill.backfill("1101", end=date(2026, 10, 4), output=tmp_path,
        run=lambda job, args: calls.append(job) or 7) == 7
    assert calls == ["finmind-fetch"]


@pytest.mark.parametrize("empty", ["price_volume", "institutional"])
def test_backfill_rejects_empty_required_history(tmp_path, empty):
    calls = []

    def run(job, args):
        calls.append(job)
        directory = Path(args[args.index("--out") + 1])
        for dataset in ("price_volume", "institutional"):
            (directory / f"1101_{dataset}.csv").write_text(
                "date,symbol\n" + ("2026-10-02,1101\n" if dataset != empty else ""))
        return 0

    with pytest.raises(ValueError, match="No .* history"):
        stock_backfill.backfill("1101", end=date(2026, 10, 4), output=tmp_path, run=run)
    assert calls == ["finmind-fetch"]


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
    monkeypatch.setattr(stock_backfill, "stock_info_symbols", lambda settings: [])
    with pytest.raises(ValueError, match="not enabled"):
        stock_backfill.main(["--symbol", "1101"])
    assert stock_backfill.history_start(date(2024, 2, 29)) == date(2022, 2, 28)
