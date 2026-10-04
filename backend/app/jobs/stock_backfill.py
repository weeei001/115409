"""Backfill one supported stock through the existing FinMind workers."""
import argparse
import csv
from datetime import date, datetime
from pathlib import Path
import re
from tempfile import TemporaryDirectory

from app.core.config import get_settings, state_directory
from app.jobs.finmind.fetch import stock_info_symbols
from app.jobs.scheduler import TAIPEI


def history_start(end: date) -> date:
    try:
        return end.replace(year=end.year - 2)
    except ValueError:
        return end.replace(year=end.year - 2, day=28)


def backfill(symbol: str, *, end: date, output: Path, run) -> int:
    output.mkdir(parents=True, exist_ok=True)
    # Every run exports fresh files; retries cannot import stale or partial exports.
    with TemporaryDirectory(prefix=f"{symbol}-", dir=output) as directory:
        result = run("finmind-fetch", ["--stock", symbol, "--start", history_start(end).isoformat(),
            "--end", end.isoformat(), "--out", directory, "--request-interval", "0.5"])
        if result:
            return result
        for dataset in ("price_volume", "institutional"):
            with (Path(directory) / f"{symbol}_{dataset}.csv").open(encoding="utf-8-sig", newline="") as source:
                rows = csv.DictReader(source)
                if not any(row.get("symbol") == symbol and
                           history_start(end).isoformat() <= row.get("date", "") <= end.isoformat()
                           for row in rows):
                    raise ValueError(f"No {dataset} history was returned for the selected stock")
        return run("finmind-import", ["--input-dir", directory, "--symbols", symbol])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Backfill two years of market history for a supported stock")
    parser.add_argument("--symbol", required=True)
    args = parser.parse_args(argv)
    if not re.fullmatch(r"\d{4,6}", args.symbol):
        parser.error("Stock id must contain 4 to 6 digits")
    if args.symbol not in stock_info_symbols(get_settings()):
        raise ValueError("Stock is not enabled in stock_info")
    from app.jobs.__main__ import dispatch
    return backfill(args.symbol, end=datetime.now(TAIPEI).date(),
        output=state_directory() / "market" / "stock-backfill", run=dispatch)
