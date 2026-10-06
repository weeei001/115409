"""Bounded public job diagnostics; never publish subprocess output or exception text."""
import json
import re


STAGES = frozenset({"market-fetch", "market-import", "market-backfill", "paper-reconcile", "crawl-cnyes", "crawl-ltn",
    "migrate-news-impact-schema", "news-ingest", "news-impact-batch", "news-impact-sync", "cache-warmup", "stock-backfill"})
_FAILURE = re.compile(r"([a-z-]+) exited with code (-?\d{1,10})(?: (\{.*\}))?")
PHASES = frozenset({"arguments", "dispatch", "settings", "catalog", "lock", "database", "schema", "http", "analysis"})
REASONS = frozenset({"worker_exception", "invalid_arguments", "catalog_unavailable", "article_failures",
    "budget_exhausted", "consecutive_failures", "timeout", "auth_error_401", "model_not_found",
    "rate_limit_429", "client_uninitialized", "upstream_model_error", "truncated_output", "validation_failed"})
ERROR_TYPES = frozenset({"Exception", "RuntimeError", "ValueError", "ValidationError", "OSError",
    "PermissionError", "FileNotFoundError", "JobAlreadyRunning", "AppError", "SQLAlchemyError",
    "OperationalError", "ProgrammingError", "IntegrityError", "DBAPIError", "TimeoutError"})
_INTERRUPTIONS = {
    "Service restarted before this run completed": "service_restart",
    "Service stopped before this run completed": "service_stop",
    "Run completion could not be recorded": "completion_unknown",
}


def safe_error(value):
    if not value:
        return None
    if value in _INTERRUPTIONS or value == "Job failed":
        return value
    failures = failure_stages(value)
    if failures:
        return "; ".join(format_failure(item["stage"], item["exit_code"], item) for item in failures)
    return "Job failed; detailed cause is unknown"


def safe_worker_diagnostic(value):
    if not isinstance(value, dict):
        return {}
    diagnostic = {key: value[key] for key, allowed in (
        ("phase", PHASES), ("reason", REASONS), ("error_type", ERROR_TYPES))
        if isinstance(value.get(key), str) and value[key] in allowed}
    reasons = value.get("failure_reasons")
    if isinstance(reasons, dict):
        counts = {reason: count for reason, count in reasons.items()
            if reason in REASONS and type(count) is int and 0 < count <= 1_000_000}
        if counts:
            diagnostic["failure_reasons"] = dict(sorted(counts.items()))
    return diagnostic


def format_failure(stage, exit_code, diagnostic=None):
    detail = safe_worker_diagnostic(diagnostic)
    suffix = " " + json.dumps(detail, sort_keys=True, separators=(",", ":")) if detail else ""
    return f"{stage} exited with code {exit_code}{suffix}"


def failure_stages(value):
    if not isinstance(value, str) or len(value) > 8000:
        return []
    parts = value.split("; ")
    if len(parts) > len(STAGES):
        return []
    failures = []
    for part in parts:
        match = _FAILURE.fullmatch(part)
        if not match or match[1] not in STAGES:
            return []
        detail = {}
        if match[3]:
            try:
                detail = json.loads(match[3])
            except (ValueError, RecursionError):
                return []
            if not detail or safe_worker_diagnostic(detail) != detail:
                return []
        failures.append({"stage": match[1], "exit_code": int(match[2]), **detail})
    return failures


def run_diagnostics(row, live=None):
    failures = failure_stages(row.error)
    category = (_INTERRUPTIONS.get(row.error) or (
        "execution_exception" if any(item.get("reason") == "worker_exception" for item in failures) else
        "stage_nonzero" if failures else
        "execution_exception" if re.fullmatch(r"Job failed \([A-Za-z]+Error\)", row.error or "") else
        "unknown" if row.status in {"failed", "interrupted"} else None))
    live = live if isinstance(live, dict) and live.get("run_id") == row.id and row.status == "running" else {}
    stage = live.get("stage") if live.get("stage") in STAGES else None
    return {"run_id": row.id, "error_category": category, "failed_stages": failures,
        "stage": stage, "stage_started_at": live.get("stage_started_at") if stage else None,
        "last_activity_at": live.get("last_activity_at") if stage else None,
        "activity_kind": "stage_started" if stage else "unknown",
        "worker_progress": "unknown"}
