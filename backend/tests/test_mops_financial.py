from datetime import date

import httpx
import pytest

from app.jobs.market.mops_financial import FIELDS, fetch_quarter, parse_report


REPORT = """
<div class="head"><span>(金額單位：新台幣仟元)</span></div>
<div id="headTable"><table><thead><tr><th>報表類別</th></tr><tr><th>會計科目</th></tr></thead>
<tbody><tr><td>營業收入合計</td></tr><tr><td>基本每股盈餘</td></tr></tbody></table></div>
<div id="bodyTable"><table><thead><tr><th>合併</th><th>個別</th></tr>
<tr><th>2330 台積電 (上市半導體業)</th><th>5347 世界 (上櫃半導體業)</th></tr></thead>
<tbody><tr><td>1,234</td><td></td></tr><tr><td>1.25</td><td>(0.50)</td></tr></tbody></table></div>
"""


def test_verified_units_basis_and_missing_values():
    rows = parse_report(REPORT, "income", date(2024, 6, 30), {"2330", "5347"})
    assert FIELDS == ["date", "symbol", "statement", "item_type", "origin_name", "value"]
    assert [row["value"] for row in rows] == ["1234000", "1.25", "-0.50"]
    assert rows[0]["item_type"].startswith("MOPS_YTD_")
    assert "CONSOLIDATED" in rows[0]["item_type"]
    assert "PER_SHARE" in rows[1]["item_type"]
    assert "SEPARATE" in rows[2]["item_type"]
    assert parse_report(REPORT, "balance", date(2024, 6, 30), {"2330", "5347"})[0]["item_type"].startswith("MOPS_ASOF_")


def test_malformed_official_reports_fail_closed():
    for report in (REPORT.replace("新台幣仟元", "美元仟元"),
                   REPORT.replace("<td>1,234</td><td></td>", "<td>1,234</td>"),
                   REPORT.replace("2330 台積電", "9999 台積電"),
                   REPORT.replace("1,234", "unknown")):
        with pytest.raises(ValueError):
            parse_report(report, "income", date(2024, 6, 30), {"2330", "5347"})


def test_quarter_fetch_requests_all_three_reports_and_validates_dates():
    seen = []

    def respond(request):
        seen.append(request.url.params.get("compareItem"))
        assert request.url.params.get("ys") == "20242"
        assert set(request.url.params.get_list("companyId")) == {"2330", "5347"}
        return httpx.Response(200, text=REPORT)

    with httpx.Client(transport=httpx.MockTransport(respond)) as http:
        rows = fetch_quarter(http, 2024, 2, {"2330": {}, "5347": {}})
    assert set(seen) == {"IncomeStatement", "BalanceSheet", "CashflowStatement"}
    assert len(rows) == 9
    assert {row["date"] for row in rows} == {"2024-06-30"}
    with pytest.raises(ValueError):
        fetch_quarter(http, 2020, 4, {"2330": {}})
