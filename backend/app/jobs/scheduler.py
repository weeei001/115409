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
                 sentiment_execute=True, sentiment_limit=100, sentiment_max_cost_usd=0.50,
                 backfill=False) -> int:
    run = run or run_worker
    commands = []
    if job in {"market", "all"}:
        if backfill:
            backfill_output = output / "backfill"
            commands.extend([
                ["market-fetch", *(["--stocks", symbols] if symbols else ["--from-stock-info"]),
                 "--start", start.isoformat(), "--out", str(backfill_output)],
                ["market-import", "--input-dir", str(backfill_output)],
            ])
        commands.extend([
            ["market-fetch", *(["--stocks", symbols] if symbols else ["--from-stock-info"]),
             "--start", start.isoformat(), "--out", str(output)],
            ["market-import", "--input-dir", str(output)],
        ])
    if job in {"cnyes", "all"}:
        commands.append(["crawl-cnyes", "--scheduled-once"])
    if job in {"ltn", "all"}:
        commands.append(["crawl-ltn", "--scheduled-once", "--lookback-days", "30"])
    if job in {"rag", "all", "impact"}:
        commands.append(["migrate-news-impact-schema"])
    if job in {"rag", "all"}:
        commands.append(["news-ingest"])
    if job == "impact" or sentiment_execute and job in {"rag", "all"}:
        commands.append(["news-impact-batch", "--limit", str(sentiment_limit),
                         "--max-cost-usd", str(sentiment_max_cost_usd),
                         *(["--execute"] if sentiment_execute else [])])
        if sentiment_execute:
            commands.append(["news-impact-sync", "--execute"])
    if job in {"rag", "text-brief", "all"}:
        commands.append(["cache-warmup", *(["--symbols", symbols] if symbols else [])])
    if job == "sentiment":
        commands.append(["sentiment-batch", "--incremental",
                         "--limit", str(sentiment_limit), "--max-cost-usd", str(sentiment_max_cost_usd),
                         *(["--execute"] if sentiment_execute else [])])
    exit_code = 0
    for command in commands:
        result = run(command)
        print(f"job={command[0]} exit_code={result}", flush=True)
        if result:
            if command[0] not in {"cache-warmup", "sentiment-batch", "news-impact-batch", "news-impact-sync"}:
                return result
            exit_code = exit_code or result
    return exit_code


def next_daily(now: datetime, at: time) -> datetime:
    now = now.astimezone(TAIPEI)
    candidate = datetime.combine(now.date(), at, TAIPEI)
    return candidate if candidate > now else candidate + timedelta(days=1)


class Scheduler:
    def __init__(self, run, now: datetime, monotonic: float, *, interval: float = 1800,
                 delay: float = 600, market_at: time = time(17)):
        self.run, self.interval, self.delay, self.market_at = run, interval, delay, market_at
        self.next_news = {"cnyes": monotonic + interval, "ltn": monotonic + interval}
        self.next_market = next_daily(now, market_at)
        self.followup = None

    def tick(self, now: datetime, monotonic: float):
        # All calls are serial. One pending follow-up coalesces both news sources.
        started = clock.monotonic()

        def finished_at():
            return monotonic + max(0, clock.monotonic() - started)

        if now >= self.next_market:
            self.next_market = next_daily(now, self.market_at)
            if self.run("market") == 0 and self.followup is None:
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
    parser.add_argument("--symbols", help="Limit market processing to these codes; default is all listed/OTC companies")
    parser.add_argument("--out", type=Path, default=ROOT / ".state" / "market")
    parser.add_argument("--run-now", action="store_true")
    parser.add_argument("--backfill", action="store_true",
                        help="Backfill all historical stock_info data before the first market/AI run")
    parser.add_argument("--job", choices=["market", "finmind", "cnyes", "ltn", "rag", "text-brief", "sentiment", "impact", "all"])
    parser.add_argument("--interval-minutes", type=float, default=30)
    parser.add_argument("--rag-delay-minutes", type=float, default=10)
    parser.add_argument("--market-time", "--finmind-time", dest="market_time", type=time.fromisoformat, default=time(17))
    parser.add_argument("--impact-execute", "--sentiment-execute", dest="sentiment_execute",
                        action=argparse.BooleanOptionalAction, default=True,
                        help="Execute event impact analysis in rag/all pipelines (default: enabled)")
    parser.add_argument("--impact-limit", "--sentiment-limit", dest="sentiment_limit",
                        type=int, default=100, help="Maximum articles per event impact run")
    parser.add_argument("--impact-max-cost-usd", "--sentiment-max-cost-usd",
                        dest="sentiment_max_cost_usd", type=float, default=0.50,
                        help="Estimated model budget per event impact run")
    args = parser.parse_args(argv)
    if not math.isfinite(args.interval_minutes) or not math.isfinite(args.rag_delay_minutes) or args.interval_minutes <= 0 or args.rag_delay_minutes < 0:
        parser.error("interval must be positive and delay must not be negative")
    if args.market_time.tzinfo is not None:
        parser.error("--market-time is a Taiwan local time without a timezone suffix")
    if (args.sentiment_limit < 1 or not math.isfinite(args.sentiment_max_cost_usd)
            or args.sentiment_max_cost_usd < 0):
        parser.error("sentiment limit must be positive and budget must be finite and nonnegative")
    symbols = ",".join(dict.fromkeys(s.strip() for s in args.symbols.split(",") if s.strip())) if args.symbols else None
    if args.symbols is not None and not symbols:
        parser.error("symbols must not be empty")
    from app.jobs.locking import worker_lock

    backfill = args.backfill

    def run(job):
        nonlocal backfill
        if job == "finmind":
            job = "market"
        use_backfill = backfill and job in {"market", "all"}
        result = run_pipeline(job, start=args.start, symbols=symbols, output=args.out,
                            backfill=use_backfill,
                            sentiment_execute=args.sentiment_execute, sentiment_limit=args.sentiment_limit,
                            sentiment_max_cost_usd=args.sentiment_max_cost_usd)
        if use_backfill and result == 0:
            backfill = False
        return result

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
                interval=args.interval_minutes * 60, delay=args.rag_delay_minutes * 60, market_at=args.market_time)
            if args.run_now and run("market") != 0:
                return 1
            while True:
                scheduler.tick(datetime.now(TAIPEI), clock.monotonic())
                clock.sleep(1)
        except KeyboardInterrupt:
            return 0
        finally:
            for sig, handler in previous.items():
                signal.signal(sig, handler)
