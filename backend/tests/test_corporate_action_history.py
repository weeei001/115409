from datetime import date

import httpx
import pytest
from sqlalchemy import select

from app.db.models.market_extra import DividendResult
from app.jobs.market import corporate_action_history as history


def payload():
    fields = ["除權息日期", "代號", *history.MAPPING.values()]
    row = ["110/07/01", "6488", "900", "890", "10", "除息", "979", "801", "890", "890"]
    return {"date": "20210101~20211231", "stat": "ok",
            "tables": [{"fields": fields, "data": [row], "totalCount": 1}]}


def test_tpex_results_use_year_range_and_keep_calculation_prices(db_session, tmp_path):
    calls = []
    def handler(request):
        calls.append(request)
        assert request.url.path == "/www/zh-tw/bulletin/exDailyQ"
        assert request.url.params["startDate"] == "2021/01/01"
        return httpx.Response(200, json=payload())
    options = dict(symbols=["6488", "2330"], catalog={"6488": {"market": "TPEx"}, "2330": {"market": "TWSE"}},
                   start=date(2021, 1, 1), end=date(2021, 12, 31), out=tmp_path / "report.json")
    with httpx.Client(transport=httpx.MockTransport(handler)) as http:
        report = history.backfill(db_session.bind, http, **options)
        assert report["ok"] and report["periods"]["2021"]["rows"] == 1
        history.backfill(db_session.bind, http, **options, resume=True)
    assert len(calls) == 1
    row = db_session.scalars(select(DividendResult)).one()
    assert row.symbol == "6488" and row.before_price == 900 and row.after_price == 890
    assert row.stock_or_cash_dividend == "除息"


@pytest.mark.parametrize("fault", ["wrong_range", "truncated", "announcement_schema"])
def test_tpex_results_reject_wrong_or_incomplete_feed(fault):
    body = payload()
    if fault == "wrong_range":
        body["date"] = "20260101~20261231"
    elif fault == "truncated":
        body["tables"][0]["totalCount"] = 2
    else:
        body["tables"][0]["fields"][2] = "預定除權息日期"
    with httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=body))) as http:
        with pytest.raises(ValueError):
            history.fetch_results(http, date(2021, 1, 1), date(2021, 12, 31), {"6488"})
