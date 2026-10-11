"""Import the official monthly TAIEX closing price index, excluding dividends."""
from datetime import date
from decimal import Decimal
import re

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models.benchmark_price import TAIEX, BenchmarkPrice
from app.jobs.market_history import OfficialClient, _date, _months, _number, _upsert


URL = "https://www.twse.com.tw/indicesReport/MI_5MINS_HIST"


def parse(payload: object, start: date, end: date) -> list[dict]:
    if not isinstance(payload, dict):
        raise ValueError("Unexpected TWSE benchmark response")
    if str(payload.get("stat", "")).startswith("很抱歉，沒有符合"):
        return []
    if payload.get("stat") != "OK" or not isinstance(payload.get("data"), list):
        raise ValueError("Unexpected TWSE benchmark status or data")
    fields = payload.get("fields", [])
    if not isinstance(fields, list) or "日期" not in fields or "收盤指數" not in fields:
        raise ValueError("Unexpected TWSE benchmark fields")
    date_index, close_index = fields.index("日期"), fields.index("收盤指數")
    rows = {}
    for raw in payload["data"]:
        if not isinstance(raw, list) or len(raw) <= max(date_index, close_index):
            raise ValueError("Malformed TWSE benchmark row")
        raw_date = str(raw[date_index]).strip()
        if not re.fullmatch(r"\d{3,4}/\d{2}/\d{2}", raw_date):
            raise ValueError("Invalid TWSE benchmark date")
        day = _date(raw_date)
        close = _number(raw[close_index])
        if close is not None and not 0 < Decimal(close) <= Decimal("9999999999.99"):
            raise ValueError("Invalid TWSE benchmark close")
        if start <= day <= end and close is not None:
            rows[day] = {"symbol": TAIEX, "date": day, "close": close}
    return [rows[day] for day in sorted(rows)]


def import_history(engine, client: OfficialClient, start: date, end: date, *, incremental=False) -> int:
    # The worker owns this additive table creation; API requests never mutate schema.
    BenchmarkPrice.__table__.create(engine, checkfirst=True)
    if incremental:
        # ponytail: refresh only the latest month; omit --incremental to repair older gaps or corrections.
        with Session(engine) as db:
            first, last = db.execute(select(func.min(BenchmarkPrice.date), func.max(BenchmarkPrice.date))
                                    .where(BenchmarkPrice.symbol == TAIEX)).one()
        if first and last and start.replace(day=1) >= first.replace(day=1):
            start = max(start, date(last.year, last.month, 1))
    count = 0
    for month in _months(start, end):
        payload = client.json("GET", URL, params={"date": month.strftime("%Y%m01"), "response": "json"})
        rows = parse(payload, start, end)
        with Session(engine) as db, db.begin():
            count += _upsert(db, BenchmarkPrice, rows)
    return count
