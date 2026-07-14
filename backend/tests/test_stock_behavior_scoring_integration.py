import json
from datetime import date, timedelta

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from database import Base
from models.analysis_snapshot import (
    StockBehaviorAnalysisSnapshot,
    StockBehaviorProjectionScore,
)
from models.daily_price import DailyPrice
from models.finmind_extra import DividendResult
from stock_behavior.scoring import score_pending_snapshots, score_snapshot


def test_projection_scoring_end_to_end():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    try:
        as_of = date(2024, 1, 1)
        trading_dates = []
        current = as_of
        while len(trading_dates) < 45:
            current += timedelta(days=1)
            if current.weekday() < 5:
                trading_dates.append(current)

        db.add_all(
            DailyPrice(
                symbol="2330",
                date=trading_date,
                close=100 + index,
            )
            for index, trading_date in enumerate(trading_dates, start=1)
        )
        db.add(
            DividendResult(
                symbol="2330",
                date=trading_dates[20],
                before_price=110,
                reference_price=104.5,
            )
        )

        projection = {
            "base_close": 100,
            "points": [
                {
                    "day": day,
                    "predicted_close": None if day == 20 else 100 + day,
                    "direction": (
                        "down" if day == 10 else "uncertain" if day == 15 else "up"
                    ),
                }
                for day in range(5, 41, 5)
            ],
        }
        snapshot = StockBehaviorAnalysisSnapshot(
            symbol="2330",
            as_of_date=as_of,
            run_kind="backtest",
            config_hash="a" * 64,
            config_json="{}",
            public_projection_json=json.dumps(projection),
        )
        db.add(snapshot)
        db.commit()

        dividend_queries = []

        def count_dividend_queries(conn, cursor, statement, parameters, context, executemany):
            if "FROM fm_dividend_results" in statement:
                dividend_queries.append(statement)

        event.listen(engine, "before_cursor_execute", count_dividend_queries)
        assert score_snapshot(db, snapshot) == 8
        event.remove(engine, "before_cursor_execute", count_dividend_queries)
        assert len(dividend_queries) == 1

        scores = {
            score.day: score
            for score in db.query(StockBehaviorProjectionScore)
            .filter(StockBehaviorProjectionScore.snapshot_id == snapshot.id)
            .all()
        }
        assert len(scores) == 8
        for day, score in scores.items():
            assert score.target_date == trading_dates[day - 1]

        assert float(scores[25].adjusted_return) == pytest.approx(
            125 / (100 * (104.5 / 110)) - 1,
            abs=1e-6,
        )
        assert scores[5].direction_hit is True
        assert scores[10].direction_hit is False
        assert scores[15].direction_hit is None
        assert scores[20].abs_pct_error is None
        assert all(not scores[day].ex_dividend_between for day in (5, 10, 15, 20))
        assert all(scores[day].ex_dividend_between for day in (25, 30, 35, 40))

        assert score_snapshot(db, snapshot) == 8
        assert (
            db.query(StockBehaviorProjectionScore)
            .filter(StockBehaviorProjectionScore.snapshot_id == snapshot.id)
            .count()
            == 8
        )

        pending_snapshot = StockBehaviorAnalysisSnapshot(
            symbol="2330",
            as_of_date=as_of,
            run_kind="backtest",
            config_hash="b" * 64,
            config_json="{}",
            public_projection_json=json.dumps(projection),
        )
        db.add(pending_snapshot)
        db.commit()

        assert score_pending_snapshots(db) == {"snapshots": 1, "points_written": 8}
        assert (
            db.query(StockBehaviorProjectionScore)
            .filter(StockBehaviorProjectionScore.snapshot_id == pending_snapshot.id)
            .count()
            == 8
        )
    finally:
        db.close()
        engine.dispose()
