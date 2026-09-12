"""Standalone serial scheduler. It runs only v2 CLI commands and owns no ASGI app."""
import argparse
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
import math
import signal
import subprocess
import sys
import time as clock


TAIPEI = timezone(timedelta(hours=8))
ROOT = Path(__file__).resolve().parents[2]
SYMBOLS = "2330,2317,2454,2881,2408,2615"


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


def run_pipeline(job: str, *, start: date, symbols: str, output: Path, run=None,
                 sentiment_execute=False, sentiment_limit=100, sentiment_max_cost_usd=0.50) -> int:
    run = run or run_worker
    commands = []
    if job in {"finmind", "all"}:
        commands.extend([
            ["finmind-fetch", "--stocks", symbols, "--start", start.isoformat(), "--out", str(output)],
            ["finmind-import", "--input-dir", str(output), "--symbols", symbols],
        ])
    if job in {"cnyes", "all"}:
        commands.append(["crawl-cnyes", "--scheduled-once"])
    if job in {"ltn", "all"}:
        commands.append(["crawl-ltn", "--scheduled-once", "--lookback-days", "30"])
    if job in {"rag", "all"}:
        commands.append(["news-ingest"])
    if job in {"rag", "text-brief", "all"}:
        commands.append(["cache-warmup", "--symbols", symbols])
    if job == "sentiment" or sentiment_execute and job in {"rag", "all"}:
        commands.append(["sentiment-batch", "--incremental", "--stocks", symbols,
                         "--limit", str(sentiment_limit), "--max-cost-usd", str(sentiment_max_cost_usd),
                         *(["--execute"] if sentiment_execute else [])])
    exit_code = 0
    for command in commands:
        result = run(command)
        print(f"job={command[0]} exit_code={result}", flush=True)
        if result:
            if command[0] not in {"cache-warmup", "sentiment-batch"}:
                return result
            exit_code = exit_code or result
    return exit_code


def next_daily(now: datetime, at: time) -> datetime:
    now = now.astimezone(TAIPEI)
    candidate = datetime.combine(now.date(), at, TAIPEI)
    return candidate if candidate > now else candidate + timedelta(days=1)


class Scheduler:
    def __init__(self, run, now: datetime, monotonic: float, *, interval: float = 1800,
                 delay: float = 600, finmind_at: time = time(17)):
        self.run, self.interval, self.delay, self.finmind_at = run, interval, delay, finmind_at
        self.next_news = {"cnyes": monotonic + interval, "ltn": monotonic + interval}
        self.next_finmind = next_daily(now, finmind_at)
        self.followup = None

    def tick(self, now: datetime, monotonic: float):
        # All calls are serial. One pending follow-up coalesces both news sources.
        started = clock.monotonic()

        def finished_at():
            return monotonic + max(0, clock.monotonic() - started)

        if now >= self.next_finmind:
            self.next_finmind = next_daily(now, self.finmind_at)
            if self.run("finmind") == 0 and self.followup is None:
                self.followup = finished_at() + self.delay
        for name in self.next_news:
            if monotonic >= self.next_news[name]:
                result = self.run(name)
                self.next_news[name] = finished_at() + self.interval
                if result == 0 and self.followup is None:
                    self.followup = finished_at() + self.delay
        if self.followup is not None and finished_at() >= self.followup:
            self.followup = None
            self.run("rag")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Standalone v2 scheduler, independent of FastAPI lifecycle")
    parser.add_argument("--start", type=date.fromisoformat, default=date(2021, 1, 1))
    parser.add_argument("--symbols", default=SYMBOLS)
    parser.add_argument("--out", type=Path, default=ROOT / ".state" / "finmind")
    parser.add_argument("--run-now", action="store_true")
    parser.add_argument("--job", choices=["finmind", "cnyes", "ltn", "rag", "text-brief", "sentiment", "all"])
    parser.add_argument("--interval-minutes", type=float, default=30)
    parser.add_argument("--rag-delay-minutes", type=float, default=10)
    parser.add_argument("--finmind-time", type=time.fromisoformat, default=time(17))
    parser.add_argument("--sentiment-execute", action="store_true",
                        help="Enable incremental sentiment calls after successful news ingestion")
    parser.add_argument("--sentiment-limit", type=int, default=100, help="Maximum article/stock pairs per run")
    parser.add_argument("--sentiment-max-cost-usd", type=float, default=0.50, help="Estimated model budget per run")
    args = parser.parse_args(argv)
    if not math.isfinite(args.interval_minutes) or not math.isfinite(args.rag_delay_minutes) or args.interval_minutes <= 0 or args.rag_delay_minutes < 0:
        parser.error("interval must be positive and delay must not be negative")
    if args.finmind_time.tzinfo is not None:
        parser.error("--finmind-time is a Taiwan local time without a timezone suffix")
    if (args.sentiment_limit < 1 or not math.isfinite(args.sentiment_max_cost_usd)
            or args.sentiment_max_cost_usd < 0):
        parser.error("sentiment limit must be positive and budget must be finite and nonnegative")
    symbols = ",".join(dict.fromkeys(s.strip() for s in args.symbols.split(",") if s.strip()))
    if not symbols:
        parser.error("symbols must not be empty")
    from app.jobs.locking import worker_lock

    def run(job):
        return run_pipeline(job, start=args.start, symbols=symbols, output=args.out,
                            sentiment_execute=args.sentiment_execute, sentiment_limit=args.sentiment_limit,
                            sentiment_max_cost_usd=args.sentiment_max_cost_usd)

    with worker_lock("scheduler"):
        def stop(signum, frame):
            raise KeyboardInterrupt
        previous = {}
        try:
            for sig in (signal.SIGINT, signal.SIGTERM):
                previous[sig] = signal.signal(sig, stop)
            if args.job:
                return run(args.job)
            scheduler = Scheduler(run, datetime.now(TAIPEI), clock.monotonic(),
                interval=args.interval_minutes * 60, delay=args.rag_delay_minutes * 60, finmind_at=args.finmind_time)
            if args.run_now and run("finmind") != 0:
                return 1
            while True:
                scheduler.tick(datetime.now(TAIPEI), clock.monotonic())
                clock.sleep(1)
        except KeyboardInterrupt:
            return 0
        finally:
            for sig, handler in previous.items():
                signal.signal(sig, handler)
