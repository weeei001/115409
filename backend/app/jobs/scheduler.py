"""Standalone serial scheduler. It runs only v1 CLI commands and owns no ASGI app."""
import argparse
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
import math
import signal
import subprocess
import sys

from app.core.config import state_directory


TAIPEI = timezone(timedelta(hours=8))
ROOT = Path(__file__).resolve().parents[2]


def run_worker(command: list[str]) -> int:
    # argv is assembled locally; there is no shell, legacy script, or API self-call.
    child = subprocess.Popen([sys.executable, "-m", "app.jobs", *command], cwd=ROOT)
    try:
        return child.wait()
    except BaseException:
        child.terminate()
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()
        raise


def run_pipeline(job: str, *, start: date, symbols: str | None, output: Path, run=None,
                 impact_execute=True, impact_limit=100, impact_max_cost_usd=0.50,
                 impact_since: date | None = None, source_enabled=None) -> int:
    run = run or run_worker
    if job == "ltn":
        raise ValueError("Liberty Times source has been retired")
    if job in {"pipeline", "all"}:
        raise ValueError("Full update pipeline has been retired; select an independent job")
    commands = []
    if job == "stock-backfill":
        if not symbols:
            raise ValueError("Stock backfill requires a symbol")
        commands.append(["stock-backfill", "--symbol", symbols])
    if job == "market":
        today = datetime.now(TAIPEI).date()
        previous_month = today.replace(day=1) - timedelta(days=1)
        revenue_start = (previous_month.replace(day=1) - timedelta(days=1)).replace(day=1)
        supplemental_symbols = ["--stocks", symbols] if symbols else []
        commands.append(["market-backfill", "--benchmark-only", "--incremental", "--start", start.isoformat()])
        commands.extend([
            ["market-fetch", *(["--stocks", symbols] if symbols else ["--from-stock-info"]),
             "--start", start.isoformat(), "--out", str(output)],
            ["market-import", "--input-dir", str(output)],
            ["market-supplemental-backfill", *supplemental_symbols,
             "--start", max(start, revenue_start).isoformat(), "--end", today.isoformat(),
             "--datasets", "monthly_revenue", "--out", str(output / "revenue_report.json")],
            ["market-supplemental-backfill", *supplemental_symbols,
             "--start", max(start, today - timedelta(days=400)).isoformat(), "--end", today.isoformat(),
             "--datasets", "financial_metrics", "--out", str(output / "financial_metrics_report.json")],
            ["paper-reconcile", "--execute"],
        ])
    if job == "cnyes":
        commands.append(["crawl-cnyes", "--scheduled-once"])
    if job in {"rag", "impact"}:
        commands.append(["migrate-news-impact-schema"])
    if job == "rag":
        commands.append(["news-ingest"])
    if job == "impact":
        commands.append(["news-impact-batch", "--limit", str(impact_limit),
                         "--max-cost-usd", str(impact_max_cost_usd),
                         *(["--since", impact_since.isoformat()] if impact_since else []),
                         *(["--execute"] if impact_execute else [])])
        if impact_execute:
            commands.append(["news-impact-sync", "--execute",
                *(["--backfill-days", str(max(1, (datetime.now(TAIPEI).date() - impact_since).days + 1))]
                  if impact_since else [])])
    if job == "text-brief":
        commands.append(["cache-warmup", *(["--symbols", symbols] if symbols else [])])
    exit_code = 0
    for command in commands:
        result = run(command)
        print(f"job={command[0]} exit_code={result}", flush=True)
        if result == 130:
            return result
        if result:
            # Source and per-article failures can coexist with usable committed data.
            if command[0] not in {"crawl-cnyes", "crawl-ltn", "news-impact-batch"}:
                return exit_code or result
            exit_code = exit_code or result
    return exit_code


def next_daily(now: datetime, at: time) -> datetime:
    now = now.astimezone(TAIPEI)
    candidate = datetime.combine(now.date(), at, TAIPEI)
    return candidate if candidate > now else candidate + timedelta(days=1)


class Scheduler:
    def __init__(self, run, now: datetime, *, market_at: time = time(17),
                 brief_at: time = time(22, 30), enabled=None):
        self.run, self.market_at = run, market_at
        self.enabled = enabled or (lambda name: True)
        self.brief_at = brief_at
        self.hourly_minutes = {"cnyes": 0, "rag": 10, "impact": 20}
        self.schedules = {name: f"Hourly :{minute:02d} Asia/Taipei"
                          for name, minute in self.hourly_minutes.items()}
        self.schedules["text-brief"] = f"Daily {brief_at:%H:%M} Asia/Taipei"
        self.next_runs = {name: self.next_time(name, now) for name in self.schedules}

    def next_time(self, name: str, now: datetime) -> datetime:
        if name == "text-brief":
            return next_daily(now, self.brief_at)
        now = now.astimezone(TAIPEI)
        candidate = now.replace(minute=self.hourly_minutes[name], second=0, microsecond=0)
        return candidate if candidate > now else candidate + timedelta(hours=1)

    def tick(self, now: datetime):
        # Queue each due job once; missed intervals never become a replay storm.
        for name, due in sorted(self.next_runs.items(), key=lambda item: item[1]):
            if now >= due:
                if self.enabled(name):
                    self.run(name)
                # A failed queue transaction raises and leaves this deadline due.
                self.next_runs[name] = self.next_time(name, now)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Standalone v1 scheduler, independent of FastAPI lifecycle")
    parser.add_argument("--start", type=date.fromisoformat, default=date(2021, 1, 1))
    parser.add_argument("--symbols", help="Limit market fetch and brief warmup to these codes; default is every stock_info company")
    parser.add_argument("--out", type=Path, default=state_directory() / "market")
    parser.add_argument("--job", required=True, choices=["market", "cnyes", "rag", "text-brief", "impact"])
    parser.add_argument("--market-time", dest="market_time", type=time.fromisoformat, default=time(17))
    parser.add_argument("--impact-execute", dest="impact_execute",
                        action=argparse.BooleanOptionalAction, default=True,
                        help="Execute the independent event impact job (default: enabled)")
    parser.add_argument("--impact-limit", dest="impact_limit",
                        type=int, default=100, help="Maximum articles per event impact run")
    parser.add_argument("--impact-max-cost-usd",
                        dest="impact_max_cost_usd", type=float, default=0.50,
                        help="Estimated model budget per event impact run")
    parser.add_argument("--impact-since", type=date.fromisoformat,
                        help="Fixed publication start date for incremental event analysis; default is the last 30 days")
    args = parser.parse_args(argv)
    if args.market_time.tzinfo is not None:
        parser.error("--market-time is a Taiwan local time without a timezone suffix")
    if (args.impact_limit < 1 or not math.isfinite(args.impact_max_cost_usd)
            or args.impact_max_cost_usd < 0):
        parser.error("impact limit must be positive and budget must be finite and nonnegative")
    symbols = ",".join(dict.fromkeys(s.strip() for s in args.symbols.split(",") if s.strip())) if args.symbols else None
    if args.symbols is not None and not symbols:
        parser.error("symbols must not be empty")
    from app.jobs.locking import worker_lock

    def run(job):
        return run_pipeline(job, start=args.start, symbols=symbols, output=args.out,
                            impact_execute=args.impact_execute, impact_limit=args.impact_limit,
                            impact_max_cost_usd=args.impact_max_cost_usd, impact_since=args.impact_since)

    with worker_lock("scheduler"):
        def stop(signum, frame):
            raise KeyboardInterrupt
        previous = {}
        try:
            for sig in (signal.SIGINT, signal.SIGTERM):
                previous[sig] = signal.signal(sig, stop)
            return run(args.job)
        except KeyboardInterrupt:
            return 0
        finally:
            for sig, handler in previous.items():
                signal.signal(sig, handler)
