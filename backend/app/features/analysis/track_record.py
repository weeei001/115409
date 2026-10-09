"""Score saved text-brief stances against the closes that followed them.

Only briefs generated within a few days of their analysis date count, so a later
historical re-run cannot grade itself with hindsight.
"""
from __future__ import annotations

from bisect import bisect_right
from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

from app.features.retrieval.common import TAIPEI
from . import repository
from .schemas import AITrackRecordResponse, TrackRecordHorizon, TrackRecordItem, TrackRecordOutcome

HORIZONS = (("short_1_5", 5), ("swing_6_20", 20), ("medium_21_40", 40))
UP_STANCES = {"bullish", "mildly_bullish"}
DOWN_STANCES = {"bearish", "mildly_bearish"}
LIVE_GENERATION_DAYS = 4
MAX_BASE_GAP_DAYS = 7
RECENT_LIMIT = 10
METHOD_NOTE = (
    "以 AI 摘要在分析基準日給出的各區間立場，對照基準日收盤到第 5、20、40 個交易日收盤的實際漲跌："
    "看多或偏多而上漲、看空或偏空而下跌算命中；中性、多空分歧、不確定不算方向判斷，不列入命中率。"
    "只計入基準日後 4 天內產生的摘要，排除事後重跑的歷史分析。"
    "「每次都猜漲」是同一批樣本中實際上漲的比例，用來比較 AI 是否優於單純看多。"
    "行情為未還原價格，除權息造成的價格下跌也算下跌。過去表現不代表未來結果。"
)


def _call(stance: str | None) -> str:
    return "up" if stance in UP_STANCES else "down" if stance in DOWN_STANCES else "none"


def _is_live(snapshot: dict) -> bool:
    created = snapshot.get("created_at")
    if not isinstance(created, datetime):
        return False
    return created.date() - snapshot["as_of_date"] <= timedelta(days=LIVE_GENERATION_DAYS)


def _latest_live(snapshots: list[dict]) -> list[dict]:
    # Drop re-runs before keeping the newest row per day, so a later re-run cannot hide the live brief.
    latest = {(item["symbol"], item["as_of_date"]): item for item in snapshots if _is_live(item)}
    return sorted(latest.values(), key=lambda item: (item["as_of_date"], item["symbol"]))


def _base_index(closes: list[tuple[date, float]], as_of: date) -> int | None:
    index = bisect_right([day for day, _ in closes], as_of) - 1
    if index < 0 or closes[index][1] <= 0 or (as_of - closes[index][0]).days > MAX_BASE_GAP_DAYS:
        return None
    return index


def _outcome(horizon: str, days: int, stance: str | None, closes: list[tuple[date, float]],
             base: int | None) -> TrackRecordOutcome:
    call = _call(stance)
    if base is None or base + days >= len(closes):
        return TrackRecordOutcome(horizon=horizon, stance=stance, call=call, return_pct=None, result="pending")
    change = closes[base + days][1] / closes[base][1] - 1
    if call == "none":
        result = "no_call"
    else:
        result = "hit" if (change > 0 if call == "up" else change < 0) else "miss"
    return TrackRecordOutcome(horizon=horizon, stance=stance, call=call,
                              return_pct=round(change * 100, 2), result=result)


def evaluate(snapshots: list[dict], series: dict[str, list[tuple[date, float]]]
             ) -> tuple[list[TrackRecordItem], list[TrackRecordHorizon]]:
    items: list[TrackRecordItem] = []
    for snapshot in snapshots:
        closes = series.get(snapshot["symbol"], [])
        base = _base_index(closes, snapshot["as_of_date"])
        items.append(TrackRecordItem(
            symbol=snapshot["symbol"], as_of_date=snapshot["as_of_date"].isoformat(),
            overall_stance=snapshot.get("overall"),
            outcomes=[_outcome(key, days, snapshot.get(key), closes, base) for key, days in HORIZONS],
        ))
    horizons = []
    for position, (key, days) in enumerate(HORIZONS):
        outcomes = [item.outcomes[position] for item in items]
        judged = [outcome for outcome in outcomes if outcome.result in {"hit", "miss"}]
        hits = sum(outcome.result == "hit" for outcome in judged)
        rises = sum((outcome.return_pct or 0) > 0 for outcome in judged)
        horizons.append(TrackRecordHorizon(
            horizon=key, trading_days=days, directional_calls=len(judged), hits=hits,
            hit_rate=round(hits / len(judged), 4) if judged else None,
            up_baseline_rate=round(rises / len(judged), 4) if judged else None,
            no_call=sum(outcome.result == "no_call" for outcome in outcomes),
            pending=sum(outcome.result == "pending" for outcome in outcomes),
        ))
    return items, horizons


def track_record(db: Session, *, symbol: str | None, days: int, today: date | None = None) -> AITrackRecordResponse:
    today = today or datetime.now(TAIPEI).date()
    since = today - timedelta(days=days)
    snapshots = _latest_live(repository.track_record_snapshots(db, symbol=symbol, since=since))
    series = repository.close_series(db, {item["symbol"] for item in snapshots},
                                     since - timedelta(days=MAX_BASE_GAP_DAYS))
    items, horizons = evaluate(snapshots, series)
    return AITrackRecordResponse(symbol=symbol, days=days, window_start=since.isoformat(),
                                 snapshot_count=len(items), horizons=horizons,
                                 recent=list(reversed(items[-RECENT_LIMIT:])), method_note=METHOD_NOTE)
