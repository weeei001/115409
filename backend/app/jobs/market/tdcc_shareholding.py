"""Map TDCC's weekly shareholding distribution to the existing CSV columns."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal, InvalidOperation

import httpx


URL = "https://openapi.tdcc.com.tw/v1/opendata/1-5"
FIELDS = ["date", "symbol", "holding_shares_level", "people", "percent", "unit"]
LEVELS = (
    "1-999", "1,000-5,000", "5,001-10,000", "10,001-15,000",
    "15,001-20,000", "20,001-30,000", "30,001-40,000", "40,001-50,000",
    "50,001-100,000", "100,001-200,000", "200,001-400,000",
    "400,001-600,000", "600,001-800,000", "800,001-1,000,000",
    "1,000,001以上", "差異數調整", "合計",
)


def map_rows(rows: object, symbols: set[str]) -> list[dict]:
    if not isinstance(rows, list) or not rows:
        raise ValueError("Invalid TDCC shareholding response")
    mapped = []
    seen = set()
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("Invalid TDCC shareholding row")
        symbol = str(row.get("證券代號") or "").strip()
        if symbol not in symbols:
            continue
        try:
            day = datetime.strptime(str(row["\ufeff資料日期"]), "%Y%m%d").date().isoformat()
            level = int(row["持股分級"])
            people = int(str(row["人數"]).replace(",", ""))
            shares = int(str(row["股數"]).replace(",", ""))
            percent = Decimal(str(row["占集保庫存數比例%"]).replace(",", ""))
        except (KeyError, TypeError, ValueError, InvalidOperation) as exc:
            raise ValueError("Invalid TDCC shareholding fields") from exc
        if not 1 <= level <= len(LEVELS) or people < 0 or shares < 0 or not percent.is_finite() or percent < 0:
            raise ValueError("Invalid TDCC shareholding values")
        key = (day, symbol, level)
        if key in seen:
            raise ValueError("Duplicate TDCC shareholding row")
        seen.add(key)
        mapped.append({"date": day, "symbol": symbol, "holding_shares_level": LEVELS[level - 1],
                       "people": people, "percent": str(percent), "unit": shares})
    if not mapped:
        raise ValueError("No listed-company TDCC shareholding rows")
    return mapped


def fetch(http: httpx.Client, symbols: set[str]) -> list[dict]:
    response = http.get(URL)
    response.raise_for_status()
    return map_rows(response.json(), symbols)
