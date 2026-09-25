"""Official ex-right/ex-dividend calculation results for existing CSV imports."""

import re
from datetime import date

import httpx

from app.jobs.finmind.transforms import DIVIDEND_RESULT_COLUMNS


FIELDS = {"dividend_result": DIVIDEND_RESULT_COLUMNS}
TWSE_RESULT = "https://www.twse.com.tw/rwd/zh/exRight/TWT49U"
TPEX_RESULT = "https://www.tpex.org.tw/openapi/v1/tpex_exright_daily"

RESULT_MAP = {
    "before_price": "ClosePriceBeforeExRightsDiviend",
    "after_price": "ExRightsDiviendQuote",
    "stock_and_cash_dividend": "StockDividendPlusCashDividend",
    "stock_or_cash_dividend": "ExRightsDiviend",
    "max_price": "LimitUp",
    "min_price": "LimitDown",
    "open_price": "OpeningReferencePrice",
    "reference_price": "DividendDeductedQuote",
}
TWSE_RESULT_MAP = {
    "before_price": "除權息前收盤價",
    "after_price": "除權息參考價",
    "stock_and_cash_dividend": "權值+息值",
    "stock_or_cash_dividend": "權/息",
    "max_price": "漲停價格",
    "min_price": "跌停價格",
    "open_price": "開盤競價基準",
    "reference_price": "減除股利參考價",
}


def _date(value: object) -> date:
    text = re.sub(r"\D", "", str(value or ""))
    if len(text) == 7:
        text = f"{int(text[:3]) + 1911:04d}{text[3:]}"
    if len(text) != 8:
        raise ValueError(f"Invalid official corporate-action date: {value!r}")
    return date(int(text[:4]), int(text[4:6]), int(text[6:8]))


def _number(value: object) -> str:
    text = str(value if value is not None else "").strip().replace(",", "")
    if not text or text in {"-", "--", "－", "N/A"}:
        return ""
    if not re.fullmatch(r"[+-]?\d+(?:\.\d+)?", text):
        raise ValueError(f"Invalid corporate-action number: {value!r}")
    return text


def _symbol(value: object, catalog: dict, market: str) -> str | None:
    symbol = str(value or "").strip()
    if not re.fullmatch(r"\d{4,6}", symbol):
        return None
    return symbol if symbol in catalog and catalog[symbol]["market"] == market else None


def _result_rows(http: httpx.Client, url: str, *, params: dict | None = None) -> list[dict]:
    response = http.get(url, params=params)
    response.raise_for_status()
    payload = response.json()
    if isinstance(payload, dict):
        if payload.get("stat") == "很抱歉，沒有符合條件的資料!" and not payload.get("data"):
            return []
        if payload.get("stat") != "OK" or not isinstance(payload.get("fields"), list) or not isinstance(payload.get("data"), list):
            raise ValueError("Unexpected TWSE ex-right result response")
        if not payload["data"]:
            return []
        if any(not isinstance(row, list) or len(row) != len(payload["fields"]) for row in payload["data"]):
            raise ValueError("Unexpected TWSE ex-right result row")
        return [dict(zip(payload["fields"], row)) for row in payload["data"]]
    if not isinstance(payload, list) or any(not isinstance(row, dict) for row in payload):
        raise ValueError("Unexpected TPEx ex-right result response")
    return payload


def fetch_dividend_results(http: httpx.Client, start: date, end: date, catalog: dict) -> list[dict]:
    """Read calculation results only; never use upcoming-ex-right announcement feeds."""
    results = {}
    feeds = (
        ("TWSE", _result_rows(http, TWSE_RESULT, params={"startDate": start.strftime("%Y%m%d"),
                                                          "endDate": end.strftime("%Y%m%d"), "response": "json"}),
         "資料日期", "股票代號", TWSE_RESULT_MAP),
        ("TPEx", _result_rows(http, TPEX_RESULT), "Date", "SecuritiesCompanyCode", RESULT_MAP),
    )
    for market, rows, date_field, symbol_field, mapping in feeds:
        for source in rows:
            required = {date_field, symbol_field, *mapping.values()}
            if not required <= source.keys():
                raise ValueError(f"Unexpected {market} ex-right result schema")
            symbol = _symbol(source[symbol_field], catalog, market)
            if not symbol:
                continue
            day = _date(source[date_field])
            if not start <= day <= end or day > date.today():
                continue
            item = dict.fromkeys(DIVIDEND_RESULT_COLUMNS, "")
            item.update(date=day.isoformat(), symbol=symbol)
            for target, key in mapping.items():
                if key in source:
                    item[target] = str(source[key]).strip() if target == "stock_or_cash_dividend" else _number(source[key])
            key = (item["date"], symbol)
            if key in results and results[key] != item:
                raise ValueError(f"Conflicting ex-right result rows for {key}")
            results[key] = item
    return list(results.values())
