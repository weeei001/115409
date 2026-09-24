"""Read historical official MOPS financial comparison reports, one quarter at a time.

Income and cash-flow values are year-to-date; balance values are quarter-end.
Amounts are converted from NT$ thousands to NT dollars. Per-share values remain NT$.
These raw rows do not replace the app's single-quarter EPS/Revenue/GrossProfit/OperatingIncome indicators.
"""
from __future__ import annotations

import hashlib
import re
from calendar import monthrange
from datetime import date
from decimal import Decimal, InvalidOperation

import httpx
from bs4 import BeautifulSoup


FIELDS = ["date", "symbol", "statement", "item_type", "origin_name", "value"]
URL = "https://mopsfin.twse.com.tw/compare/report"
STATEMENTS = {"income": "IncomeStatement", "balance": "BalanceSheet", "cashflow": "CashflowStatement"}
BATCH_SIZE = 10  # Verified against the official multi-company comparison response.


def _quarter_end(year: int, quarter: int) -> date:
    if year < 2021 or quarter not in (1, 2, 3, 4):
        raise ValueError("MOPS financial quarter must be 2021 or later and Q1..Q4")
    month = quarter * 3
    return date(year, month, monthrange(year, month)[1])


def _number(text: str) -> Decimal | None:
    value = text.replace(",", "").strip()
    if not value or value in {"-", "--", "N/A"}:
        return None
    if value.startswith("(") and value.endswith(")"):
        value = "-" + value[1:-1]
    try:
        parsed = Decimal(value)
    except InvalidOperation as exc:
        raise ValueError(f"Unexpected MOPS financial value: {text[:30]}") from exc
    if not parsed.is_finite():
        raise ValueError("Non-finite MOPS financial value")
    return parsed


def parse_report(html: str, statement: str, period: date, selected: set[str]) -> list[dict]:
    """Reject changed report shapes before any financial value reaches the importer."""
    if statement not in STATEMENTS or not selected:
        raise ValueError("Invalid MOPS report request")
    page = BeautifulSoup(html, "html.parser")
    if "新台幣仟元" not in page.get_text(" ", strip=True):
        raise ValueError("MOPS report unit is not verified as NT$ thousands")
    labels_table = page.select("#headTable table")
    values_table = page.select("#bodyTable table")
    if len(labels_table) != 1 or len(values_table) != 1:
        raise ValueError("Unexpected MOPS financial table layout")
    headings = values_table[0].select("thead tr")
    if len(headings) != 2:
        raise ValueError("Unexpected MOPS financial column headings")
    report_types = [cell.get_text(" ", strip=True) for cell in headings[0].select("th")]
    company_names = [cell.get_text(" ", strip=True) for cell in headings[1].select("th")]
    if not company_names or len(report_types) != len(company_names):
        raise ValueError("Missing MOPS company headings")
    columns = []
    for report_type, name in zip(report_types, company_names):
        match = re.match(r"^(\d{4,6})\s", name)
        if not match or report_type not in {"合併", "個別"}:
            raise ValueError("Unrecognized MOPS company or statement basis")
        symbol = match.group(1)
        if symbol not in selected or symbol in {code for code, _ in columns}:
            raise ValueError("MOPS returned an unexpected or duplicate company")
        columns.append((symbol, "CONSOLIDATED" if report_type == "合併" else "SEPARATE"))
    label_rows = labels_table[0].select("tbody tr")
    value_rows = values_table[0].select("tbody tr")
    if len(label_rows) != len(value_rows):
        raise ValueError("MOPS account and value rows do not align")
    if not label_rows:
        return []  # A valid historical response for a company before it filed reports.
    output, occurrences = [], {}
    period_type = "ASOF" if statement == "balance" else "YTD"
    for label_row, value_row in zip(label_rows, value_rows):
        names = label_row.select("td")
        cells = value_row.select("td")
        if len(names) != 1 or len(cells) != len(columns):
            raise ValueError("MOPS financial row width changed")
        name = names[0].get_text(" ", strip=True)
        if not name or len(name) > 255:
            raise ValueError("Invalid MOPS account name")
        if any(token in name for token in ("％", "%", "比率", "百分比")):
            raise ValueError("Non-monetary MOPS account requires separate unit mapping")
        per_share = "每股" in name
        item_type = f"MOPS_{period_type}_{'PER_SHARE_' if per_share else ''}{hashlib.sha1(name.encode()).hexdigest()[:16]}"
        for (symbol, basis), cell in zip(columns, cells):
            amount = _number(cell.get_text(" ", strip=True))
            if amount is None:
                continue
            key = (symbol, basis, item_type)
            occurrences[key] = occurrences.get(key, 0) + 1
            output.append({"date": period.isoformat(), "symbol": symbol, "statement": statement,
                "item_type": f"{item_type}_{basis}_{occurrences[key]}", "origin_name": name,
                "value": format(amount if per_share else amount * 1000, "f")})
    return output


def fetch_quarter(http: httpx.Client, year: int, quarter: int, catalog: dict) -> list[dict]:
    """Fetch a whole listed universe for one filed quarter; caller checkpoints each quarter."""
    period = _quarter_end(year, quarter)
    if period > date.today() or not catalog:
        raise ValueError("Quarter is in the future or company catalog is empty")
    symbols = sorted(catalog)
    if any(not re.fullmatch(r"\d{4,6}", symbol) for symbol in symbols):
        raise ValueError("Company catalog contains an invalid stock code")
    output = []
    for statement, item in STATEMENTS.items():
        for offset in range(0, len(symbols), BATCH_SIZE):
            batch = symbols[offset:offset + BATCH_SIZE]
            params = [("bcodeAvg", "false"), ("companyAvg", "false"), ("compareItem", item),
                ("qnumber", ""), ("quarter", "true"), ("revenue", ""), ("ylabel", ""),
                ("ys", f"{year}{quarter}"), *(("companyId", symbol) for symbol in batch)]
            response = http.get(URL, params=params)
            response.raise_for_status()
            output.extend(parse_report(response.text, statement, period, set(batch)))
    return output
