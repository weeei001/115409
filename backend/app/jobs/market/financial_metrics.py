"""Official MOPS single-quarter trend metrics, without differencing YTD EPS."""
from datetime import date
from decimal import Decimal
import re

from sqlalchemy import delete

from app.db.models.market_extra import FinancialStatementRow
from .import_csv import normalized_rows, upsert_rows

URL = "https://mopsfin.twse.com.tw/compare/data"
METRICS = {"EPS": ("元", "基本每股盈餘"), "Revenue": ("仟元", "營業收入"),
           "GrossProfit": ("仟元", "營業毛利（毛損）"), "OperatingIncome": ("仟元", "營業利益（損失）")}


def parse(payload, symbol: str, metric: str, start: date, end: date) -> list[dict]:
    unit, name = METRICS[metric]
    if not isinstance(payload, dict) or payload.get("ylabel") != unit:
        raise ValueError("MOPS metric unit mismatch")
    names, series, axis = payload.get("showNameList"), payload.get("graphData"), payload.get("xaxisList")
    if (not isinstance(names, list) or len(names) != 1 or not isinstance(names[0], str)
            or not names[0].startswith(symbol + " ") or not isinstance(series, list)
            or len(series) != 1 or not isinstance(series[0], dict) or not isinstance(axis, list)
            or not isinstance(series[0].get("data"), list)):
        raise ValueError("MOPS metric company or series schema changed")
    dates = []
    for label in axis:
        match = re.fullmatch(r"(\d{4})Q([1-4])", str(label))
        if not match:
            raise ValueError("MOPS metric axis is not single-quarter data")
        year, quarter = int(match[1]), int(match[2])
        # The upstream series includes pre-2021 points; do not reject them.
        month = quarter * 3
        dates.append(date(year, month, 31 if month in (3, 12) else 30))
    if dates != sorted(set(dates)):
        raise ValueError("MOPS metric quarters are duplicated or unsorted")
    rows, seen = [], set()
    for point in series[0]["data"]:
        if (not isinstance(point, list) or len(point) != 3 or type(point[0]) is not int
                or not 0 <= point[0] < len(dates) or point[0] in seen or point[2] not in {"C", "A", "B"}):
            raise ValueError("Invalid MOPS quarterly metric point")
        seen.add(point[0])
        day = dates[point[0]]
        if point[1] is None:
            continue
        amount = Decimal(str(point[1]))
        if not amount.is_finite():
            raise ValueError("Non-finite MOPS quarterly metric")
        if start <= day <= end:
            rows.append({"date": day.isoformat(), "symbol": symbol, "statement": "income",
                         "item_type": metric, "origin_name": name,
                         "value": format(amount * (1 if metric == "EPS" else 1000), "f")})
    return rows


def fetch(http, symbol: str, start: date, end: date) -> list[dict]:
    if not re.fullmatch(r"\d{4,6}", symbol):
        raise ValueError("Invalid stock code")
    rows = []
    for metric, (unit, _) in METRICS.items():
        response = http.get(URL, params={"bcodeAvg": "false", "companyAvg": "false",
            "compareItem": metric, "qnumber": "", "quarter": "true", "revenue": "false",
            "ylabel": unit, "ys": "0", "companyId": symbol})
        response.raise_for_status()
        rows.extend(parse(response.json(parse_float=Decimal), symbol, metric, start, end))
    return rows


def import_rows(db, rows: list[dict], symbol: str) -> int:
    """Replace aliases only for returned canonical metrics; caller owns the transaction."""
    prepared = normalized_rows(FinancialStatementRow, rows, symbol)
    for row in prepared:
        metric = row["item_type"]
        if (row["statement"] != "income" or metric not in METRICS or row["value"] is None
                or row["origin_name"] != METRICS[metric][1]):
            raise ValueError("Invalid canonical quarterly metric import")
    # The historical schema includes origin_name in the primary key. Remove only
    # old aliases of returned observations, never missing metrics or raw MOPS rows.
    for metric, (_, origin_name) in METRICS.items():
        dates = [row["date"] for row in prepared if row["item_type"] == metric]
        if dates:
            db.execute(delete(FinancialStatementRow).where(
                FinancialStatementRow.symbol == symbol,
                FinancialStatementRow.date.in_(dates),
                FinancialStatementRow.statement == "income",
                FinancialStatementRow.item_type == metric,
                FinancialStatementRow.origin_name != origin_name))
    return upsert_rows(db, FinancialStatementRow, prepared)
