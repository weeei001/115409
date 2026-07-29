from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from config import get_settings
from database import Base, SessionLocal, engine
from schemas.stock_behavior import StockBehaviorTextBriefRequest
from stock_behavior.orchestrator import StockBehaviorOrchestrator


def load_cases(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError("cases file must contain a JSON array")
    cases = []
    for index, item in enumerate(data, 1):
        if not isinstance(item, dict):
            raise ValueError(f"case {index} must be an object")
        symbol = str(item.get("symbol", "")).strip().upper()
        if not symbol or not symbol.isalnum():
            raise ValueError(f"case {index} has an invalid symbol")
        try:
            as_of_date = date.fromisoformat(str(item.get("as_of_date", "")))
        except ValueError as exc:
            raise ValueError(f"case {index} has an invalid as_of_date") from exc
        cases.append({**item, "symbol": symbol, "as_of_date": as_of_date.isoformat()})
    return cases


async def build_candidates(db: Any, settings: Any, cases: list[dict], out: Path) -> dict[str, int]:
    out.mkdir(parents=True, exist_ok=True)
    orchestrator = StockBehaviorOrchestrator(db=db, settings=settings)
    succeeded = failed = 0
    for index, case in enumerate(cases):
        try:
            # text-first-v2 由後端自行取新聞；force_refresh 避免撈到既有快照。
            response = await orchestrator.generate_text_brief(
                StockBehaviorTextBriefRequest(
                    symbol=case["symbol"],
                    as_of_date=case["as_of_date"],
                    force_refresh=True,
                )
            )
            payload = {
                "case": case,
                "response": response.model_dump(mode="json"),
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }
            destination = out / f"{case['symbol']}_{case['as_of_date']}.json"
            destination.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            succeeded += 1
            print(f"symbol={case['symbol']} as_of={case['as_of_date']} result=success path={destination}")
        except Exception as exc:
            db.rollback()
            failed += 1
            print(f"symbol={case['symbol']} as_of={case['as_of_date']} result=failed error={exc}")
        if index + 1 < len(cases):
            await asyncio.sleep(3)
    print(f"completed success={succeeded} failed={failed}")
    return {"success": succeeded, "failed": failed}


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build text-brief golden candidates.")
    parser.add_argument("--cases", required=True, type=Path)
    parser.add_argument("--out", type=Path, default=Path("golden_candidates"))
    return parser.parse_args(argv)


def main() -> None:
    args = parse_args()
    try:
        cases = load_cases(args.cases)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        raise SystemExit(f"Invalid cases file: {exc}") from exc
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        asyncio.run(build_candidates(db, get_settings(), cases, args.out))
    finally:
        db.close()


if __name__ == "__main__":
    main()
