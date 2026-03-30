"""Parallel data fetcher — runs DB queries and news retrieval concurrently."""

from __future__ import annotations

import asyncio
import logging
from datetime import date
from functools import partial

from agent.news_adapter import fetch_from_rag_api
from agent.schemas import FetchedData, NormalizedNewsChunk, ParsedIntent
from config import get_settings
from crud import daily_price as crud_price
from crud import technical_indicator as crud_indicator
from crud.institutional_trade import get_by_symbol_range as crud_inst_range
from database import SessionLocal

logger = logging.getLogger(__name__)


def _price_to_dict(p) -> dict:
    return {
        "date": p.date.isoformat() if p.date else "",
        "open": float(p.open) if p.open is not None else None,
        "high": float(p.high) if p.high is not None else None,
        "low": float(p.low) if p.low is not None else None,
        "close": float(p.close) if p.close is not None else None,
        "volume": int(p.volume_shares) if p.volume_shares is not None else None,
        "change": float(p.change) if p.change is not None else None,
    }


def _indicator_to_dict(i) -> dict:
    return {
        "date": i.date.isoformat() if i.date else "",
        "ma5": float(i.ma5) if i.ma5 is not None else None,
        "ma10": float(i.ma10) if i.ma10 is not None else None,
        "ma20": float(i.ma20) if i.ma20 is not None else None,
        "ma60": float(i.ma60) if i.ma60 is not None else None,
        "k_value": float(i.k_value) if i.k_value is not None else None,
        "d_value": float(i.d_value) if i.d_value is not None else None,
        "rsi14": float(i.rsi14) if i.rsi14 is not None else None,
        "macd": float(i.macd) if i.macd is not None else None,
        "macd_signal": float(i.macd_signal) if i.macd_signal is not None else None,
        "macd_hist": float(i.macd_hist) if i.macd_hist is not None else None,
        "bb_upper": float(i.bb_upper) if i.bb_upper is not None else None,
        "bb_middle": float(i.bb_middle) if i.bb_middle is not None else None,
        "bb_lower": float(i.bb_lower) if i.bb_lower is not None else None,
    }


def _inst_to_dict(t) -> dict:
    return {
        "date": t.date.isoformat() if t.date else "",
        "foreign_net": int(t.foreign_excl_dealer_net or 0) + int(t.foreign_dealer_net or 0),
        "trust_net": int(t.investment_trust_net or 0),
        "dealer_net": int(t.dealer_net_total or 0),
        "total_net": int(t.total_net or 0),
    }


# ── Each query gets its own Session so they can run in parallel threads ──

def _fetch_prices(symbol: str, start: date, end: date) -> list[dict]:
    db = SessionLocal()
    try:
        rows = crud_price.get_price_range(db, symbol, start, end)
        return [_price_to_dict(p) for p in rows]
    except Exception:
        logger.exception("Failed to fetch prices for %s", symbol)
        return []
    finally:
        db.close()


def _fetch_indicators(symbol: str, start: date, end: date) -> list[dict]:
    db = SessionLocal()
    try:
        rows = crud_indicator.get_indicators(db, symbol, start, end)
        return [_indicator_to_dict(i) for i in rows]
    except Exception:
        logger.exception("Failed to fetch indicators for %s", symbol)
        return []
    finally:
        db.close()


def _fetch_institutional(symbol: str, start: date, end: date) -> list[dict]:
    db = SessionLocal()
    try:
        rows = crud_inst_range(db, symbol, start, end)
        return [_inst_to_dict(t) for t in rows]
    except Exception:
        logger.exception("Failed to fetch institutional data for %s", symbol)
        return []
    finally:
        db.close()


async def _fetch_news(
    intent: ParsedIntent,
) -> tuple[list[NormalizedNewsChunk], str, bool]:
    settings = get_settings()
    return await fetch_from_rag_api(
        query=intent.original_query,
        symbols=intent.symbols,
        rag_url=settings.RAG_API_URL,
        rag_key=settings.RAG_API_KEY,
        timeout=settings.RAG_API_TIMEOUT,
    )


async def fetch_all(intent: ParsedIntent) -> FetchedData:
    symbol = intent.symbols[0] if intent.symbols else ""
    if not symbol:
        return FetchedData(
            symbol="",
            date_start=intent.date_start,
            date_end=intent.date_end,
            news_fallback=True,
        )

    start = intent.date_start
    end = intent.date_end
    loop = asyncio.get_running_loop()

    prices_fut = loop.run_in_executor(None, partial(_fetch_prices, symbol, start, end))
    indicators_fut = loop.run_in_executor(None, partial(_fetch_indicators, symbol, start, end))
    inst_fut = loop.run_in_executor(None, partial(_fetch_institutional, symbol, start, end))
    news_fut = asyncio.ensure_future(_fetch_news(intent))

    prices, indicators, institutional, (news_chunks, rag_summary, is_fallback) = (
        await asyncio.gather(prices_fut, indicators_fut, inst_fut, news_fut)
    )

    return FetchedData(
        symbol=symbol,
        date_start=intent.date_start,
        date_end=intent.date_end,
        prices=prices,
        indicators=indicators,
        institutional=institutional,
        news=news_chunks,
        rag_summary=rag_summary,
        news_fallback=is_fallback,
    )
