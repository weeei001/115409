from copy import deepcopy
from datetime import date
from decimal import Decimal
import json

import httpx
import pytest
from sqlalchemy import select

from app.db.models.market_extra import FinancialStatementRow, MonthlyRevenue
from app.jobs.market import financial_metrics, monthly_revenue, supplemental_history as history


def revenue_html(market="上市", year=110, month=1, amount="126,749,152"):
    return (f"<html>{market}公司{year}年{month}月份(累計與當月)營業收入統計表 "
            "單位：千元 出表日期：115/10/10<table><tr><th>公司 代號</th><th>公司名稱</th>"
            "<th>當月營收</th></tr><tr><td>2330</td><td>台積電</td>"
            f"<td>{amount}</td>" + "<td>0</td>" * 8 + "</tr></table></html>").encode("cp950")


def trend(metric="EPS"):
    return {"ylabel": "元" if metric == "EPS" else "仟元",
            "xaxisList": ["2021Q1", "2021Q2", "2021Q3"],
            "showNameList": ["2330 台積電 (上市半導體業)"],
            "graphData": [{"label": "台積電", "data": [[0, 5.39, "C"], [1, 5.18, "C"], [2, None, "C"]]}]}


def test_monthly_revenue_validates_period_unit_and_converts_thousands():
    result = monthly_revenue.parse_report(revenue_html(), date(2021, 1, 1), "TWSE", {"2330"})
    assert result == [{"date": "2021-01-01", "symbol": "2330", "revenue": "126749152000",
                       "revenue_month": 1, "revenue_year": 2021, "create_time": "2026-10-10"}]
    for content in (revenue_html(month=2), revenue_html(market="上櫃"),
                    revenue_html().replace("千元".encode("cp950"), "百元".encode("cp950")),
                    revenue_html(amount="NaN")):
        with pytest.raises(ValueError):
            monthly_revenue.parse_report(content, date(2021, 1, 1), "TWSE", {"2330"})
    assert monthly_revenue.parse_report(revenue_html(amount="0"), date(2021, 1, 1), "TWSE", {"2330"})[0]["revenue"] == "0"


def test_monthly_revenue_reads_both_markets_and_rejects_conflict():
    requested = []
    def respond(request):
        requested.append(request.url.path)
        otc = "/otc/" in request.url.path
        return httpx.Response(200, content=revenue_html(market="上櫃" if otc else "上市", amount="2" if otc else "1"))
    with httpx.Client(transport=httpx.MockTransport(respond)) as http:
        with pytest.raises(ValueError, match="across exchanges"):
            monthly_revenue.fetch_month(http, date(2021, 1, 1), {"2330"})
    assert len(requested) == 2


def test_metrics_keep_official_quarterly_eps_without_differencing():
    rows = financial_metrics.parse(trend(), "2330", "EPS", date(2021, 4, 1), date(2021, 12, 31))
    assert len(rows) == 1 and rows[0]["value"] == "5.18" and rows[0]["date"] == "2021-06-30"
    assert rows[0]["item_type"] == "EPS"
    payload = trend("Revenue")
    payload["graphData"][0]["data"][0][1] = Decimal("362410230")
    result = financial_metrics.parse(payload, "2330", "Revenue", date(2021, 1, 1), date(2021, 12, 31))
    assert result[0]["value"] == "362410230000"
    for field, value in (("ylabel", "美元"), ("xaxisList", ["2021"]),
                         ("showNameList", ["2317 鴻海"])):
        changed = {**trend(), field: value}
        with pytest.raises(ValueError):
            financial_metrics.parse(changed, "2330", "EPS", date(2021, 1, 1), date(2021, 12, 31))


def test_metrics_request_single_quarters_and_all_four_metrics():
    requested = []
    def respond(request):
        assert request.url.params["quarter"] == "true"
        assert request.url.params["companyId"] == "2330"
        metric = request.url.params["compareItem"]
        requested.append(metric)
        return httpx.Response(200, json=trend(metric))
    with httpx.Client(transport=httpx.MockTransport(respond)) as http:
        rows = financial_metrics.fetch(http, "2330", date(2021, 1, 1), date(2021, 12, 31))
    assert set(requested) == set(financial_metrics.METRICS) and len(rows) == 8


def test_history_commits_each_period_and_resumes_only_committed_work(db_session, tmp_path, monkeypatch):
    requested = []
    failing = True
    def fetch_month(client, month, selected):
        requested.append(month)
        if failing and month.month == 2:
            raise ValueError("upstream unavailable")
        return [{"date": month.isoformat(), "symbol": "1103", "revenue": "5000"}]
    monkeypatch.setattr(monthly_revenue, "fetch_month", fetch_month)
    arguments = dict(symbols=["1103"], start=date(2021, 1, 1), end=date(2021, 2, 28),
                     out=tmp_path / "report.json", datasets={"monthly_revenue"})
    with pytest.raises(ValueError):
        history.backfill(db_session.bind, None, **arguments)
    assert set(json.loads(arguments["out"].read_text())["periods"]) == {"monthly_revenue/2021-01"}
    assert db_session.get(MonthlyRevenue, (date(2021, 1, 1), "1103")).revenue == 5000
    db_session.rollback()
    failing = False
    history.backfill(db_session.bind, None, **arguments, resume=True)
    assert requested == [date(2021, 1, 1), date(2021, 2, 1), date(2021, 2, 1)]
    assert len(list(db_session.scalars(select(MonthlyRevenue)))) == 2
    db_session.rollback()
    with pytest.raises(ValueError, match="Resume report"):
        history.backfill(db_session.bind, None, **{**arguments, "symbols": ["2330"]}, resume=True)


def test_financial_history_visits_every_filed_quarter_and_imports_canonical_metrics(db_session, tmp_path, monkeypatch):
    requested = []
    def quarter(client, year, number, catalog):
        requested.append((year, number))
        return [{"date": history.mops_financial._quarter_end(year, number).isoformat(), "symbol": "2330",
                 "statement": "income", "item_type": "MOPS_YTD_TEST", "origin_name": "Revenue", "value": "1000"}]
    monkeypatch.setattr(history.mops_financial, "fetch_quarter", quarter)
    monkeypatch.setattr(financial_metrics, "fetch", lambda client, symbol, start, end:
                        financial_metrics.parse(trend(), symbol, "EPS", start, end))
    history.backfill(db_session.bind, None, symbols=["2330"], start=date(2021, 1, 1), end=date(2022, 5, 25),
                     out=tmp_path / "report.json", datasets={"financial_statements", "financial_metrics"})
    assert requested == [(2021, 1), (2021, 2), (2021, 3), (2021, 4), (2022, 1)]
    eps = db_session.get(FinancialStatementRow, (date(2021, 6, 30), "2330", "income", "EPS", "基本每股盈餘"))
    assert eps.value == Decimal("5.1800")


def test_rejected_period_does_not_advance_report(db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(monthly_revenue, "fetch_month", lambda *args: [
        {"date": "2021-01-01", "symbol": "9999", "revenue": "1"}])
    out = tmp_path / "report.json"
    with pytest.raises(ValueError, match="unexpected company"):
        history.backfill(db_session.bind, None, symbols=["2330"], start=date(2021, 1, 1), end=date(2021, 1, 31),
                         out=out, datasets={"monthly_revenue"})
    assert not out.exists()


def test_metric_duplicate_and_invalid_points_are_rejected():
    for value in (float("nan"), float("inf")):
        payload = deepcopy(trend())
        payload["graphData"][0]["data"][0][1] = value
        with pytest.raises(ValueError):
            financial_metrics.parse(payload, "2330", "EPS", date(2021, 1, 1), date(2021, 12, 31))
    payload = trend()
    payload["graphData"][0]["data"].append([0, 1, "C"])
    with pytest.raises(ValueError):
        financial_metrics.parse(payload, "2330", "EPS", date(2021, 1, 1), date(2021, 12, 31))


def test_metric_import_removes_only_returned_observation_aliases(db_session):
    def saved(**changes):
        return FinancialStatementRow(**{"date": date(2021, 6, 30), "symbol": "2330", "statement": "income",
                                        "item_type": "EPS", "origin_name": "基本每股盈餘（元）", "value": "9", **changes})
    db_session.add_all([saved(), saved(origin_name="基本每股盈餘", value="8"),
        saved(item_type="Revenue", origin_name="收入"), saved(item_type="GrossProfit", origin_name="Historical gross profit"),
        saved(item_type="MOPS_YTD_PER_SHARE_TEST"), saved(item_type="OtherIncome"),
        saved(symbol="2317"), saved(date=date(2021, 3, 31)), saved(statement="balance")])
    db_session.commit()
    rows = financial_metrics.parse(trend(), "2330", "EPS", date(2021, 4, 1), date(2021, 6, 30))
    with db_session.begin():
        assert financial_metrics.import_rows(db_session, rows, "2330") == 1
    stored = list(db_session.scalars(select(FinancialStatementRow)))
    assert len(stored) == 8
    eps = [row for row in stored if row.symbol == "2330" and row.date == date(2021, 6, 30)
           and row.statement == "income" and row.item_type == "EPS"]
    assert len(eps) == 1 and eps[0].origin_name == "基本每股盈餘" and eps[0].value == Decimal("5.1800")
    assert {row.item_type for row in stored} >= {"Revenue", "GrossProfit", "MOPS_YTD_PER_SHARE_TEST", "OtherIncome"}


def test_metric_alias_deletion_rolls_back_if_upsert_fails(db_session, monkeypatch):
    original = FinancialStatementRow(date=date(2021, 6, 30), symbol="2330", statement="income",
                                    item_type="EPS", origin_name="基本每股盈餘（元）", value="9")
    db_session.add(original)
    db_session.commit()
    rows = financial_metrics.parse(trend(), "2330", "EPS", date(2021, 4, 1), date(2021, 6, 30))
    def failed_upsert(*args):
        raise RuntimeError("Simulated write failure")
    monkeypatch.setattr(financial_metrics, "upsert_rows", failed_upsert)
    with pytest.raises(RuntimeError):
        with db_session.begin():
            financial_metrics.import_rows(db_session, rows, "2330")
    stored = list(db_session.scalars(select(FinancialStatementRow)))
    assert len(stored) == 1 and stored[0].origin_name == "基本每股盈餘（元）" and stored[0].value == Decimal("9")


def test_invalid_metric_import_cannot_delete_existing_values(db_session):
    db_session.add(FinancialStatementRow(date=date(2021, 6, 30), symbol="2330", statement="income",
                   item_type="EPS", origin_name="基本每股盈餘（元）", value="9"))
    db_session.commit()
    rows = financial_metrics.parse(trend(), "2330", "EPS", date(2021, 4, 1), date(2021, 6, 30))
    rows[0]["value"] = "invalid"
    with pytest.raises(ValueError):
        with db_session.begin():
            financial_metrics.import_rows(db_session, rows, "2330")
    assert len(list(db_session.scalars(select(FinancialStatementRow)))) == 1
