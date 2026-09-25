"""Official daily margin balances, kept in each exchange's reported units (lots)."""
from __future__ import annotations

import re
from datetime import date

import httpx

from .institutional import iso_date, numeric


FIELDS = ["date", "symbol", "margin_purchase_buy", "margin_purchase_cash_repayment",
          "margin_purchase_limit", "margin_purchase_sell", "margin_purchase_today_balance",
          "margin_purchase_yesterday_balance", "note", "offset_loan_and_short",
          "short_sale_buy", "short_sale_cash_repayment", "short_sale_limit", "short_sale_sell",
          "short_sale_today_balance", "short_sale_yesterday_balance"]
TWSE_COLUMNS = ["代號", "名稱", "買進", "賣出", "現金償還", "前日餘額", "今日餘額", "次一營業日限額",
                "買進", "賣出", "現券償還", "前日餘額", "今日餘額", "次一營業日限額", "資券互抵", "註記"]
TWSE_POSITIONS = {"margin_purchase_buy": 2, "margin_purchase_sell": 3, "margin_purchase_cash_repayment": 4,
                  "margin_purchase_yesterday_balance": 5, "margin_purchase_today_balance": 6,
                  "margin_purchase_limit": 7, "short_sale_buy": 8, "short_sale_sell": 9,
                  "short_sale_cash_repayment": 10, "short_sale_yesterday_balance": 11,
                  "short_sale_today_balance": 12, "short_sale_limit": 13, "offset_loan_and_short": 14}
TPEX_COLUMNS = {"margin_purchase_buy": "MarginPurchase", "margin_purchase_sell": "MarginSales",
                "margin_purchase_cash_repayment": "CashRedemption",
                "margin_purchase_yesterday_balance": "MarginPurchaseBalancePreviousDay",
                "margin_purchase_today_balance": "MarginPurchaseBalance",
                "margin_purchase_limit": "MarginPurchaseQuota", "short_sale_buy": "ShortConvering",
                "short_sale_sell": "ShortSale", "short_sale_cash_repayment": "StockRedemption",
                "short_sale_yesterday_balance": "ShortSaleBalancePreviousDay",
                "short_sale_today_balance": "ShortSaleBalance", "short_sale_limit": "ShortSaleQuota",
                "offset_loan_and_short": "Offsetting"}


def _count(value: object) -> str:
    cleaned = numeric(value)
    if cleaned and not re.fullmatch(r"\d+", cleaned):
        raise ValueError("Invalid margin share count")
    return cleaned


def fetch_twse(http: httpx.Client, day: date) -> list[dict]:
    response = http.get("https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN", params={
        "date": day.strftime("%Y%m%d"), "selectType": "ALL", "response": "json"})
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict) or payload.get("stat") != "OK" or iso_date(payload.get("date")) != day.isoformat():
        raise ValueError("Invalid TWSE margin date")
    tables = payload.get("tables")
    if not isinstance(tables, list) or len(tables) < 2 or tables[1].get("fields") != TWSE_COLUMNS:
        raise ValueError("TWSE margin schema changed")
    result = []
    for raw in tables[1].get("data", []):
        if not isinstance(raw, list) or len(raw) != len(TWSE_COLUMNS):
            raise ValueError("Invalid TWSE margin row")
        symbol = str(raw[0]).strip()
        if not re.fullmatch(r"\d{4,6}", symbol):
            continue
        row = {"date": day.isoformat(), "symbol": symbol, "note": str(raw[15]).strip()}
        row.update({field: _count(raw[position]) for field, position in TWSE_POSITIONS.items()})
        result.append(row)
    if not result:
        raise ValueError("Empty TWSE margin report")
    return result


def fetch_tpex(http: httpx.Client) -> list[dict]:
    response = http.get("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_margin_balance")
    response.raise_for_status()
    rows = response.json()
    if not isinstance(rows, list) or not rows:
        raise ValueError("Invalid TPEx margin response")
    result = []
    for raw in rows:
        if not isinstance(raw, dict) or not {"Date", "SecuritiesCompanyCode", *TPEX_COLUMNS.values()} <= raw.keys():
            raise ValueError("TPEx margin schema changed")
        symbol = str(raw["SecuritiesCompanyCode"]).strip()
        if not re.fullmatch(r"\d{4,6}", symbol):
            continue
        row = {"date": iso_date(raw["Date"]), "symbol": symbol, "note": str(raw.get("Note") or "").strip()}
        row.update({field: _count(raw[source]) for field, source in TPEX_COLUMNS.items()})
        result.append(row)
    if not result:
        raise ValueError("Empty TPEx margin report")
    return result
