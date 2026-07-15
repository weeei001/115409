from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import date
from pathlib import Path
from statistics import fmean


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from crud.analysis_snapshot import get_latest_backtest_run
from database import Base, SessionLocal, engine
from models.analysis_snapshot import (
    StockBehaviorAnalysisSnapshot,
    StockBehaviorProjectionScore,
)
from schemas.stock_behavior import SCENARIO_PROJECTION_DAYS
from stock_behavior.backtest_stats import mean_abs_pct_error, skill_score, wilson_interval

PLACEHOLDER_REASON = "資料不足，系統已補齊保守情境點。"


def resolve_config_hash(db, config_hash: str | None) -> str:
    if config_hash:
        return config_hash
    latest = get_latest_backtest_run(db)
    if latest is None:
        raise SystemExit("No backtest run found; pass --config-hash.")
    return latest.config_hash


def _percent(value: float | None) -> str:
    return "-" if value is None else f"{value:.2%}"


def _is_placeholder_point(point: dict) -> bool:
    return str(point.get("reason") or "").strip() == PLACEHOLDER_REASON


def load_placeholder_days(public_projection_json: str | None) -> set[int]:
    """回傳這份快照中，被 normalizer 判定為『找不到對應點、已補上保守佔位點』的 day 集合。

    根因（見 docs/回測手冊.md TODO）：LLM 輸出遭 max_completion_tokens 截斷，
    JSON 搶救解析誤抓內部片段當作整份回覆，8 個點全數退化為佔位符，
    但因未觸發 is_fallback，混入了正常樣本。此函式用 reason 字串精準識別並排除。
    """
    try:
        projection = json.loads(public_projection_json or "")
    except (TypeError, json.JSONDecodeError):
        return set()
    points = projection.get("points") if isinstance(projection, dict) else None
    if not isinstance(points, list):
        return set()
    days: set[int] = set()
    for point in points:
        if isinstance(point, dict) and _is_placeholder_point(point):
            day = point.get("day")
            if isinstance(day, int):
                days.add(day)
    return days


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "彙總回測評分，並排除因 LLM 輸出截斷而退化為保守佔位點的樣本"
            "（reason == 系統補齊佔位文字），避免這些『非真實預測』污染 MAPE/skill。"
        )
    )
    parser.add_argument("--config-hash")
    parser.add_argument("--symbol")
    parser.add_argument("--since", type=date.fromisoformat)
    parser.add_argument("--until", type=date.fromisoformat)
    parser.add_argument("--exclude-ex-dividend", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        config_hash = resolve_config_hash(db, args.config_hash)

        snapshot_query = db.query(StockBehaviorAnalysisSnapshot).filter(
            StockBehaviorAnalysisSnapshot.run_kind == "backtest",
            StockBehaviorAnalysisSnapshot.config_hash == config_hash,
            StockBehaviorAnalysisSnapshot.is_fallback.is_(False),
        )
        if args.symbol:
            snapshot_query = snapshot_query.filter(StockBehaviorAnalysisSnapshot.symbol == args.symbol)
        if args.since:
            snapshot_query = snapshot_query.filter(StockBehaviorAnalysisSnapshot.as_of_date >= args.since)
        if args.until:
            snapshot_query = snapshot_query.filter(StockBehaviorAnalysisSnapshot.as_of_date <= args.until)
        snapshots = snapshot_query.all()

        placeholder_days_by_snapshot: dict[int, set[int]] = {}
        placeholder_snapshot_count = 0
        for snapshot in snapshots:
            days = load_placeholder_days(snapshot.public_projection_json)
            if days:
                placeholder_days_by_snapshot[snapshot.id] = days
                if len(days) == len(SCENARIO_PROJECTION_DAYS):
                    placeholder_snapshot_count += 1

        snapshot_ids = [snapshot.id for snapshot in snapshots]
        query = (
            db.query(StockBehaviorProjectionScore)
            .filter(StockBehaviorProjectionScore.snapshot_id.in_(snapshot_ids))
            if snapshot_ids
            else db.query(StockBehaviorProjectionScore).filter(False)
        )
        all_scores = query.all()

        clean_scores = [
            score
            for score in all_scores
            if score.day not in placeholder_days_by_snapshot.get(score.snapshot_id, set())
        ]
        excluded_count = len(all_scores) - len(clean_scores)

        print(f"config_hash: {config_hash}")
        print(
            f"snapshots={len(snapshots)}（is_fallback=False）｜"
            f"其中 8 點全為截斷佔位符={placeholder_snapshot_count}"
            f"（{placeholder_snapshot_count / len(snapshots):.1%}）" if snapshots else ""
        )
        print(
            f"評分點：全部={len(all_scores)}｜排除截斷佔位點={excluded_count}"
            f"（{excluded_count / len(all_scores):.1%}）｜乾淨樣本={len(clean_scores)}"
            if all_scores
            else "評分點：0"
        )
        print()
        print(
            f"{'day':>4} {'n':>6} {'hit':>8} {'95% CI':>17} "
            f"{'up/base':>8} {'down':>8} {'neutral':>8} "
            f"{'model MAPE':>12} {'RW MAPE':>10} {'skill':>9}"
        )

        grouped: dict[int, list] = {day: [] for day in SCENARIO_PROJECTION_DAYS}
        for score in clean_scores:
            if score.day in grouped:
                grouped[score.day].append(score)

        for day, scores in grouped.items():
            scorable = [score for score in scores if score.direction_hit is not None]
            hits = sum(bool(score.direction_hit) for score in scorable)
            hit_rate = hits / len(scorable) if scorable else None
            low, high = wilson_interval(hits, len(scorable))
            directions = Counter(score.direction_actual for score in scores)
            n = len(scores)
            mape_scores = [
                score
                for score in scores
                if score.abs_pct_error is not None
                and (not args.exclude_ex_dividend or not score.ex_dividend_between)
            ]
            model_mape = (
                fmean(float(score.abs_pct_error) for score in mape_scores)
                if mape_scores
                else None
            )
            rw_mape = mean_abs_pct_error(
                [
                    (float(score.base_close), float(score.actual_close))
                    for score in scores
                    if score.base_close is not None
                    and score.actual_close is not None
                    and (not args.exclude_ex_dividend or not score.ex_dividend_between)
                ]
            )
            print(
                f"{day:>4} {n:>6} {_percent(hit_rate):>8} "
                f"{f'[{low:.2%}, {high:.2%}]':>17} "
                f"{_percent(directions['up'] / n if n else 0.0):>8} "
                f"{_percent(directions['down'] / n if n else 0.0):>8} "
                f"{_percent(directions['neutral'] / n if n else 0.0):>8} "
                f"{_percent(model_mape):>12} {_percent(rw_mape):>10} "
                f"{_percent(skill_score(model_mape, rw_mape)):>9}"
            )

        fallback_count = sum(
            1
            for snapshot in db.query(StockBehaviorAnalysisSnapshot).filter(
                StockBehaviorAnalysisSnapshot.run_kind == "backtest",
                StockBehaviorAnalysisSnapshot.config_hash == config_hash,
            )
            if snapshot.is_fallback
        )
        total_snapshots = db.query(StockBehaviorAnalysisSnapshot).filter(
            StockBehaviorAnalysisSnapshot.run_kind == "backtest",
            StockBehaviorAnalysisSnapshot.config_hash == config_hash,
        ).count()
        print()
        print(
            f"is_fallback（結構驗證失敗）快照：{fallback_count}/{total_snapshots}"
            f"（{fallback_count / total_snapshots:.2%}）"
            if total_snapshots
            else ""
        )
        print(
            f"截斷佔位（is_fallback=False 但 8 點皆為系統補齊）快照："
            f"{placeholder_snapshot_count}/{len(snapshots)}"
            f"（{placeholder_snapshot_count / len(snapshots):.2%}）＋ 見 docs/回測手冊.md TODO"
            if snapshots
            else ""
        )
    finally:
        db.close()


if __name__ == "__main__":
    main()
