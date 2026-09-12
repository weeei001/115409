"""Read existing price and weekly digest tables; never create legacy resources."""
import json
from datetime import timedelta

from sqlalchemy import text

from app.core.errors import AppError
from app.db.models.daily_price import DailyPrice
from app.features.market.repository import date_range, symbol_range


def load_inputs(db, request):
    first, last = date_range(db, request.symbol)
    if first is None:
        raise AppError("No price data for this symbol", 404)
    if request.start < first or request.end > last:
        raise AppError(f"Dates must be within available price data: {first} ~ {last}")
    rows = symbol_range(db, DailyPrice, request.symbol, request.start - timedelta(days=60), request.end)
    prices = []
    for row in rows:
        if row.close is None or not row.close.is_finite() or row.close <= 0:
            raise AppError(f"Invalid closing price on {row.date}")
        prices.append({"date": row.date.isoformat(), "close": str(row.close)})
    if not any(row["date"] >= request.start.isoformat() for row in prices):
        raise AppError("No trading days in the requested interval", 404)

    params = {"symbol": request.symbol, "start": request.start.isoformat(), "end": request.end.isoformat()}
    columns = "as_of_date, news_json, digest_json"
    before = db.execute(text(f"SELECT {columns} FROM analysis_digests "
        "WHERE stock_id=:symbol AND period='week' AND as_of_date < :start "
        "ORDER BY as_of_date DESC LIMIT 4"), params).mappings().all()
    during = db.execute(text(f"SELECT {columns} FROM analysis_digests "
        "WHERE stock_id=:symbol AND period='week' AND as_of_date >= :start AND as_of_date <= :end "
        "ORDER BY as_of_date"), params).mappings().all()
    digests = []
    for row in [*reversed(before), *during]:
        item = {"as_of_date": str(row["as_of_date"])[:10]}
        for field, default in (("news_json", []), ("digest_json", {})):
            value = row[field]
            item[field] = (json.loads(value) if isinstance(value, str) else value) or default
        digests.append(item)
    return {"prices": prices, "digests": digests}
