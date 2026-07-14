from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from database import Base, SessionLocal, engine
from backtest.trend_backtest import score_pending_trend_snapshots
from stock_behavior.scoring import score_pending_snapshots


def main() -> None:
    parser = argparse.ArgumentParser(description="Score pending stock behavior snapshots.")
    parser.add_argument("--symbol")
    parser.add_argument("--since", type=date.fromisoformat)
    parser.add_argument("--deadband", type=float, default=0.01)
    args = parser.parse_args()

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        stock_behavior_result = score_pending_snapshots(
            db,
            symbol=args.symbol,
            since=args.since,
            deadband=args.deadband,
        )
        trend_result = score_pending_trend_snapshots(
            db,
            symbol=args.symbol,
            since=args.since,
        )
        print({"stock_behavior": stock_behavior_result})
        print({"trend_prediction": trend_result})
    finally:
        db.close()


if __name__ == "__main__":
    main()
