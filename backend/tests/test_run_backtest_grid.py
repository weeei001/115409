import asyncio
import hashlib
import json
from argparse import Namespace
from datetime import date
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from crud.analysis_snapshot import count_snapshots
from database import Base
from models.analysis_snapshot import (
    StockBehaviorAnalysisSnapshot,
    StockBehaviorBacktestRun,
)
from models.daily_price import DailyPrice
from scripts.run_backtest import (
    build_backtest_grid,
    plan_backtest_grid,
    run_backtest,
)
from stock_behavior.orchestrator import build_analysis_config, compute_config_hash


def test_weekly_grid_resume_and_keyless_dry_run():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    try:
        trading_dates = [
            date(2024, 1, 2),
            date(2024, 1, 3),
            date(2024, 1, 5),
            date(2024, 1, 8),
            date(2024, 1, 10),
        ]
        db.add_all(
            DailyPrice(symbol="2330", date=trading_date, close=100 + index)
            for index, trading_date in enumerate(trading_dates)
        )
        config_hash = "c" * 64
        db.add_all(
            StockBehaviorAnalysisSnapshot(
                symbol="2330",
                as_of_date=date(2024, 1, 5),
                run_kind="backtest",
                config_hash=config_hash,
                config_json="{}",
            )
            for _ in range(2)
        )
        db.commit()

        grid = build_backtest_grid(
            db,
            symbols=["2330"],
            date_start=date(2024, 1, 1),
            date_end=date(2024, 1, 10),
            freq="weekly",
        )
        assert grid == {"2330": [date(2024, 1, 5), date(2024, 1, 10)]}
        assert count_snapshots(
            db,
            symbol="2330",
            as_of_date=date(2024, 1, 5),
            config_hash=config_hash,
            run_kind="backtest",
        ) == 2

        repeats_one = plan_backtest_grid(
            db,
            grid={"2330": [date(2024, 1, 5)]},
            config_hash=config_hash,
            repeats=1,
        )
        assert repeats_one == {"pending": [], "skipped": 1}
        repeats_three = plan_backtest_grid(
            db,
            grid={"2330": [date(2024, 1, 5)]},
            config_hash=config_hash,
            repeats=3,
        )
        assert repeats_three == {
            "pending": [("2330", date(2024, 1, 5), 3)],
            "skipped": 0,
        }

        settings = SimpleNamespace(
            NIM_API_KEY="",
            NIM_BASE_URL="",
            ADVISOR_LLM_MODEL="test-model",
            ADVISOR_LLM_TEMPERATURE=0.2,
            ADVISOR_LLM_MAX_COMPLETION_TOKENS=4096,
            ADVISOR_LLM_RESPONSE_FORMAT="off",
        )
        config = build_analysis_config(settings, "test-model")
        assert config["model_name"] == "test-model"
        assert config["max_completion_tokens"] == 4096
        assert config["response_format"] == "off"
        assert config["parser_version"] == "strict-root-v1"
        canonical = json.dumps(config, ensure_ascii=False, sort_keys=True)
        assert compute_config_hash(config) == hashlib.sha256(canonical.encode()).hexdigest()
        assert compute_config_hash(config) != compute_config_hash(
            {**config, "max_completion_tokens": 8192}
        )

        result = asyncio.run(
            run_backtest(
                db,
                settings,
                Namespace(
                    symbols="2330",
                    start=date(2024, 1, 1),
                    end=date(2024, 1, 10),
                    freq="weekly",
                    repeats=1,
                    dry_run=True,
                ),
            )
        )
        assert result["grid"] == grid
        assert db.query(StockBehaviorBacktestRun).count() == 0
    finally:
        db.close()
        engine.dispose()
