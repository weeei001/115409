"""Official company-level institutional trading from TWSE T86 and TPEx."""
from __future__ import annotations

import re
from datetime import date

import httpx

FIELDS = ["date", "symbol", "foreign_buy", "foreign_sell", "foreign_net",
          "investment_trust_buy", "investment_trust_sell", "investment_trust_net",
          "dealer_buy", "dealer_sell", "dealer_net", "total_institutional_buy",
          "total_institutional_sell", "total_institutional_net"]


def iso_date(value: object) -> str:
    text = re.sub(r"\D", "", str(value or ""))
    if len(text) == 7:
        text = f"{int(text[:3]) + 1911:04d}{text[3:]}"
    if len(text) != 8:
        raise ValueError("Invalid institutional date")
    return date(int(text[:4]), int(text[4:6]), int(text[6:8])).isoformat()


def numeric(value: object) -> str:
    text = str(value or "").strip().replace(",", "")
    return text if re.fullmatch(r"[+-]?\d+", text) else ""


def _value(row: dict, key: str) -> int:
    value = numeric(row[key])
    if not value or "." in value:
        raise ValueError("Invalid institutional share count")
    return int(value)


def _result(day: str, symbol: str, foreign: tuple[int, int], trust: tuple[int, int],
            dealer: tuple[int, int], reported_total: int) -> dict:
    result = {"date": day, "symbol": symbol}
    for prefix, pair in (("foreign", foreign), ("investment_trust", trust), ("dealer", dealer)):
        result[f"{prefix}_buy"], result[f"{prefix}_sell"] = pair
        result[f"{prefix}_net"] = pair[0] - pair[1]
    result["total_institutional_buy"] = sum(pair[0] for pair in (foreign, trust, dealer))
    result["total_institutional_sell"] = sum(pair[1] for pair in (foreign, trust, dealer))
    result["total_institutional_net"] = result["total_institutional_buy"] - result["total_institutional_sell"]
    if result["total_institutional_net"] != reported_total:
        raise ValueError("Official institutional components do not match reported total")
    return result


def fetch_twse(http: httpx.Client, day: date) -> list[dict]:
    response = http.get("https://www.twse.com.tw/rwd/zh/fund/T86", params={
        "date": day.strftime("%Y%m%d"), "selectType": "ALLBUT0999", "response": "json"})
    response.raise_for_status()
    return parse_twse(response.json(), day)


def parse_twse(payload: object, day: date) -> list[dict]:
    if not isinstance(payload, dict) or payload.get("stat") != "OK" or not isinstance(payload.get("data"), list):
        raise ValueError("Invalid TWSE institutional response")
    actual_day = iso_date(payload.get("date"))
    if actual_day != day.isoformat():
        raise ValueError("TWSE institutional date mismatch")
    required = ["證券代號", "外陸資買進股數(不含外資自營商)", "外陸資賣出股數(不含外資自營商)",
                "投信買進股數", "投信賣出股數", "自營商買進股數(自行買賣)",
                "自營商賣出股數(自行買賣)", "自營商買進股數(避險)",
                "自營商賣出股數(避險)", "三大法人買賣超股數"]
    fields = payload.get("fields")
    if not isinstance(fields, list) or not set(required) <= set(fields):
        raise ValueError("TWSE institutional fields changed")
    result = []
    for values in payload["data"]:
        row = dict(zip(fields, values, strict=True))
        symbol = str(row["證券代號"]).strip()
        if not re.fullmatch(r"\d{4,6}", symbol):
            continue
        foreign = (_value(row, required[1]), _value(row, required[2]))
        trust = (_value(row, required[3]), _value(row, required[4]))
        dealer = (_value(row, required[5]) + _value(row, required[7]),
                  _value(row, required[6]) + _value(row, required[8]))
        result.append(_result(actual_day, symbol, foreign, trust, dealer, _value(row, required[9])))
    if not result:
        raise ValueError("Empty TWSE institutional report")
    return result


def parse_tpex_history(payload: object, day: date) -> list[dict]:
    """Parse the dated TPEx report, whose repeated columns have fixed groups."""
    if not isinstance(payload, dict) or payload.get("stat") != "ok":
        raise ValueError("Invalid TPEx institutional history response")
    if iso_date(payload.get("date")) != day.isoformat():
        raise ValueError("TPEx institutional date mismatch")
    tables = payload.get("tables")
    if not isinstance(tables, list):
        raise ValueError("TPEx institutional tables changed")
    reports = [table for table in tables if isinstance(table, dict)
               and table.get("title") == "三大法人買賣明細資訊"]
    if len(reports) != 1:
        raise ValueError("TPEx institutional tables changed")
    table = reports[0]
    fields = ["代號", "名稱"] + ["買進股數", "賣出股數", "買賣超股數"] * 7 + ["三大法人買賣超股數合計"]
    if table.get("fields") != fields or not isinstance(table.get("data"), list):
        raise ValueError("TPEx institutional fields changed")
    if iso_date(table.get("date")) != day.isoformat():
        raise ValueError("TPEx institutional table date mismatch")
    result = []
    for values in table["data"]:
        if not isinstance(values, list) or len(values) != len(fields):
            raise ValueError("TPEx institutional row length changed")
        symbol = str(values[0]).strip()
        if not re.fullmatch(r"\d{4,6}", symbol):
            continue
        numbers = [_value({"value": value}, "value") for value in values[2:]]
        groups = [numbers[offset:offset + 3] for offset in range(0, 21, 3)]
        for buy, sell, net in groups:
            if buy < 0 or sell < 0 or buy - sell != net:
                raise ValueError("TPEx institutional group total mismatch")
        # Foreign excluding foreign dealers, foreign dealers, combined foreign,
        # investment trust, proprietary dealer, hedging dealer, combined dealer.
        for left, right, combined in ((0, 1, 2), (4, 5, 6)):
            if any(groups[left][i] + groups[right][i] != groups[combined][i] for i in range(3)):
                raise ValueError("TPEx institutional component total mismatch")
        result.append(_result(day.isoformat(), symbol, tuple(groups[0][:2]),
                              tuple(groups[3][:2]), tuple(groups[6][:2]), numbers[21]))
    if not result:
        raise ValueError("Empty TPEx institutional report")
    return result


def fetch_history(client, day: date, market: str) -> list[dict]:
    """Fetch a dated report through the shared throttled/retrying client."""
    if market == "TWSE":
        payload = client.json("GET", "https://www.twse.com.tw/rwd/zh/fund/T86", params={
            "date": day.strftime("%Y%m%d"), "selectType": "ALLBUT0999", "response": "json"})
        return parse_twse(payload, day)
    if market == "TPEx":
        payload = client.json("GET", "https://www.tpex.org.tw/www/zh-tw/insti/dailyTrade", params={
            "date": day.strftime("%Y/%m/%d"), "type": "Daily", "sect": "EW", "response": "json"})
        return parse_tpex_history(payload, day)
    raise ValueError(f"Unsupported institutional market: {market}")


def fetch_tpex(http: httpx.Client) -> list[dict]:
    response = http.get("https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading")
    response.raise_for_status()
    rows = response.json()
    if not isinstance(rows, list) or not rows:
        raise ValueError("Invalid TPEx institutional response")
    keys = ("Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Total Buy",
            " Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Total Sell",
            "SecuritiesInvestmentTrustCompanies-TotalBuy", "SecuritiesInvestmentTrustCompanies-TotalSell",
            "Dealers-TotalBuy", "Dealers-TotalSell", "TotalDifference")
    result = []
    for row in rows:
        if not isinstance(row, dict) or not {"Date", "SecuritiesCompanyCode", *keys} <= row.keys():
            raise ValueError("TPEx institutional fields changed")
        symbol = str(row["SecuritiesCompanyCode"]).strip()
        if not re.fullmatch(r"\d{4,6}", symbol):
            continue
        result.append(_result(iso_date(row["Date"]), symbol,
            (_value(row, keys[0]), _value(row, keys[1])),
            (_value(row, keys[2]), _value(row, keys[3])),
            (_value(row, keys[4]), _value(row, keys[5])), _value(row, keys[6])))
    if not result:
        raise ValueError("Empty TPEx institutional report")
    return result
