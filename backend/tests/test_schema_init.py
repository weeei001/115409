import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.db.models.stock_info import StockInfo
from app.jobs.schema import main


@pytest.mark.parametrize("arguments, code", [(["--help"], 0), (["--reset"], 2)])
def test_help_and_invalid_flags_never_connect(monkeypatch, arguments, code):
    def forbidden(*args):
        raise AssertionError("Must not connect")
    monkeypatch.setattr("app.db.engine.make_engine", forbidden)
    with pytest.raises(SystemExit) as result:
        main(arguments)
    assert result.value.code == code


def test_explicit_catalog_sync_uses_fetched_directory(monkeypatch):
    from app.jobs.market.stock_info import SUPPORTED_SYMBOLS

    engine = create_engine("sqlite://")
    monkeypatch.setattr("app.db.engine.make_engine", lambda settings: engine)
    monkeypatch.setattr(engine, "dispose", lambda: None)
    calls = []
    def refresh():
        calls.append(True)
        return {symbol: {"name": "TSMC" if symbol == "2330" else symbol,
                         "industry_name": "Semiconductors"}
                for symbol in (*SUPPORTED_SYMBOLS, "2618")}
    monkeypatch.setattr("app.features.market.company_catalog.refresh_catalog", refresh)
    assert main([]) == 0
    assert not calls
    assert main(["--sync-catalog"]) == 0
    assert calls == [True]
    with Session(engine) as db:
        assert db.get(StockInfo, "2330").industry == "Semiconductors"
        assert set(db.scalars(select(StockInfo.symbol))) == set(SUPPORTED_SYMBOLS)
    monkeypatch.setattr("app.features.market.company_catalog.refresh_catalog", lambda: {})
    with pytest.raises(ValueError, match="catalog"):
        main(["--sync-catalog"])
    with Session(engine) as db:
        assert db.get(StockInfo, "2330").name == "TSMC"
