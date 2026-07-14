from __future__ import annotations

import json
from dataclasses import asdict
from datetime import date, datetime, time, timedelta
from typing import Any

from sqlalchemy.orm import Session

from backtest import prediction_core_bridge
from crud import daily_price as daily_price_crud
from crud import trend_prediction as trend_crud
from models.cnyes_news import CnyesTWStockNews
from models.daily_price import DailyPrice
from models.trend_prediction import TrendPredictionSnapshot
from stock_behavior.orchestrator import compute_config_hash
from stock_behavior.scoring import (
    adjusted_return,
    get_dividend_factors,
    get_trading_dates_after,
)


StrategyConfig = prediction_core_bridge.StrategyConfig
PRICE_WINDOW_DAYS = 30
STOCK_NAMES = {
    "2330": "台積電",
    "2317": "鴻海",
    "2454": "聯發科",
    "2881": "富邦金",
    "2408": "南亞",
    "2615": "萬海",
}


def build_trend_config(
    strategy: StrategyConfig,
    *,
    horizon_days: int,
    price_window_days: int,
) -> dict[str, Any]:
    return {
        **asdict(strategy),
        "horizon_days": horizon_days,
        "price_window_days": price_window_days,
        "news_source": "cnyes_mysql",
    }


def get_price_records(
    db: Session,
    symbol: str,
    as_of: date,
    window: int = PRICE_WINDOW_DAYS,
) -> list[dict[str, Any]]:
    rows = (
        db.query(DailyPrice)
        .filter(
            DailyPrice.symbol == symbol,
            DailyPrice.date <= as_of,
            DailyPrice.close.isnot(None),
        )
        .order_by(DailyPrice.date.desc())
        .limit(window)
        .all()
    )
    if len(rows) < 2:
        return []
    return [
        {"date": row.date.isoformat(), "close": round(float(row.close), 2)}
        for row in reversed(rows)
    ]


def get_news_titles(
    db: Session,
    symbol: str,
    as_of: date,
    window_days: int,
    limit: int,
) -> list[str]:
    if limit <= 0:
        return []
    start = datetime.combine(as_of - timedelta(days=window_days), time.min)
    cutoff = datetime.combine(as_of, time(23, 59, 59))
    rows = (
        db.query(CnyesTWStockNews)
        .filter(
            CnyesTWStockNews.related_stocks.like(f"%{symbol}%"),
            CnyesTWStockNews.publish_time > start,
            CnyesTWStockNews.publish_time <= cutoff,
        )
        .order_by(CnyesTWStockNews.publish_time.desc())
        .all()
    )
    titles: list[str] = []
    seen: set[str] = set()
    for row in rows:
        title = row.title.strip()
        if not title or title in seen:
            continue
        seen.add(title)
        titles.append(title)
        if len(titles) >= limit:
            break
    return titles


def is_fallback_prediction(result: dict[str, Any]) -> bool:
    summary = str(result.get("summary") or "")
    return summary.startswith("AI 預測失敗") or summary == "AI 預測服務暫時無法使用。"


def make_openai_client(settings: Any):
    from openai import OpenAI

    return OpenAI(api_key=settings.NIM_API_KEY, base_url=settings.NIM_BASE_URL)


async def run_trend_point(
    db: Session,
    settings: Any,
    openai_client,
    *,
    symbol: str,
    as_of: date,
    strategy: StrategyConfig,
    horizon_days: int,
    run_kind: str = "backtest",
) -> TrendPredictionSnapshot | None:
    price_records = get_price_records(db, symbol, as_of, PRICE_WINDOW_DAYS)
    if not price_records:
        return None
    news_titles = get_news_titles(
        db,
        symbol,
        as_of,
        strategy.news_window_days,
        strategy.news_limit,
    )
    result = await prediction_core_bridge.generate_prediction(
        symbol,
        STOCK_NAMES.get(symbol, symbol),
        price_records,
        news_titles,
        strategy,
        openai_client,
    )
    config = build_trend_config(
        strategy,
        horizon_days=horizon_days,
        price_window_days=PRICE_WINDOW_DAYS,
    )
    return trend_crud.create_snapshot(
        db,
        symbol=symbol,
        as_of_date=as_of,
        run_kind=run_kind,
        strategy_name=strategy.name,
        config_hash=compute_config_hash(config),
        config_json=json.dumps(config, ensure_ascii=False, sort_keys=True),
        model_name=strategy.model_name,
        horizon_days=horizon_days,
        direction=str(result.get("direction") or "up"),
        change_pct_total=float(result.get("change_pct_total") or 0),
        confidence=int(result.get("confidence") or 1),
        summary=str(result.get("summary") or ""),
        news_count=int(result.get("news_count") or 0),
        last_price=result.get("last_price"),
        slope=result.get("slope"),
        prompt_used=result.get("prompt_used"),
        is_fallback=is_fallback_prediction(result),
    )


def score_trend_snapshot(db: Session, snapshot: TrendPredictionSnapshot) -> int:
    trading_dates = get_trading_dates_after(
        db,
        snapshot.symbol,
        snapshot.as_of_date,
        max_days=snapshot.horizon_days,
    )
    if len(trading_dates) < snapshot.horizon_days:
        return 0
    target_date = trading_dates[snapshot.horizon_days - 1]
    target_price = daily_price_crud.get_daily_price(db, snapshot.symbol, target_date)
    if target_price is None or target_price.close is None:
        return 0

    base_close = float(snapshot.last_price) if snapshot.last_price is not None else None
    if base_close is None:
        base_price = daily_price_crud.get_latest_price_on_or_before(
            db,
            snapshot.symbol,
            snapshot.as_of_date,
        )
        base_close = float(base_price.close) if base_price is not None and base_price.close is not None else None
    if not base_close:
        return 0

    actual_close = float(target_price.close)
    factors = get_dividend_factors(
        db,
        snapshot.symbol,
        snapshot.as_of_date,
        target_date,
    )
    actual_return = adjusted_return(base_close, actual_close, factors)
    actual_direction = "up" if actual_return >= 0 else "down"
    trend_crud.upsert_score(
        db,
        snapshot_id=snapshot.id,
        horizon_days=snapshot.horizon_days,
        target_date=target_date,
        base_close=base_close,
        actual_close=actual_close,
        adjusted_return=actual_return,
        direction_actual=actual_direction,
        direction_hit=snapshot.direction == actual_direction,
        abs_change_pct_error=abs(
            float(snapshot.change_pct_total) - actual_return * 100
        ),
    )
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
    return 1


def score_pending_trend_snapshots(
    db: Session,
    *,
    symbol: str | None = None,
    since: date | None = None,
    limit: int = 200,
) -> dict[str, int]:
    snapshots = trend_crud.get_unscored_snapshots(
        db,
        symbol=symbol,
        since=since,
        limit=limit,
    )
    scores_written = sum(score_trend_snapshot(db, snapshot) for snapshot in snapshots)
    return {"snapshots": len(snapshots), "scores_written": scores_written}
