import argparse
import asyncio
from datetime import date
import sys


COMMANDS = (
    "paper-reconcile",
    "notifications",
    "init-schema",
    "admin-grant",
    "migrate-admin-schema",
    "crawl-cnyes", "crawl-ltn", "market-fetch", "market-backfill", "market-import",
    "chunk-news", "vectorize-news", "news-ingest", "migrate-news-schema", "scheduler", "legacy-scheduler",
    "cache-warmup", "technical-recompute", "methodology-train", "backtest-learned",
    "news-impact-batch", "migrate-news-impact-schema", "news-impact-sync",
    "stock-info-sync",
    "stock-backfill",
    "news-source-versions",
)


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    parser = argparse.ArgumentParser(description="Worker commands and explicit administrator bootstrap.")
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
    except SystemExit as exc:
        if exc.code:
            from app.jobs.diagnostics import report_failure
            report_failure("arguments", reason="invalid_arguments")
        raise
    except Exception as exc:
        from app.jobs.diagnostics import report_failure
        report_failure("dispatch", error=exc)
        # The CLI boundary must not echo tokens, HTTP bodies or SQL parameters.
        print(f"{args.job} failed ({type(exc).__name__})", file=sys.stderr)
        return 1


def dispatch(job: str, argv: list[str]) -> int:
    if job == "stock-backfill":
        from app.jobs.stock_backfill import main as backfill
        return backfill(argv)
    if job == "paper-reconcile":
        from app.jobs.paper_portfolio import main as reconcile
        return reconcile(argv)
    if job == "notifications":
        from app.jobs.notifications import main as notify
        return notify(argv)
    if job == "migrate-admin-schema":
        from app.jobs.admin_migrate import main as migrate
        return migrate(argv)
    if job == "admin-grant":
        from app.jobs.admin import main as grant
        return grant(argv)
    if job == "init-schema":
        from app.jobs.schema import main as initialize
        return initialize(argv)
    if job == "news-source-versions":
        from app.jobs.news_versions import main as versions
        return versions(argv)
    if job == "methodology-train":
        from app.jobs.research.methodology_trainer import main as train
        return train(argv)
    if job == "backtest-learned":
        from app.jobs.research.backtest_learned_prompt import main as backtest
        return backtest(argv)
    if job in {"crawl-cnyes", "crawl-ltn"}:
        from app.jobs.crawlers import crawler_main
        return crawler_main(job.removeprefix("crawl-"), argv)
    if job == "market-fetch":
        from app.jobs.market.fetch import main as fetch
        return fetch(argv)
    if job == "market-backfill":
        from app.jobs.market_history import main as backfill
        return backfill(argv)
    if job == "stock-info-sync":
        from app.jobs.market.stock_info import main as sync
        return sync(argv)
    if job == "market-import":
        from app.jobs.market.import_csv import main as import_csv
        return import_csv([*argv, "--require-manifest"] if "--help" not in argv else argv)
    if job == "news-impact-batch":
        from app.jobs.impact.cli import main as impact

        return impact(argv)
    if job == "news-impact-sync":
        from app.jobs.impact.sync import main as sync

        return sync(argv)
    if job == "migrate-news-impact-schema":
        from app.core.config import get_settings
        from app.db.engine import make_engine
        from app.jobs.impact.migrate import migrate_news_impact

        engine = make_engine(get_settings())
        try:
            print(migrate_news_impact(engine))
        finally:
            engine.dispose()
        return 0
    if job in {"chunk-news", "vectorize-news", "news-ingest"}:
        from app.jobs.ingestion.cli import main as ingest
        return ingest(job, argv)
    if job == "migrate-news-schema":
        from app.core.config import get_settings
        from app.db.engine import make_engine
        from app.jobs.ingestion.migrate import migrate_news_chunks
        engine = make_engine(get_settings())
        try:
            print(migrate_news_chunks(engine))
        finally:
            engine.dispose()
        return 0
    if job in {"scheduler", "legacy-scheduler"}:
        from app.jobs.scheduler import main as schedule
        return schedule(argv)

    parser = argparse.ArgumentParser(prog=f"python -m app.jobs {job}")
    parser.add_argument("--symbols")
    parser.add_argument("--start", type=date.fromisoformat)
    parser.add_argument("--end", type=date.fromisoformat)
    args = parser.parse_args(argv)
    symbols = (list(dict.fromkeys(s.strip().upper() for s in args.symbols.split(",") if s.strip()))
               if args.symbols else [])
    if args.symbols is not None and not symbols:
        parser.error("--symbols must include at least one symbol")
    if args.start and args.end and args.start > args.end:
        parser.error("--start must be on or before --end")
    if job == "cache-warmup":
        from app.jobs.warmup import warm
        return asyncio.run(warm(symbols or None, args.start, args.end))
    if not symbols:
        parser.error("--symbols must include at least one symbol")

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
