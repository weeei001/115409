"""Backfill one supported stock from official TWSE/TPEx sources."""
import argparse
from datetime import date, datetime
from pathlib import Path
import re
from tempfile import TemporaryDirectory

from app.core.config import state_directory
from app.jobs.market.fetch import stock_info_symbols
from app.jobs.scheduler import TAIPEI


def history_start(end: date) -> date:
    try:
        return end.replace(year=end.year - 2)
    except ValueError:
        return end.replace(year=end.year - 2, day=28)


def backfill(symbol: str, *, end: date, output: Path, run) -> int:
    output.mkdir(parents=True, exist_ok=True)
    # Fresh official snapshots also refresh the company catalog for history routing.
    with TemporaryDirectory(prefix=f"{symbol}-", dir=output) as directory:
        result = run("market-fetch", ["--stock", symbol, "--start", history_start(end).isoformat(),
            "--end", end.isoformat(), "--out", directory])
        if result:
            return result
        result = run("market-import", ["--input-dir", directory, "--symbols", symbol])
        if result:
            return result
    return run("market-backfill", ["--stocks", symbol, "--start", history_start(end).isoformat(),
        "--end", end.isoformat(), "--include-institutional", "--skip-benchmark",
        "--out", str(output / f"{symbol}_history.json")])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Backfill two years of market history for a supported stock")
    parser.add_argument("--symbol", required=True)
    args = parser.parse_args(argv)
    if not re.fullmatch(r"\d{4,6}", args.symbol):
        parser.error("Stock id must contain 4 to 6 digits")
    if args.symbol not in stock_info_symbols():
        raise ValueError("Stock is not enabled in stock_info")
    from app.jobs.__main__ import dispatch
    return backfill(args.symbol, end=datetime.now(TAIPEI).date(),
        output=state_directory() / "market" / "stock-backfill", run=dispatch)
