from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from crud.analysis_snapshot import create_snapshot
from database import Base
from models.analysis_snapshot import StockBehaviorAnalysisSnapshot


def test_analysis_snapshot_tables_work_with_sqlite():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    try:
        row = create_snapshot(
            db,
            symbol="2330",
            as_of_date=date(2024, 1, 2),
            run_kind="backtest",
            config_hash="a" * 64,
            config_json="{}",
        )

        assert row.id == 1
        assert db.query(StockBehaviorAnalysisSnapshot).one().symbol == "2330"
    finally:
        db.close()
