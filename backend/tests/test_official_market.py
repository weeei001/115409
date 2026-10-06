import json
from datetime import date
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

import app.db.models
from app.db.session import Base
from app.db.models.daily_price import DailyPrice
from app.db.models.market_extra import MonthlyRevenue, StockValuation
from app.features.market import company_catalog
from app.jobs.market import import_csv
from app.jobs.market import fetch
from app.jobs.market import corporate_actions, foreign_shareholding, institutional, margin, mops_financial, tdcc_shareholding


def official(request):
    path = request.url.path
    if path.endswith("t187ap03_L"):
        return httpx.Response(200, json=[{"公司代號": "2330", "公司簡稱": "台積電", "公司名稱": "台灣積體電路製造股份有限公司",
                                         "產業別": "24"}])
    if path.endswith("mopsfin_t187ap03_O"):
        return httpx.Response(503)
    if path.endswith("t187ap03_O.csv"):
        return httpx.Response(200, text="\ufeff公司代號,公司簡稱,公司名稱,產業別\n5347,世界,世界先進積體電路股份有限公司,24\n")
    if path.endswith("STOCK_DAY_ALL"):
        return httpx.Response(200, json=[{"Date": "1150923", "Code": "2330", "OpeningPrice": "100.00",
            "HighestPrice": "102", "LowestPrice": "99", "ClosingPrice": "101", "TradeVolume": "1,000",
            "TradeValue": "101,000", "Change": "+1", "Transaction": "25"}])
    if path.endswith("tpex_mainboard_quotes"):
        return httpx.Response(200, json=[{"Date": "1150923", "SecuritiesCompanyCode": "5347",
            "Open": "50", "High": "51", "Low": "49", "Close": "50", "TradingShares": "2000",
            "TransactionAmount": "100000", "Change": "-1", "TransactionNumber": "20"}])
    if path.endswith("BWIBBU_ALL"):
        return httpx.Response(200, json=[{"Date": "1150923", "Code": "2330", "PEratio": "18.2",
            "PBratio": "4.5", "DividendYield": "1.3"}])
    if path.endswith("tpex_mainboard_peratio_analysis"):
        return httpx.Response(200, json=[{"Date": "1150923", "SecuritiesCompanyCode": "5347",
            "PriceEarningRatio": "N/A", "PriceBookRatio": "2.0", "YieldRatio": "0.0"}])
    if path.endswith("t187ap05_L.csv"):
        return httpx.Response(200, text="出表日期,資料年月,公司代號,營業收入-當月營收\n1150910,11508,2330,100000\n")
    if path.endswith("t187ap05_O.csv"):
        return httpx.Response(200, text="出表日期,資料年月,公司代號,營業收入-當月營收\n1150910,11508,5347,200000\n")
    if path.endswith(("MI_QFIIS", "tpex_3insti_qfii")):
        return httpx.Response(503)
    raise AssertionError(path)


def test_catalog_fallback_preserves_previous_snapshot_on_failure(tmp_path):
    path = tmp_path / "catalog.json"
    with httpx.Client(transport=httpx.MockTransport(official)) as http:
        catalog = company_catalog.refresh_catalog(http, path)
    assert catalog["2330"]["name"] == "台積電"
    assert catalog["5347"]["market"] == "TPEx"
    assert catalog["2330"]["industry"] == "TWSE:24"
    assert catalog["5347"]["industry"] == "TPEx:24"
    assert catalog["2330"]["industry_name"] == catalog["5347"]["industry_name"] == "半導體業"
    assert company_catalog.load_catalog(path) == catalog
    with httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(503))) as http:
        with pytest.raises(httpx.HTTPStatusError):
            company_catalog.refresh_catalog(http, path)
    assert company_catalog.load_catalog(path) == catalog


def test_catalog_reads_tpex_industry_code_and_handles_missing_codes():
    rows = [{"SecuritiesCompanyCode": "5347", "CompanyAbbreviation": "世界",
             "SecuritiesIndustryCode": " 5 ", "SecuritiesIndustryName": "電機機械"},
            {"SecuritiesCompanyCode": "1234", "CompanyAbbreviation": "新公司"}]
    catalog = company_catalog._parse(rows, "TPEx")
    assert catalog["5347"]["industry"] == "TPEx:05"
    assert catalog["5347"]["industry_name"] == "電機機械"
    assert catalog["1234"]["industry"] is None


def test_catalog_restores_official_names_in_cached_code_only_rows(tmp_path):
    path = tmp_path / "catalog.json"
    path.write_text(json.dumps({"2330": {"market": "TWSE", "industry_code": "24"},
                                "5347": {"market": "TPEx", "industry_code": "17"}}), encoding="utf-8")
    catalog = company_catalog.load_catalog(path)
    assert catalog["2330"]["industry_name"] == "半導體業"
    assert catalog["5347"]["industry_name"] == "金融業"


def test_full_market_export_and_sparse_import_preserve_existing_data(tmp_path, db_session, monkeypatch):
    monkeypatch.setattr(fetch, "refresh_catalog", lambda http: company_catalog.refresh_catalog(http, tmp_path / "catalog.json"))
    for module in (foreign_shareholding, institutional, margin):
        monkeypatch.setattr(module, "fetch_twse", lambda http, day: [{"date": day.isoformat(), "symbol": "2330"}])
        monkeypatch.setattr(module, "fetch_tpex", lambda http: [{"date": "2026-09-23", "symbol": "5347"}])
    monkeypatch.setattr(tdcc_shareholding, "fetch", lambda http, symbols: [
        {"date": "2026-09-18", "symbol": symbol, "holding_shares_level": "1-999"} for symbol in symbols])
    monkeypatch.setattr(corporate_actions, "fetch_dividend_results", lambda http, start, end, catalog: [])
    monkeypatch.setattr(mops_financial, "fetch_quarter", lambda http, year, quarter, catalog: [])
    args = SimpleNamespace(symbols=[], start="2021-01-01", end="2026-09-24", out=tmp_path)
    with httpx.Client(transport=httpx.MockTransport(official)) as http:
        report = fetch.export(args, fetch.OfficialClient(http, retries=0))
    assert report["selected"] == 2 and report["datasets"] == {
        "price_volume": 2, "per_pbr": 2, "monthly_revenue": 2,
        "foreign_shareholding": 2, "institutional": 2, "margin": 2,
        "holding_shares_per": 2, "dividend_result": 0, "financial_statements": 0}
    assert json.loads((tmp_path / "market_manifest.json").read_text()) == {
        "2330": ["foreign_shareholding", "holding_shares_per", "institutional", "margin", "monthly_revenue", "per_pbr", "price_volume"],
        "5347": ["foreign_shareholding", "holding_shares_per", "institutional", "margin", "monthly_revenue", "per_pbr", "price_volume"]}
    db_session.add(DailyPrice(date=date(2026, 9, 23), symbol="2330", close=Decimal("98")))
    db_session.add(MonthlyRevenue(date=date(2026, 8, 1), symbol="2330", country="Taiwan", revenue=1))
    db_session.commit()
    with db_session.begin():
        import_csv.import_symbol(db_session, tmp_path, "2330", ["price_volume", "per_pbr", "monthly_revenue"])
    price = db_session.get(DailyPrice, (date(2026, 9, 23), "2330"))
    assert price.close == Decimal("101.00") and price.volume_shares == 1000
    revenue = db_session.get(MonthlyRevenue, (date(2026, 8, 1), "2330"))
    assert revenue.country == "Taiwan" and revenue.revenue == 100000000
    assert db_session.get(StockValuation, (date(2026, 9, 23), "2330")).per == Decimal("18.2000")


def test_unmapped_snapshot_fails_before_manifest_can_be_reused(tmp_path, monkeypatch):
    monkeypatch.setattr(fetch, "refresh_catalog", lambda http: {"2330": {"market": "TWSE"}, "5347": {"market": "TPEx"}})
    (tmp_path / "market_manifest.json").write_text('{"2330": ["price_volume"]}')
    (tmp_path / "financial_progress_pending.json").write_text('{"quarter":"2026Q2","offset":100}')
    args = SimpleNamespace(symbols=[], start="2021-01-01", end="2026-09-24", out=tmp_path)
    def changed(request):
        if request.url.path.endswith("STOCK_DAY_ALL"):
            return httpx.Response(200, json=[{"Date": "1150923", "Code": "2330", "unexpected": "1"}])
        return official(request)
    with httpx.Client(transport=httpx.MockTransport(changed)) as http:
        with pytest.raises(ValueError, match="No mapped TWSE price_volume"):
            fetch.export(args, fetch.OfficialClient(http, retries=0))
    assert not (tmp_path / "market_manifest.json").exists()
    assert not (tmp_path / "financial_progress_pending.json").exists()


def test_financial_checkpoint_advances_only_after_complete_import(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    Base.metadata.create_all(engine)
    monkeypatch.setattr(import_csv, "make_engine", lambda settings: engine)
    monkeypatch.setattr(import_csv, "get_settings", lambda: None)
    (tmp_path / "market_manifest.json").write_text('{"2330": ["financial_statements"]}')
    pending = tmp_path / "financial_progress_pending.json"
    progress = tmp_path / "financial_progress.json"
    pending.write_text('{"quarter":"2026Q2","offset":100}')
    assert import_csv.main(["--input-dir", str(tmp_path), "--require-manifest"]) == 1
    assert not progress.exists() and pending.exists()
    (tmp_path / "2330_financial_statements.csv").write_text(
        "date,symbol,statement,item_type,origin_name,value\n"
        "2026-06-30,2330,income,MOPS_YTD_TEST,Test account,1000\n", encoding="utf-8")
    assert import_csv.main(["--input-dir", str(tmp_path), "--require-manifest"]) == 0
    assert json.loads(progress.read_text()) == {"quarter": "2026Q2", "offset": 100}
    assert not pending.exists()


def test_annual_financial_report_waits_for_filing_window(monkeypatch):
    class FutureDate(date):
        @classmethod
        def today(cls):
            return cls(2027, 4, 10)

    monkeypatch.setattr(fetch, "date", FutureDate)
    assert fetch.latest_filed_quarter(date(2027, 2, 28)) == (2026, 3)
    assert fetch.latest_filed_quarter(date(2027, 4, 10)) == (2026, 4)
