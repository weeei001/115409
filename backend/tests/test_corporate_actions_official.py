from datetime import date
from decimal import Decimal

import httpx
import pytest

from app.db.models.finmind_extra import DividendResult
from app.jobs.finmind.import_csv import normalized_rows, upsert_rows
from app.jobs.market.corporate_actions import fetch_dividend_results


CATALOG = {"2330": {"market": "TWSE"}, "6488": {"market": "TPEx"}}


def test_official_ex_right_results_use_actual_dates_and_preserve_sparse_values(db_session):
    twse_fields = ["資料日期", "股票代號", "除權息前收盤價", "除權息參考價", "權值+息值",
                   "權/息", "漲停價格", "跌停價格", "開盤競價基準", "減除股利參考價"]
    twse_result = {"stat": "OK", "fields": twse_fields,
                   "data": [["115年08月14日", "2330", "100", "93", "7", "息", "102", "84", "93", "N/A"]]}
    tpex_result = [{"Date": "1150815", "SecuritiesCompanyCode": "6488",
                    "ClosePriceBeforeExRightsDiviend": "50", "ExRightsDiviendQuote": "46",
                    "StockDividendPlusCashDividend": "4", "ExRightsDiviend": "權息",
                    "LimitUp": "50.6", "LimitDown": "41.4", "OpeningReferencePrice": "46",
                    "DividendDeductedQuote": "47"}]

    def provider(request):
        path = request.url.path
        if path.endswith("TWT49U"):
            assert request.url.params["startDate"] == "20260801"
            assert request.url.params["endDate"] == "20260831"
            return httpx.Response(200, json=twse_result)
        if path.endswith("tpex_exright_daily"):
            return httpx.Response(200, json=tpex_result)
        raise AssertionError(path)

    with httpx.Client(transport=httpx.MockTransport(provider)) as http:
        results = fetch_dividend_results(http, date(2026, 8, 1), date(2026, 8, 31), CATALOG)
    assert {(row["symbol"], row["date"]) for row in results} == {
        ("2330", "2026-08-14"), ("6488", "2026-08-15")}
    assert results[0]["stock_and_cash_dividend"] == "7"
    assert results[0]["reference_price"] == ""

    db_session.add(DividendResult(date=date(2026, 8, 14), symbol="2330",
                                  reference_price=Decimal("93")))
    db_session.commit()
    upsert_rows(db_session, DividendResult, normalized_rows(DividendResult, results[:1], "2330"))
    db_session.commit()
    assert db_session.get(DividendResult, (date(2026, 8, 14), "2330")).reference_price == Decimal("93")


def test_changed_result_schema_fails_closed():
    def provider(request):
        if request.url.path.endswith("TWT49U"):
            return httpx.Response(200, json={"stat": "OK", "fields": ["股票代號"], "data": [["2330"]]})
        return httpx.Response(200, json=[])

    with httpx.Client(transport=httpx.MockTransport(provider)) as http:
        with pytest.raises(ValueError, match="TWSE ex-right result schema"):
            fetch_dividend_results(http, date(2026, 8, 1), date(2026, 8, 31), CATALOG)


def test_no_event_day_is_empty_not_a_source_failure():
    def provider(request):
        if request.url.path.endswith("TWT49U"):
            return httpx.Response(200, json={"stat": "很抱歉，沒有符合條件的資料!"})
        return httpx.Response(200, json=[])

    with httpx.Client(transport=httpx.MockTransport(provider)) as http:
        assert fetch_dividend_results(http, date(2026, 8, 30), date(2026, 8, 30), CATALOG) == []
