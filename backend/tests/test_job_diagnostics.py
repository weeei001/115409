"""Public failure records only accept bounded, known diagnostic values."""
import json

import pytest

from app.features.admin.diagnostics import failure_stages, format_failure, safe_error
from app.jobs.diagnostics import DIAGNOSTICS_ENV, read_failure, report_failure


@pytest.mark.parametrize("detail", [
    {"phase": "private-token", "reason": "worker_exception"},
    {"phase": "analysis", "reason": "private-token"},
    {"phase": "analysis", "reason": "worker_exception", "error_type": "SecretToken"},
    {"phase": "analysis", "reason": "worker_exception", "failure_reasons": {"timeout": -1}},
    {"phase": "analysis", "reason": "worker_exception", "token": "private-token"},
])
def test_retained_untrusted_diagnostics_are_not_published(detail):
    raw = "news-impact-batch exited with code 1 " + json.dumps(detail)
    assert failure_stages(raw) == []
    assert "private" not in safe_error(raw)


def test_bounded_record_and_unwritable_diagnostic_cannot_mask_worker_failure(tmp_path, monkeypatch):
    target = tmp_path / "failure.json"
    target.write_text("x" * 4097)
    assert read_failure(target) == {}
    target.write_text("{")
    assert read_failure(target) == {}
    monkeypatch.setenv(DIAGNOSTICS_ENV, str(tmp_path / "missing" / "failure.json"))
    detail = report_failure("settings", error=ValueError("private-token"))
    assert detail == {"phase": "settings", "reason": "worker_exception", "error_type": "ValueError"}
    assert failure_stages(format_failure("news-impact-batch", 1, detail)) == [
        {"stage": "news-impact-batch", "exit_code": 1, **detail}]


@pytest.mark.parametrize("stage", ["market-fetch", "market-backfill"])
def test_stock_backfill_preserves_safe_nested_worker_diagnostics(stage, tmp_path, monkeypatch):
    from contextlib import nullcontext
    from app.jobs import stock_backfill, market_history
    from app.jobs.__main__ import dispatch
    from app.jobs.market import fetch

    target = tmp_path / "failure.json"
    monkeypatch.setenv(DIAGNOSTICS_ENV, str(target))

    def fail(*args):
        raise ValueError("private connection credentials")

    monkeypatch.setattr(fetch, "get_settings", lambda: None)
    monkeypatch.setattr(fetch, "make_sync_http_client", lambda *args, **kwargs: nullcontext(None))
    monkeypatch.setattr(fetch, "export", fail)
    monkeypatch.setattr(market_history, "backfill", fail)

    def run(job, args):
        return dispatch(job, args) if job == stage else 0

    from datetime import date
    assert stock_backfill.backfill("1101", end=date(2026, 10, 12), output=tmp_path / "market", run=run) == 1
    assert read_failure(target) == {
        "phase": "dispatch", "reason": "worker_exception", "error_type": "ValueError"}
    assert "private" not in target.read_text()
