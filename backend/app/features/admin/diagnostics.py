"""Bounded public job diagnostics; never publish subprocess output or exception text."""
import re


STAGES = frozenset({"market-fetch", "market-import", "market-backfill", "paper-reconcile", "crawl-cnyes", "crawl-ltn",
    "migrate-news-impact-schema", "news-ingest", "news-impact-batch", "news-impact-sync", "cache-warmup"})
_FAILURE = re.compile(r"([a-z-]+) exited with code (-?\d{1,10})")
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
        return "; ".join(f"{item['stage']} exited with code {item['exit_code']}" for item in failures)
    return "Job failed; detailed cause is unknown"


def failure_stages(value):
    if not isinstance(value, str) or len(value) > 1000:
        return []
    parts = value.split("; ")
    if len(parts) > len(STAGES):
        return []
    failures = []
    for part in parts:
        match = _FAILURE.fullmatch(part)
        if not match or match[1] not in STAGES:
            return []
        failures.append({"stage": match[1], "exit_code": int(match[2])})
    return failures


def run_diagnostics(row, live=None):
    failures = failure_stages(row.error)
    category = (_INTERRUPTIONS.get(row.error) or ("stage_nonzero" if failures else
        "execution_exception" if re.fullmatch(r"Job failed \([A-Za-z]+Error\)", row.error or "") else
        "unknown" if row.status in {"failed", "interrupted"} else None))
    live = live if isinstance(live, dict) and live.get("run_id") == row.id and row.status == "running" else {}
    stage = live.get("stage") if live.get("stage") in STAGES else None
    return {"run_id": row.id, "error_category": category, "failed_stages": failures,
        "stage": stage, "stage_started_at": live.get("stage_started_at") if stage else None,
        "last_activity_at": live.get("last_activity_at") if stage else None,
        "activity_kind": "stage_started" if stage else "unknown",
        "worker_progress": "unknown"}
