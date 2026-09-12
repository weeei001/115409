import argparse
import asyncio
from datetime import date
import sys


COMMANDS = (
    "crawl-cnyes", "crawl-ltn", "finmind-fetch", "finmind-import", "sentiment-batch",
    "chunk-news", "vectorize-news", "news-ingest", "scheduler", "legacy-scheduler",
    "cache-warmup", "technical-recompute",
)


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    parser = argparse.ArgumentParser(description="Independent workers. No job is started or stopped by FastAPI.")
    parser.add_argument("job", choices=COMMANDS)
    args = parser.parse_args(argv[:1])
    forwarded = argv[1:]
    if forwarded[:1] == ["--"]:
        forwarded = forwarded[1:]
    try:
        return dispatch(args.job, forwarded)
    except KeyboardInterrupt:
        print("Worker interrupted", file=sys.stderr)
        return 130
    except Exception as exc:
        # The CLI boundary must not echo tokens, HTTP bodies or SQL parameters.
        print(f"{args.job} failed ({type(exc).__name__})", file=sys.stderr)
        return 1


def dispatch(job: str, argv: list[str]) -> int:
    if job in {"crawl-cnyes", "crawl-ltn"}:
        from app.jobs.crawlers import crawler_main
        return crawler_main(job.removeprefix("crawl-"), argv)
    if job == "finmind-fetch":
        from app.jobs.finmind.fetch import main as fetch
        return fetch(argv)
    if job == "finmind-import":
        from app.jobs.finmind.import_csv import main as import_csv
        return import_csv(argv)
    if job == "sentiment-batch":
        from app.jobs.sentiment.cli import main as sentiment
        return sentiment(argv)
    if job in {"chunk-news", "vectorize-news", "news-ingest"}:
        from app.jobs.ingestion.cli import main as ingest
        return ingest(job, argv)
    if job in {"scheduler", "legacy-scheduler"}:
        from app.jobs.scheduler import main as schedule
        return schedule(argv)

    parser = argparse.ArgumentParser(prog=f"python -m app.jobs {job}")
    parser.add_argument("--symbols", required=True)
    parser.add_argument("--start", type=date.fromisoformat)
    parser.add_argument("--end", type=date.fromisoformat)
    args = parser.parse_args(argv)
    symbols = list(dict.fromkeys(s.strip().upper() for s in args.symbols.split(",") if s.strip()))
    if not symbols:
        parser.error("--symbols must include at least one symbol")
    if args.start and args.end and args.start > args.end:
        parser.error("--start must be on or before --end")
    if job == "cache-warmup":
        from app.jobs.warmup import warm
        return asyncio.run(warm(symbols, args.start, args.end))

    from app.core.config import get_settings
    from app.db.engine import make_engine, make_session_factory
    from app.jobs.indicators import recompute

    engine = make_engine(get_settings())
    try:
        for symbol in symbols:
            with make_session_factory(engine)() as db:
                count = recompute(db, symbol, args.start, args.end)
                print(f"symbol={symbol} rows={count}")
    finally:
        engine.dispose()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
