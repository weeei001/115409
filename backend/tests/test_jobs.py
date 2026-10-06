import asyncio
import importlib
from datetime import date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.db.models.daily_price import DailyPrice
from app.db.models.stock_info import StockInfo
from app.db.models.technical_indicator import TechnicalIndicator
from app.jobs.__main__ import main
from app.jobs.indicators import recompute


def test_indicators_preserve_lookback_rounding_and_upsert(db_session):
    start = date(2026, 5, 1)
    db_session.add_all([
        DailyPrice(symbol="2330", date=start + timedelta(days=i), close=Decimal(100 + i),
                   high=Decimal(102 + i), low=Decimal(98 + i), volume_shares=1000)
        for i in range(25)
    ])
    db_session.commit()
    assert recompute(db_session, "2330", start + timedelta(days=24)) == 1
    row = db_session.scalar(select(TechnicalIndicator))
    assert row.ma5 == Decimal("122.00") and row.ma20 == Decimal("114.50")
    assert row.rsi5 == Decimal("100.00") and row.ma60 is None
    assert row.volume_ma5 == Decimal("1000.00")
    assert recompute(db_session, "2330", start + timedelta(days=24)) == 1
    assert len(list(db_session.scalars(select(TechnicalIndicator)))) == 1


@pytest.mark.parametrize("command,module,entry,prefix", [
    ("crawl-cnyes", "app.jobs.crawlers", "crawler_main", ("cnyes",)),
    ("crawl-ltn", "app.jobs.crawlers", "crawler_main", ("ltn",)),
    ("market-fetch", "app.jobs.market.fetch", "main", ()),
    ("market-import", "app.jobs.market.import_csv", "main", ()),
    ("stock-info-sync", "app.jobs.market.stock_info", "main", ()),
    ("chunk-news", "app.jobs.ingestion.cli", "main", ("chunk-news",)),
    ("vectorize-news", "app.jobs.ingestion.cli", "main", ("vectorize-news",)),
    ("news-ingest", "app.jobs.ingestion.cli", "main", ("news-ingest",)),
    ("scheduler", "app.jobs.scheduler", "main", ()),
    ("legacy-scheduler", "app.jobs.scheduler", "main", ()),
    ("methodology-train", "app.jobs.research.methodology_trainer", "main", ()),
    ("backtest-learned", "app.jobs.research.backtest_learned_prompt", "main", ()),
])
def test_workers_dispatch_to_native_modules_with_compatible_arguments(monkeypatch, command, module, entry, prefix):
    calls = []
    monkeypatch.setattr(importlib.import_module(module), entry, lambda *args: calls.append(args) or 7)
    assert main([command, "--help"]) == 7
    assert main([command, "--", "--help"]) == 7
    assert calls == [(*prefix, ["--help"])] * 2


def test_worker_failure_is_nonzero_and_does_not_echo_private_data(monkeypatch, capsys):
    def fail(*args):
        raise RuntimeError("secret SQL password upstream token")
    monkeypatch.setattr("app.jobs.__main__.dispatch", fail)
    assert main(["news-ingest"]) == 1
    assert capsys.readouterr().err == "news-ingest failed (RuntimeError)\n"


def test_worker_exception_keeps_safe_diagnostic_and_invalid_arguments_still_raise(monkeypatch, tmp_path):
    from app.jobs.diagnostics import DIAGNOSTICS_ENV, read_failure
    target = tmp_path / "failure.json"
    monkeypatch.setenv(DIAGNOSTICS_ENV, str(target))
    def fail(*args):
        raise RuntimeError("private SQL password")
    monkeypatch.setattr("app.jobs.__main__.dispatch", fail)
    assert main(["news-ingest"]) == 1
    assert read_failure(target) == {"phase": "dispatch", "reason": "worker_exception", "error_type": "RuntimeError"}
    def invalid(*args):
        raise SystemExit(2)
    monkeypatch.setattr("app.jobs.__main__.dispatch", invalid)
    with pytest.raises(SystemExit) as error:
        main(["news-impact-batch"])
    assert error.value.code == 2
    assert read_failure(target) == {"phase": "arguments", "reason": "invalid_arguments"}


def test_cache_warmup_uses_trading_dates_isolated_sessions_and_reports_failures(db_session, settings, monkeypatch):
    from app.jobs import warmup

    start = date(2026, 5, 1)
    db_session.add_all([DailyPrice(symbol="2330", date=start + timedelta(days=i), close=Decimal(100)) for i in range(3)])
    db_session.commit()
    engine = db_session.get_bind()
    monkeypatch.setattr(warmup, "get_settings", lambda: settings)
    monkeypatch.setattr(warmup, "make_engine", lambda configured: engine)
    sessions, requests = [], []

    class Analysis:
        def __init__(self, *, db, settings, http, session_factory):
            sessions.append(db)

        async def generate_text_brief(self, request, *, refresh_sources=False):
            assert refresh_sources
            requests.append(request)
            return SimpleNamespace(status="verified" if len(requests) == 1 else "unavailable", cached=False)

    monkeypatch.setattr(warmup, "AnalysisService", Analysis)
    assert asyncio.run(warmup.warm(["2330", "missing"], start, start + timedelta(days=1))) == 1
    assert [request.as_of_date for request in requests] == [start, start + timedelta(days=1)]
    assert all(not request.force_refresh for request in requests)
    assert len(sessions) == 2 and sessions[0] is not sessions[1]


def test_cache_warmup_defaults_to_stock_info_symbols(db_session, settings, monkeypatch):
    from app.jobs import warmup
    from sqlalchemy.orm import sessionmaker

    day = date(2026, 5, 1)
    db_session.add_all([
        StockInfo(symbol="1101", name="台泥"),
        DailyPrice(symbol="1101", date=day, close=Decimal("100")),
        StockInfo(symbol="2330", name="台積電"),
        DailyPrice(symbol="2330", date=day, close=Decimal("100")),
    ])
    db_session.commit()
    engine = db_session.get_bind()
    monkeypatch.setattr(warmup, "get_settings", lambda: settings)
    monkeypatch.setattr(warmup, "make_engine", lambda configured: engine)
    requests = []

    async def capture(self, request, *, refresh_sources=False):
        requests.append(request.symbol)
        return SimpleNamespace(status="verified", cached=False)

    class Analysis:
        def __init__(self, **kwargs):
            pass

        generate_text_brief = capture

    monkeypatch.setattr(warmup, "AnalysisService", Analysis)
    factory = sessionmaker(bind=engine)
    assert warmup.stock_info_symbols(factory) == ["1101", "2330"]
    assert asyncio.run(warmup.warm(None, day, day)) == 0
    assert requests == ["1101", "2330"]


def test_stock_info_sync_upserts_catalog_names(db_session):
    from app.jobs.market.stock_info import SUPPORTED_SYMBOLS, sync_catalog

    db_session.add(StockInfo(symbol="1101", name="old"))
    db_session.commit()
    catalog = {symbol: {"name": symbol} for symbol in SUPPORTED_SYMBOLS}
    catalog.update({
        "1101": {"name": "台泥", "industry_name": "水泥工業"},
        "2330": {"name": "台積電", "industry_name": "半導體業"},
        "2618": {"name": "長榮航", "industry_name": "航運業"},
    })
    assert len(set(SUPPORTED_SYMBOLS)) == 40
    assert sync_catalog(db_session, catalog) == 40
    db_session.commit()
    assert db_session.get(StockInfo, "1101").name == "台泥"
    assert db_session.get(StockInfo, "2330").industry == "半導體業"
    assert set(db_session.scalars(select(StockInfo.symbol))) == set(SUPPORTED_SYMBOLS)
    assert "2618" in catalog
    assert sync_catalog(db_session, catalog) == 40
    db_session.flush()
    assert len(list(db_session.scalars(select(StockInfo.symbol)))) == 40


def test_stock_info_sync_rejects_incomplete_catalog_before_updates(db_session):
    from app.jobs.market.stock_info import SUPPORTED_SYMBOLS, sync_catalog

    db_session.add(StockInfo(symbol="1101", name="original"))
    db_session.commit()
    catalog = {symbol: {"name": "changed"} for symbol in SUPPORTED_SYMBOLS if symbol != "2330"}
    with pytest.raises(ValueError, match="missing supported symbols: 2330"):
        sync_catalog(db_session, catalog)
    assert db_session.get(StockInfo, "1101").name == "original"
    assert list(db_session.scalars(select(StockInfo.symbol))) == ["1101"]


def test_undated_warmup_uses_today_so_weekend_news_is_included(db_session, monkeypatch):
    from app.jobs import warmup
    from sqlalchemy.orm import sessionmaker

    today = datetime(2026, 7, 19, 10)
    monkeypatch.setattr(warmup, "datetime", SimpleNamespace(now=lambda tz: today))
    db_session.add(DailyPrice(symbol="2330", date=date(2026, 7, 17), close=Decimal("100")))
    db_session.commit()
    factory = sessionmaker(bind=db_session.get_bind())
    assert warmup.as_of_dates(factory, "2330", None, None) == [today.date()]
    assert warmup.as_of_dates(factory, "missing", None, None) == []
    assert warmup.as_of_dates(factory, "2330", date(2026, 7, 17), today.date()) == [date(2026, 7, 17)]


def test_removed_sentiment_worker_is_rejected_before_dispatch(monkeypatch):
    monkeypatch.setattr("app.jobs.__main__.dispatch", lambda *_: pytest.fail("No dispatch"))
    with pytest.raises(SystemExit) as result:
        main(["sentiment-batch", "--execute"])
    assert result.value.code == 2


@pytest.mark.parametrize("cancel_run", [False, True])
def test_warmup_timeout_and_cancellation_release_resources(settings, monkeypatch, cancel_run):
    from contextlib import asynccontextmanager
    from app.jobs import warmup

    events = []
    class Session:
        def rollback(self):
            events.append("rollback")
        def close(self):
            events.append("close")
    class Engine:
        def dispose(self):
            events.append("dispose")
    @asynccontextmanager
    async def client(_):
        try:
            yield object()
        finally:
            events.append("http-close")
    class Analysis:
        def __init__(self, **kwargs):
            pass
        async def generate_text_brief(self, request, **kwargs):
            events.append(request.symbol)
            if request.symbol == "2317":
                return SimpleNamespace(status="verified", cached=False)
            try:
                if cancel_run:
                    raise asyncio.CancelledError
                await asyncio.Event().wait()
            finally:
                events.append("analysis-cleanup")

    settings.JOBS_BRIEF_TIMEOUT_SECONDS = 0.01
    monkeypatch.setattr(warmup, "get_settings", lambda: settings)
    monkeypatch.setattr(warmup, "make_engine", lambda _: Engine())
    monkeypatch.setattr(warmup, "make_session_factory", lambda _: Session)
    monkeypatch.setattr(warmup, "make_http_client", client)
    monkeypatch.setattr(warmup, "as_of_dates", lambda *args: [date(2026, 1, 1)])
    monkeypatch.setattr(warmup, "AnalysisService", Analysis)
    if cancel_run:
        with pytest.raises(asyncio.CancelledError):
            asyncio.run(warmup.warm(["2330", "2317"], None, None))
        assert events == ["2330", "analysis-cleanup", "close", "http-close", "dispose"]
    else:
        assert asyncio.run(warmup.warm(["2330", "2317"], None, None)) == 1
        assert events == ["2330", "analysis-cleanup", "rollback", "close", "2317", "close", "http-close", "dispose"]



@pytest.mark.parametrize("value", [0, -1, float("nan"), float("inf")])
def test_brief_warmup_timeout_must_be_positive_and_finite(value):
    from pydantic import ValidationError
    from app.core.config import Settings

    with pytest.raises(ValidationError):
        Settings(_env_file=None, JOBS_BRIEF_TIMEOUT_SECONDS=value)
