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
