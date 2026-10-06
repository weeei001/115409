"""Small allowlisted failure records for the parent scheduler; no exception text."""
import json
import logging
import os
from pathlib import Path

from app.features.admin.diagnostics import ERROR_TYPES, safe_worker_diagnostic


DIAGNOSTICS_ENV = "APP_JOB_DIAGNOSTICS_PATH"
logger = logging.getLogger(__name__)


def failure_record(phase, *, reason="worker_exception", error=None, failure_reasons=None):
    name = type(error).__name__ if error is not None else None
    return safe_worker_diagnostic({"phase": phase, "reason": reason,
        "error_type": name if name in ERROR_TYPES else "Exception" if error is not None else None,
        "failure_reasons": failure_reasons})


def report_failure(phase, **kwargs):
    record = failure_record(phase, **kwargs)
    target = os.environ.get(DIAGNOSTICS_ENV)
    if target:
        try:
            Path(target).write_text(json.dumps(record), encoding="utf-8")
        except OSError:
            # A diagnostic write must never replace the original worker result.
            logger.warning("Worker diagnostic could not be recorded")
    return record


def read_failure(path):
    try:
        with Path(path).open("r", encoding="utf-8") as handle:
            value = handle.read(4097)
        if len(value) > 4096:
            return {}
        return safe_worker_diagnostic(json.loads(value))
    except (OSError, ValueError, RecursionError):
        return {}
