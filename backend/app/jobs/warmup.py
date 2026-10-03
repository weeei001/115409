"""Populate analysis snapshots explicitly, one session per work item."""
import asyncio
from datetime import date, datetime
import logging

from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.http import make_http_client
from app.db.models.daily_price import DailyPrice
from app.db.models.stock_info import StockInfo
from app.db.engine import make_engine, make_session_factory
from app.features.analysis.schemas import StockBehaviorTextBriefRequest
from app.features.analysis.service import AnalysisService
from app.features.retrieval.common import TAIPEI


def as_of_dates(session_factory, symbol: str, start: date | None, end: date | None) -> list[date]:
    with session_factory() as db:
        if start is None and end is None:
            today = datetime.now(TAIPEI).date()
            latest = db.scalar(select(func.max(DailyPrice.date)).where(
                DailyPrice.symbol == symbol, DailyPrice.date <= today))
            return [today] if latest else []
        statement = select(DailyPrice.date).where(DailyPrice.symbol == symbol)
        if start is not None:
            statement = statement.where(DailyPrice.date >= start)
        if end is not None:
            statement = statement.where(DailyPrice.date <= end)
        return list(db.scalars(statement.order_by(DailyPrice.date)))


def stock_info_symbols(session_factory) -> list[str]:
    with session_factory() as db:
        return list(db.scalars(select(StockInfo.symbol).order_by(StockInfo.symbol)))


async def warm(symbols: list[str] | None, start: date | None, end: date | None) -> int:
    settings = get_settings()
    engine = make_engine(settings)
    session_factory = make_session_factory(engine)
    failures = 0
    try:
        if symbols is None:
            symbols = await asyncio.to_thread(stock_info_symbols, session_factory)
        async with make_http_client(settings) as http:
            for symbol in symbols:
                dates = await asyncio.to_thread(as_of_dates, session_factory, symbol, start, end)
                if not dates:
                    failures += 1
                    print(f"symbol={symbol} result=skipped reason=no_price_data")
                for day in dates:
                    db = session_factory()
                    try:
                        print(f"symbol={symbol} as_of={day} result=started", flush=True)
                        result = await asyncio.wait_for(
                            AnalysisService(db=db, settings=settings, http=http,
                                session_factory=session_factory).generate_text_brief(
                                StockBehaviorTextBriefRequest(symbol=symbol, as_of_date=day), refresh_sources=True
                            ), timeout=settings.JOBS_BRIEF_TIMEOUT_SECONDS
                        )
                        print(f"symbol={symbol} as_of={day} result={result.status} cached={result.cached}")
                        if result.status == "unavailable":
                            failures += 1
                    except Exception as exc:
                        failures += 1
                        await asyncio.to_thread(db.rollback)
                        logging.getLogger(__name__).error("Analysis failed for %s (%s)", symbol, type(exc).__name__)
                    finally:
                        await asyncio.to_thread(db.close)
    finally:
        await asyncio.to_thread(engine.dispose)
    return 1 if failures else 0
