"""Full TWSE and TPEx foreign shareholding reports in the existing CSV shape."""

from datetime import date
import re

import httpx


FIELDS = [
    "date", "symbol", "stock_name", "international_code",
    "foreign_investment_remaining_shares", "foreign_investment_shares",
    "foreign_investment_remain_ratio", "foreign_investment_shares_ratio",
    "foreign_investment_upper_limit_ratio", "chinese_investment_upper_limit_ratio",
    "number_of_shares_issued", "recently_declare_date", "note",
]
TWSE_FIELDS = {
    "證券代號": "symbol",
    "證券名稱": "stock_name",
    "國際證券編碼": "international_code",
    "發行股數": "number_of_shares_issued",
    "外資及陸資尚可投資股數": "foreign_investment_remaining_shares",
    "全體外資及陸資持有股數": "foreign_investment_shares",
    "外資及陸資尚可投資比率": "foreign_investment_remain_ratio",
    "全體外資及陸資持股比率": "foreign_investment_shares_ratio",
    "外資及陸資共用法令投資上限比率": "foreign_investment_upper_limit_ratio",
    "陸資法令投資上限比率": "chinese_investment_upper_limit_ratio",
    "與前日異動原因(註)": "note",
    "最近一次上市公司申報外資及陸資持股異動日期": "recently_declare_date",
}
TPEX_FIELDS = {
    "SecuritiesCompanyCode": "symbol",
    "CompanyName": "stock_name",
    "NumberOfSharesIssued": "number_of_shares_issued",
    "AvailableSharesForOC/FIToInvest": "foreign_investment_remaining_shares",
    "CurrentlySharesOC/FIHeld": "foreign_investment_shares",
    "PercentageOfAvailableInvestmentForOC/FI": "foreign_investment_remain_ratio",
    "PercentageOfSharesOC/FMIHeld": "foreign_investment_shares_ratio",
    "UpperLimitOfRegulatedInvestment": "foreign_investment_upper_limit_ratio",
    "Note": "note",
}


def _number(value):
    text = str("" if value is None else value).strip().replace(",", "").removesuffix("%")
    return text if re.fullmatch(r"\d+(?:\.\d+)?", text) else ""


def _date(value):
    text = re.sub(r"\D", "", str(value or ""))
    if len(text) == 7:
        text = f"{int(text[:3]) + 1911:04d}{text[3:]}"
    if len(text) != 8:
        return ""
    try:
        return date(int(text[:4]), int(text[4:6]), int(text[6:8])).isoformat()
    except ValueError:
        return ""


def _row(raw, day):
    symbol = str(raw["symbol"]).strip()
    if not re.fullmatch(r"\d{4,6}", symbol):
        return None  # Funds and other securities are outside the company catalog.
    item = {name: "" for name in FIELDS}
    item.update(raw)
    item["date"], item["symbol"] = day, symbol
    for key in FIELDS:
        if key in {"date", "symbol", "stock_name", "international_code", "recently_declare_date", "note"}:
            continue
        item[key] = _number(item[key])
    item["recently_declare_date"] = _date(item["recently_declare_date"])
    return {name: item[name] for name in FIELDS}


def fetch_twse(http: httpx.Client, day: date) -> list[dict]:
    response = http.get("https://www.twse.com.tw/rwd/zh/fund/MI_QFIIS", params={
        "date": day.strftime("%Y%m%d"), "response": "json", "selectType": "ALLBUT0999"})
    response.raise_for_status()
    payload = response.json()
    if (not isinstance(payload, dict) or payload.get("stat") != "OK"
            or payload.get("date") != day.strftime("%Y%m%d")
            or not isinstance(payload.get("fields"), list) or not isinstance(payload.get("data"), list)
            or not set(TWSE_FIELDS) <= set(payload["fields"]) or not payload["data"]):
        raise ValueError("Unexpected TWSE foreign shareholding report")
    rows = []
    for values in payload["data"]:
        if not isinstance(values, list) or len(values) != len(payload["fields"]):
            raise ValueError("Unexpected TWSE foreign shareholding row")
        source = dict(zip(payload["fields"], values))
        item = _row({target: source[key] for key, target in TWSE_FIELDS.items()}, day.isoformat())
        if item:
            rows.append(item)
    if not rows or len({row["symbol"] for row in rows}) != len(rows):
        raise ValueError("Empty or duplicate TWSE foreign shareholding companies")
    return rows


def fetch_tpex(http: httpx.Client) -> list[dict]:
    response = http.get("https://www.tpex.org.tw/openapi/v1/tpex_3insti_qfii")
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, list) or not payload:
        raise ValueError("Unexpected TPEx foreign shareholding report")
    rows = []
    for source in payload:
        if not isinstance(source, dict) or not (set(TPEX_FIELDS) | {"Date"}) <= set(source):
            raise ValueError("Unexpected TPEx foreign shareholding row")
        day = _date(source["Date"])
        if not day:
            raise ValueError("Invalid TPEx foreign shareholding date")
        item = _row({target: source[key] for key, target in TPEX_FIELDS.items()}, day)
        if item:
            rows.append(item)
    if not rows or len({row["symbol"] for row in rows}) != len(rows) or len({row["date"] for row in rows}) != 1:
        raise ValueError("Empty, duplicate or mixed-date TPEx foreign shareholding companies")
    return rows
