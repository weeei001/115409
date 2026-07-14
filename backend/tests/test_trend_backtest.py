import asyncio
import json
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backtest import prediction_core_bridge
from backtest.prediction_core_bridge import StrategyConfig, generate_prediction
from backtest.trend_backtest import (
    get_news_titles,
    is_fallback_prediction,
    run_trend_point,
    score_pending_trend_snapshots,
    score_trend_snapshot,
)
from database import Base
from models.cnyes_news import CnyesTWStockNews
from models.daily_price import DailyPrice
from models.finmind_extra import DividendResult
from models.trend_prediction import TrendPredictionScore, TrendPredictionSnapshot


def _session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return engine, sessionmaker(bind=engine)()


def _trading_dates(start: date, count: int) -> list[date]:
    dates: list[date] = []
    current = start
    while len(dates) < count:
        if current.weekday() < 5:
            dates.append(current)
        current += timedelta(days=1)
    return dates


def test_prediction_core_bridge_imports():
    assert StrategyConfig(name="test").news_limit == 20
    assert callable(generate_prediction)


def test_get_news_titles_filters_deduplicates_and_limits():
    engine, db = _session()
    try:
        as_of = date(2024, 1, 31)
        created_at = datetime(2024, 2, 1)
        rows = [
            (1, "最新消息", "2330,2317", datetime(2024, 1, 31, 20)),
            (2, "重複標題", "2330", datetime(2024, 1, 30, 12)),
            (3, "重複標題", "2330", datetime(2024, 1, 29, 12)),
            (4, "第三則", "2330", datetime(2024, 1, 28, 12)),
            (5, "視窗外", "2330", datetime(2024, 1, 1, 0)),
            (6, "別檔新聞", "2317", datetime(2024, 1, 31, 21)),
            (7, "未來新聞", "2330", datetime(2024, 2, 1, 0)),
        ]
        db.add_all(
            CnyesTWStockNews(
                id=row_id,
                news_id=1000 + row_id,
                title=title,
                related_stocks=related_stocks,
                publish_time=publish_time,
                created_at=created_at,
            )
            for row_id, title, related_stocks, publish_time in rows
        )
        db.commit()

        assert get_news_titles(db, "2330", as_of, 30, 2) == [
            "最新消息",
            "重複標題",
        ]
        assert get_news_titles(db, "2330", as_of, 30, 10) == [
            "最新消息",
            "重複標題",
            "第三則",
        ]
        assert get_news_titles(db, "2330", as_of, 30, 0) == []
    finally:
        db.close()
        engine.dispose()


def test_trend_prediction_scoring_end_to_end(monkeypatch):
    engine, db = _session()
    try:
        dates = _trading_dates(date(2024, 1, 2), 55)
        closes = [80 + index for index in range(55)]
        db.add_all(
            DailyPrice(symbol="2330", date=trading_date, close=close)
            for trading_date, close in zip(dates, closes)
        )
        as_of = dates[29]
        horizon_days = 20
        dividend_date = dates[39]
        db.add(
            DividendResult(
                symbol="2330",
                date=dividend_date,
                before_price=110,
                reference_price=104.5,
            )
        )
        db.commit()

        async def fake_generate_prediction(
            stock_id,
            stock_name,
            price_records,
            news_titles,
            strategy,
            openai_client,
        ):
            assert stock_id == "2330"
            assert stock_name == "台積電"
            assert len(price_records) == 30
            return {
                "direction": "up",
                "change_pct_total": 3.0,
                "confidence": 4,
                "summary": "固定測試預測",
                "regression_history": [],
                "slope": 0.5,
                "last_price": price_records[-1]["close"],
                "prompt_used": "test prompt",
                "news_count": len(news_titles),
            }

        monkeypatch.setattr(
            prediction_core_bridge,
            "generate_prediction",
            fake_generate_prediction,
        )
        strategy = StrategyConfig(name="integration")
        snapshot = asyncio.run(
            run_trend_point(
                db,
                None,
                object(),
                symbol="2330",
                as_of=as_of,
                strategy=strategy,
                horizon_days=horizon_days,
            )
        )
        assert snapshot is not None
        assert snapshot.strategy_name == "integration"
        assert snapshot.direction == "up"
        assert snapshot.confidence == 4
        assert snapshot.is_fallback is False
        assert json.loads(snapshot.config_json)["news_source"] == "cnyes_mysql"
        assert float(snapshot.last_price) == closes[29]

        assert score_trend_snapshot(db, snapshot) == 1
        score = db.query(TrendPredictionScore).one()
        expected_return = closes[49] / (closes[29] * (104.5 / 110)) - 1
        assert score.target_date == dates[49]
        assert float(score.adjusted_return) == pytest.approx(expected_return, abs=1e-6)
        assert score.direction_actual == "up"
        assert score.direction_hit is True
        assert float(score.abs_change_pct_error) == pytest.approx(
            abs(3.0 - expected_return * 100),
            abs=1e-3,
        )

        assert score_trend_snapshot(db, snapshot) == 1
        assert db.query(TrendPredictionScore).count() == 1

        pending_snapshot = asyncio.run(
            run_trend_point(
                db,
                None,
                object(),
                symbol="2330",
                as_of=as_of,
                strategy=strategy,
                horizon_days=horizon_days,
            )
        )
        assert pending_snapshot is not None
        assert score_pending_trend_snapshots(db) == {
            "snapshots": 1,
            "scores_written": 1,
        }
        assert db.query(TrendPredictionScore).count() == 2

        immature_snapshot = asyncio.run(
            run_trend_point(
                db,
                None,
                object(),
                symbol="2330",
                as_of=dates[44],
                strategy=strategy,
                horizon_days=horizon_days,
            )
        )
        assert immature_snapshot is not None
        assert score_trend_snapshot(db, immature_snapshot) == 0
        assert (
            db.query(TrendPredictionScore)
            .filter(TrendPredictionScore.snapshot_id == immature_snapshot.id)
            .count()
            == 0
        )
        assert db.query(TrendPredictionSnapshot).count() == 3
    finally:
        db.close()
        engine.dispose()


@pytest.mark.parametrize(
    ("summary", "expected"),
    [
        ("一般預測", False),
        ("AI 預測失敗：timeout", True),
        ("AI 預測服務暫時無法使用。", True),
    ],
)
def test_is_fallback_prediction(summary, expected):
    assert is_fallback_prediction({"summary": summary}) is expected
