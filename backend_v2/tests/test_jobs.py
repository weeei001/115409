import asyncio
import importlib
from datetime import date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.db.models.daily_price import DailyPrice
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
    ("finmind-fetch", "app.jobs.finmind.fetch", "main", ()),
    ("finmind-import", "app.jobs.finmind.import_csv", "main", ()),
    ("sentiment-batch", "app.jobs.sentiment.cli", "main", ()),
    ("chunk-news", "app.jobs.ingestion.cli", "main", ("chunk-news",)),
    ("vectorize-news", "app.jobs.ingestion.cli", "main", ("vectorize-news",)),
    ("news-ingest", "app.jobs.ingestion.cli", "main", ("news-ingest",)),
    ("scheduler", "app.jobs.scheduler", "main", ()),
    ("legacy-scheduler", "app.jobs.scheduler", "main", ()),
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
        def __init__(self, *, db, settings, http):
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
