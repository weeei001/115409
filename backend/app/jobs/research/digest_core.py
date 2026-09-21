"""Research inputs using the backend's database, retrieval and model settings."""
import asyncio
from datetime import date, datetime, timedelta
import math

import httpx
from openai import OpenAI

from app.clients.vector import VectorClient
from app.core.config import get_settings
from app.core.http import make_http_client
from app.db.engine import make_engine, make_session_factory
from app.db.models.daily_price import DailyPrice
from app.features.market.repository import symbol_range
from app.features.analysis.prediction import (
    compute_weighted_regression, compute_momentum_meanreversion_curve,
)
from app.features.retrieval.common import (
    CMONEY_SOURCES, STOCK_OPTIONS as STOCK_NAMES, TAIPEI, parse_timestamp,
)

DIGEST_EXTRA_BODY = {"chat_template_kwargs": {"enable_thinking": False}}


def make_h200_client():
    settings = get_settings()
    if not settings.LLM_API_KEY or not settings.LLM_BASE_URL or not settings.LLM_MODEL:
        return None, settings.LLM_MODEL
    client = OpenAI(
        base_url=settings.LLM_BASE_URL, api_key=settings.LLM_API_KEY,
        timeout=settings.LLM_TIMEOUT_SECONDS, max_retries=0,
        http_client=httpx.Client(
            proxy=settings.OUTBOUND_HTTP_PROXY.strip() or None,
            trust_env=settings.OUTBOUND_HTTP_TRUST_ENV,
            timeout=settings.LLM_TIMEOUT_SECONDS,
        ),
    )
    return client, settings.LLM_MODEL


def fetch_pit_articles(settings, embeddings, stock_id: str, as_of: str,
                       window_days: int = 30, pool_limit: int = 40,
                       analyst_limit: int = 6, news_limit: int = 10):
    """Retrieve dated evidence with the same index and timezone as the live API."""
    end_day = date.fromisoformat(as_of[:10])
    start = datetime.combine(end_day - timedelta(days=window_days), datetime.min.time(), TAIPEI)
    end = datetime.combine(end_day, datetime.max.time(), TAIPEI)

    async def retrieve():
        async with make_http_client(settings) as http:
            vector = VectorClient(http, settings)
            query = await vector.embed_query(f"{STOCK_NAMES.get(stock_id, stock_id)} recent financial outlook")
            return await vector.query(query, symbols=[stock_id], start=start, end=end, limit=pool_limit)

    analyst, news, seen = [], [], set()
    for point in asyncio.run(retrieve()):
        payload = point["payload"]
        title = payload.get("title", "")
        published = parse_timestamp(payload.get("pub_time"))
        if not title or title in seen or published is None or not start <= published <= end:
            continue
        seen.add(title)
        item = {
            "title": title, "source": payload.get("source", ""),
            "pub_time": published.isoformat(), "url": payload.get("url", ""),
            "content": payload.get("page_content") or payload.get("content", ""),
        }
        target = analyst if item["source"] in CMONEY_SOURCES | {"moneydj"} else news
        target.append(item)
    return analyst[:analyst_limit], news[:news_limit]


def read_price_rows(stock_id: str, start: date, end: date):
    """Read imported daily closes; exclude unusable rows before counting sessions."""
    engine = make_engine(get_settings())
    try:
        with make_session_factory(engine)() as db:
            rows = symbol_range(db, DailyPrice, stock_id, start, end)
            return [(row.date.isoformat(), float(row.close)) for row in rows
                    if row.close is not None and math.isfinite(float(row.close)) and row.close > 0]
    finally:
        engine.dispose()


def fetch_prices(stock_id: str, as_of: str, lookback_days: int = 60):
    end = date.fromisoformat(as_of[:10])
    return [close for _, close in read_price_rows(stock_id, end - timedelta(days=lookback_days), end)][-30:]


def compute_technical(closes: list) -> dict:
    if not closes:
        return {"available": False}
    _, slope, _ = compute_weighted_regression(closes)
    ma20 = round(sum(closes[-20:]) / min(20, len(closes)), 2)
    return {
        "available": True, "n_days": len(closes),
        "first_close": closes[0], "last_close": closes[-1],
        "change_pct": round((closes[-1] - closes[0]) / closes[0] * 100, 2) if closes[0] else 0.0,
        "slope_per_day": round(slope, 3), "ma20": ma20,
        "vs_ma20_pct": round((closes[-1] - ma20) / ma20 * 100, 2) if ma20 else 0.0,
        "short_momentum_next5": compute_momentum_meanreversion_curve(closes, horizon_days=5),
    }
