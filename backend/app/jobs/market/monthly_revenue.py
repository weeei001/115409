"""Historical MOPS monthly revenue reports (NT$ thousands converted to NT$)."""
from __future__ import annotations

import re
from datetime import date

from bs4 import BeautifulSoup

URL = "https://mopsov.twse.com.tw/nas/t21/{market}/t21sc03_{year}_{month}.html"
MARKETS = {"TWSE": "sii", "TPEx": "otc"}


def parse_report(content: bytes, month: date, market: str, selected: set[str]) -> list[dict]:
    if market not in MARKETS:
        raise ValueError("Unknown monthly revenue market")
    # Archived MOPS reports explicitly declare Big5; CP950 also supports Taiwan's
    # extension characters used in company names and report notes.
    page = BeautifulSoup(content.decode("cp950"), "html.parser")
    text = page.get_text(" ", strip=True)
    heading = "上市" if market == "TWSE" else "上櫃"
    if f"{heading}公司{month.year - 1911}年{month.month}月份" not in text or "單位：千元" not in text:
        raise ValueError("Monthly revenue report period, market or unit mismatch")
    published = re.search(r"出表日期[：:]\s*(\d{3})/(\d{2})/(\d{2})", text)
    created = (date(int(published[1]) + 1911, int(published[2]), int(published[3])).isoformat()
               if published else "")
    output = {}
    recognized = 0
    for tr in page.find_all("tr"):
        cells = tr.find_all("td", recursive=False)
        if not cells:
            continue
        symbol = cells[0].get_text(" ", strip=True)
        if not re.fullmatch(r"\d{4,6}", symbol):
            continue
        headers = [re.sub(r"\s+", "", cell.get_text()) for cell in tr.find_parent("table").find_all("th")]
        if len(cells) != 11 or not {"公司代號", "公司名稱", "當月營收"} <= set(headers):
            raise ValueError("Monthly revenue table schema changed")
        recognized += 1
        if symbol not in selected:
            continue
        raw = cells[2].get_text(" ", strip=True).replace(",", "")
        if raw in {"", "-", "--"}:
            continue
        if not re.fullmatch(r"[+-]?\d+", raw):
            raise ValueError("Invalid monthly revenue amount")
        row = {"date": month.replace(day=1).isoformat(), "symbol": symbol,
               "revenue": str(int(raw) * 1000), "revenue_month": month.month,
               "revenue_year": month.year, "create_time": created}
        if symbol in output and output[symbol] != row:
            raise ValueError("Conflicting monthly revenue company rows")
        output[symbol] = row
    if not recognized:
        raise ValueError("Empty monthly revenue report")
    return list(output.values())


def fetch_month(http, month: date, selected: set[str]) -> list[dict]:
    output = {}
    # Always read both historical markets: today's listing market does not
    # identify the market before a company's exchange transfer.
    for market, code in MARKETS.items():
        response = http.get(URL.format(market=code, year=month.year - 1911, month=month.month))
        response.raise_for_status()
        for row in parse_report(response.content, month, market, selected):
            key = row["symbol"]
            if key in output and output[key]["revenue"] != row["revenue"]:
                raise ValueError("Conflicting monthly revenue across exchanges")
            output[key] = row
    return list(output.values())
