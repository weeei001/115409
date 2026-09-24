import pandas as pd
import csv
import json
from datetime import date, datetime
from decimal import Decimal

import httpx
import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from app.jobs.finmind import fetch, import_csv, transforms
from app.db.models.daily_price import DailyPrice
from app.db.models.technical_indicator import TechnicalIndicator
from app.db.models.institutional_trade import InstitutionalTrade
from app.db.models.finmind_extra import (FinancialStatementRow, MonthlyRevenue, StockValuation,
    DividendResult, MarginTrade, ForeignShareholding, HoldingShareLevel)

from app.jobs.finmind.transforms import (
    normalize_financial_statement_df,
    normalize_foreign_shareholding_df,
    normalize_margin_df,
    normalize_monthly_revenue_df,
    normalize_per_pbr_df,
)


def test_statement_normalizer_adds_statement_and_renames_type():
    raw = pd.DataFrame(
        [
            {
                "date": "2024-03-31",
                "stock_id": "2330",
                "type": "EPS",
                "origin_name": "基本每股盈餘",
                "value": "8.70",
            }
        ]
    )

    out = normalize_financial_statement_df(raw, "2330", "income")

    assert out.to_dict("records") == [
        {
            "date": "2024-03-31",
            "symbol": "2330",
            "statement": "income",
            "item_type": "EPS",
            "origin_name": "基本每股盈餘",
            "value": 8.7,
        }
    ]


def test_monthly_revenue_normalizer_coerces_schema():
    raw = pd.DataFrame(
        [
            {
                "date": "2024-05-01",
                "stock_id": 2330,
                "country": "Taiwan",
                "revenue": "229620000000",
                "revenue_month": "4",
                "revenue_year": "2024",
                "create_time": "",
            }
        ]
    )

    out = normalize_monthly_revenue_df(raw, "2330")

    row = out.iloc[0].to_dict()
    assert row["symbol"] == "2330"
    assert row["revenue"] == 229620000000
    assert row["revenue_month"] == 4
    assert row["revenue_year"] == 2024


def test_per_pbr_normalizer_coerces_numbers_and_names():
    raw = pd.DataFrame(
        [{"date": "2024-01-02", "stock_id": "2330", "dividend_yield": "1.5", "PER": "18.2", "PBR": ""}]
    )

    out = normalize_per_pbr_df(raw, "2330")

    row = out.iloc[0].to_dict()
    assert row["symbol"] == "2330"
    assert row["dividend_yield"] == 1.5
    assert row["per"] == 18.2
    assert pd.isna(row["pbr"])


def test_margin_normalizer_coerces_numeric_columns():
    raw = pd.DataFrame(
        [
            {
                "date": "2024-01-02",
                "stock_id": "2330",
                "MarginPurchaseBuy": "10",
                "MarginPurchaseSell": "2",
                "MarginPurchaseTodayBalance": "100",
                "ShortSaleBuy": "",
                "ShortSaleSell": "3",
                "ShortSaleTodayBalance": "20",
            }
        ]
    )

    out = normalize_margin_df(raw, "2330")

    row = out.iloc[0].to_dict()
    assert row["margin_purchase_buy"] == 10
    assert row["margin_purchase_sell"] == 2
    assert row["margin_purchase_today_balance"] == 100
    assert pd.isna(row["short_sale_buy"])
    assert row["short_sale_sell"] == 3


def test_foreign_shareholding_normalizer_coerces_numeric_columns():
    raw = pd.DataFrame(
        [
            {
                "date": "2024-01-02",
                "stock_id": "2330",
                "stock_name": "台積電",
                "InternationalCode": "TW0002330008",
                "ForeignInvestmentRemainingShares": "100",
                "ForeignInvestmentShares": "900",
                "ForeignInvestmentRemainRatio": "10.5",
                "ForeignInvestmentSharesRatio": "89.5",
                "ForeignInvestmentUpperLimitRatio": "100",
                "ChineseInvestmentUpperLimitRatio": "",
                "NumberOfSharesIssued": "1000",
                "RecentlyDeclareDate": "2023-12-31",
                "note": "",
            }
        ]
    )

    out = normalize_foreign_shareholding_df(raw, "2330")

    row = out.iloc[0].to_dict()
    assert row["foreign_investment_remaining_shares"] == 100
    assert row["foreign_investment_shares"] == 900
    assert row["foreign_investment_remain_ratio"] == 10.5
    assert pd.isna(row["chinese_investment_upper_limit_ratio"])
    assert row["number_of_shares_issued"] == 1000


def raw_dataset(name, symbol):
    common = {"date": "2024-01-06", "stock_id": symbol}
    if name == "TaiwanStockPrice":
        return [{"date": f"2024-01-{day:02d}", "stock_id": symbol, "open": 100 + day,
                 "max": 102 + day, "min": 99 + day, "close": 100 + day,
                 "Trading_Volume": day * 1000, "Trading_money": day * 100000,
                 "spread": 1, "Trading_turnover": 20} for day in range(1, 9)]
    if name == "TaiwanStockInstitutionalInvestorsBuySell":
        return [{**common, "name": investor, "buy": buy, "sell": sell} for investor, buy, sell in (
            ("Foreign_Investor", 100, 40), ("Investment_Trust", 20, 30),
            ("Dealer_self", 10, 0), ("Dealer_Hedging", 5, 2), ("Unknown", 999, 0))]
    if name in {"TaiwanStockFinancialStatements", "TaiwanStockBalanceSheet", "TaiwanStockCashFlowsStatement"}:
        return [{**common, "type": "EPS", "origin_name": "Earnings", "value": "10.12345"}]
    if name == "TaiwanStockMonthRevenue":
        return [{**common, "country": "Taiwan", "revenue": "9007199254740993",
                 "revenue_month": 1, "revenue_year": 2024, "create_time": ""}]
    if name == "TaiwanStockPER":
        return [{**common, "PER": "18.12345", "PBR": "", "dividend_yield": "1.5"}]
    if name == "TaiwanStockDividendResult":
        return [{**common, "stock_and_cache_dividend": "4.12345", "stock_or_cache_dividend": "cash"}]
    if name == "TaiwanStockMarginPurchaseShortSale":
        return [{**common, "MarginPurchaseBuy": "10", "ShortSaleTodayBalance": "20"}]
    if name == "TaiwanStockShareholding":
        return [{**common, "NumberOfSharesIssued": "9007199254740993", "ForeignInvestmentSharesRatio": "80.12345",
                 "RecentlyDeclareDate": "2023-12-31"}]
    if name == "TaiwanStockHoldingSharesPer":
        return [{**common, "HoldingSharesLevel": "1-999", "people": "10", "percent": "5.12345", "unit": "100"}]
    raise AssertionError(name)


def mock_finmind(request):
    assert request.url.path == "/api/v4/data"
    assert request.headers["Authorization"] == "Bearer test-job-token"
    return httpx.Response(200, json={"status": 200, "data": raw_dataset(request.url.params["dataset"], request.url.params["data_id"])})


def test_export_and_import_all_datasets_with_warmup_decimal_and_schema_safety(tmp_path, db_session):
    args = fetch.parse_args(["--stock", "2330", "--start", "2024-01-06", "--end", "2024-01-08",
                             "--out", str(tmp_path), "--warmup-days", "5", "--include-holding-shares-per"])
    requests = []
    def provider(request):
        requests.append(dict(request.url.params))
        return mock_finmind(request)
    with httpx.Client(transport=httpx.MockTransport(provider)) as http:
        counts, failed = fetch.export_symbol("2330", args, fetch.FinMindClient(http, "test-job-token", retries=0))
    assert not failed and len(list(tmp_path.glob("*.csv"))) == 10
    assert counts["price_volume"] == counts["technical"] == 3
    assert requests[0]["start_date"] == "2024-01-01"
    technical = pd.read_csv(tmp_path / "2330_technical.csv")
    assert technical.iloc[0]["ma5"] == 104.0
    statements = []
    listener = lambda conn, cursor, statement, parameters, context, executemany: statements.append(statement)
    event.listen(db_session.bind, "before_cursor_execute", listener)
    try:
        with db_session.begin():
            imported = import_csv.import_symbol(db_session, tmp_path, "2330")
    finally:
        event.remove(db_session.bind, "before_cursor_execute", listener)
    assert imported["financial_statements"] == 3 and imported["technical"] == 3
    assert not any(sql.lstrip().upper().startswith(("CREATE", "ALTER", "DROP")) for sql in statements)
    key = (date(2024, 1, 6), "2330")
    assert db_session.get(DailyPrice, key).close == Decimal("106.00")
    assert db_session.get(TechnicalIndicator, key).ma5 == Decimal("104.00")
    assert db_session.get(InstitutionalTrade, key).total_institutional_net == 63
    assert db_session.get(MonthlyRevenue, key).revenue == 9007199254740993
    assert db_session.get(StockValuation, key).per == Decimal("18.1235")
    assert db_session.get(StockValuation, key).pbr is None
    assert db_session.get(DividendResult, key).stock_and_cash_dividend == Decimal("4.1235")
    assert db_session.get(MarginTrade, key).margin_purchase_buy == 10
    assert db_session.get(ForeignShareholding, key).number_of_shares_issued == 9007199254740993
    assert db_session.get(HoldingShareLevel, (*key, "1-999")).percent == Decimal("5.1235")
    assert db_session.get(FinancialStatementRow, (*key, "income", "EPS", "Earnings")).value == Decimal("10.1235")


def write_csv(path, rows, fields=None):
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields or list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def test_import_last_duplicate_preserves_leading_zero_bigint_and_volume_average(tmp_path, db_session):
    columns = [column.name for column in DailyPrice.__table__.columns]
    rows = [{**dict.fromkeys(columns, ""), "date": f"2024-01-0{day}", "symbol": "0050", "close": "10.005",
             "volume_shares": str(day * 100), "amount": "9007199254740993"} for day in range(1, 6)]
    rows.append({**rows[-1], "close": "11.005"})
    write_csv(tmp_path / "0050_price_volume.csv", rows)
    write_csv(tmp_path / "0050_technical.csv", [{"date": row["date"], "symbol": "0050", "close": "999"} for row in rows])
    with db_session.begin():
        import_csv.import_symbol(db_session, tmp_path, "0050")
    key = (date(2024, 1, 5), "0050")
    assert db_session.get(DailyPrice, key).close == Decimal("11.01")
    assert db_session.get(DailyPrice, key).amount == 9007199254740993
    assert len(db_session.scalars(select(DailyPrice)).all()) == 5
    assert db_session.get(TechnicalIndicator, key).close == Decimal("11.01")
    assert db_session.get(TechnicalIndicator, key).volume_ma5 == Decimal("300.00")
    db_session.rollback()
    with db_session.begin():
        import_csv.import_symbol(db_session, tmp_path, "0050")
    assert len(db_session.scalars(select(DailyPrice)).all()) == 5


def test_import_transaction_rolls_back_earlier_table_on_later_bad_csv(tmp_path, db_session):
    row = {**dict.fromkeys([column.name for column in DailyPrice.__table__.columns], ""),
           "date": "2024-01-01", "symbol": "2330", "close": "10"}
    write_csv(tmp_path / "2330_price_volume.csv", [row])
    write_csv(tmp_path / "2330_institutional.csv", [{"date": "2024-01-01", "symbol": "2330"}])
    with pytest.raises(ValueError, match="missing columns"):
        with db_session.begin():
            import_csv.import_symbol(db_session, tmp_path, "2330")
    assert db_session.scalars(select(DailyPrice)).all() == []


def test_indicator_flat_and_rising_wilder_kdj_bollinger_and_partial_window():
    raw = raw_dataset("TaiwanStockPrice", "2330")
    frame = transforms.normalize_price_df(pd.DataFrame(raw), "2330")
    full = transforms.compute_technical_indicators(frame)
    partial = transforms.compute_technical_indicators(frame, partial_ma=True)
    assert pd.isna(full.iloc[0].ma5) and partial.iloc[0].ma5 == 101
    assert full.iloc[5].rsi5 == 100
    assert full.iloc[0].kd_k9 == pytest.approx(50 * 2 / 3 + (1 / 3 * 100) / 3)
    assert partial.iloc[0].boll_upper20 == partial.iloc[0].boll_lower20 == 101
    assert full.iloc[-1].macd_signal == full.iloc[-1].macd_dea
    assert transforms.compute_rsi_wilder(pd.Series([10] * 7), 5).iloc[-1] == 50


@pytest.mark.parametrize("failure", ["timeout", "status", "missing_data", "malformed"])
def test_finmind_client_retries_and_sanitizes_errors(monkeypatch, failure):
    calls, sleeps = [], []
    def provider(request):
        calls.append(request)
        if failure == "timeout":
            raise httpx.ReadTimeout("private token")
        if failure == "status":
            return httpx.Response(429, text="private token")
        if failure == "malformed":
            return httpx.Response(200, text="private token")
        return httpx.Response(200, json={"status": 200, "secret": "private token"})
    monkeypatch.setattr(fetch.time, "sleep", sleeps.append)
    with httpx.Client(transport=httpx.MockTransport(provider)) as http, pytest.raises(RuntimeError) as error:
        fetch.FinMindClient(http, "private token", retries=2).dataset("TaiwanStockPrice", "2330", "2024-01-01", "2024-01-02")
    assert len(calls) == 3 and sleeps == [1.5, 3.0]
    assert "private" not in str(error.value)


def test_finmind_client_honors_hourly_request_limit(tmp_path):
    calls = []

    def provider(request):
        calls.append(request)
        return mock_finmind(request)

    usage_path = tmp_path / "finmind_api_usage.json"
    with httpx.Client(transport=httpx.MockTransport(provider)) as http:
        client = fetch.FinMindClient(http, "test-job-token", retries=0, max_requests=2,
                                     usage_path=usage_path)
        client.dataset("TaiwanStockPrice", "2330", "2024-01-01", "2024-01-02")
        client.dataset("TaiwanStockPrice", "2330", "2024-01-01", "2024-01-02")
        with pytest.raises(fetch.RequestLimitReached):
            client.dataset("TaiwanStockPrice", "2330", "2024-01-01", "2024-01-02")
    with httpx.Client(transport=httpx.MockTransport(provider)) as http:
        with pytest.raises(fetch.RequestLimitReached):
            fetch.FinMindClient(http, "test-job-token", retries=0, max_requests=2,
                                usage_path=usage_path).dataset(
                                    "TaiwanStockPrice", "2330", "2024-01-01", "2024-01-02")
    assert len(calls) == client.requests_made == 2


def test_paid_dataset_opt_in_and_export_failure_nonzero(tmp_path, settings, monkeypatch, capsys):
    monkeypatch.setattr(fetch, "get_settings", lambda: settings.model_copy(update={"FINMIND_API_TOKEN": "settings-token"}))
    seen = []
    def export(symbol, args, client):
        seen.append((symbol, client.token, args.include_holding_shares_per))
        if symbol == "2330":
            raise RuntimeError("private token")
        return {}, False
    monkeypatch.setattr(fetch, "export_symbol", export)
    result = fetch.main(["--stocks", "2330,2317", "--start", "2024-01-01", "--end", "2024-01-02", "--out", str(tmp_path)])
    assert result == 1 and seen == [("2330", "settings-token", False), ("2317", "settings-token", False)]
    assert json.loads(capsys.readouterr().out) == {"symbol": "2317", "rows": {}, "failed": False}
    assert fetch.main(["--stock", "2317", "--start", "2024-01-01", "--token", "cli-token", "--include-holding-shares-per"]) == 0
    assert seen[-1] == ("2317", "cli-token", True)


def test_from_stock_info_exports_every_symbol(tmp_path, settings, monkeypatch):
    monkeypatch.setattr(fetch, "get_settings", lambda: settings)
    monkeypatch.setattr(fetch, "stock_info_symbols", lambda configured: ["1101", "2330"])
    seen = []

    def export(symbol, args, client):
        seen.append(symbol)
        return {}, False

    monkeypatch.setattr(fetch, "export_symbol", export)
    assert fetch.main(["--from-stock-info", "--start", "2024-01-01", "--out", str(tmp_path)]) == 0
    assert seen == ["1101", "2330"]


def test_optional_paid_dataset_failure_is_visible_and_default_skips_http(tmp_path):
    args = fetch.parse_args(["--stock", "2330", "--start", "2024-01-06", "--end", "2024-01-08", "--out", str(tmp_path)])
    called = []
    def provider(request):
        called.append(request.url.params["dataset"])
        if called[-1] == "TaiwanStockHoldingSharesPer":
            return httpx.Response(403)
        return mock_finmind(request)
    with httpx.Client(transport=httpx.MockTransport(provider)) as http:
        client = fetch.FinMindClient(http, "test-job-token", retries=0)
        counts, failed = fetch.export_symbol("2330", args, client)
        assert not failed and counts["holding_shares_per"] == 0
        assert "TaiwanStockHoldingSharesPer" not in called
        args.include_holding_shares_per = True
        _, failed = fetch.export_symbol("2330", args, client)
        assert failed and "TaiwanStockHoldingSharesPer" in called


def test_import_cli_returns_nonzero_and_disposes_engine_on_bad_data(tmp_path, db_session, settings, monkeypatch):
    engine = db_session.bind
    write_csv(tmp_path / "2330_price_volume.csv", [{"bad": "format"}])
    disposed = []
    monkeypatch.setattr(import_csv, "get_settings", lambda: settings)
    monkeypatch.setattr(import_csv, "make_engine", lambda settings: engine)
    monkeypatch.setattr(engine, "dispose", lambda: disposed.append(True))
    assert import_csv.main(["--input-dir", str(tmp_path)]) == 1
    assert disposed == [True]


def test_import_cli_prints_committed_counts(tmp_path, db_session, settings, monkeypatch, capsys):
    row = {**dict.fromkeys([column.name for column in DailyPrice.__table__.columns], ""),
           "date": "2024-01-01", "symbol": "2330", "close": "10"}
    write_csv(tmp_path / "2330_price_volume.csv", [row])
    monkeypatch.setattr(import_csv, "get_settings", lambda: settings)
    monkeypatch.setattr(import_csv, "make_engine", lambda settings: db_session.bind)
    monkeypatch.setattr(db_session.bind, "dispose", lambda: None)
    assert import_csv.main(["--input-dir", str(tmp_path)]) == 0
    summary = json.loads(capsys.readouterr().out)
    assert summary["symbol"] == "2330" and summary["rows"]["price_volume"] == 1
    assert db_session.get(DailyPrice, (date(2024, 1, 1), "2330")).close == Decimal("10.00")


@pytest.mark.parametrize("arguments", [["--start", "2024-02-31"], ["--start", "2024-02-01", "--end", "2024-01-01"],
    ["--start", "2024-01-01", "--stock", "../bad"], ["--start", "2024-01-01", "--retries", "-1"],
    ["--start", "2024-01-01", "--timeout", "NaN"], ["--start", "2024-01-01", "--timeout", "inf"],
    ["--start", "2024-01-01", "--timeout=-inf"]])
def test_invalid_cli_ranges_and_paths_fail_before_any_request(arguments):
    with pytest.raises(SystemExit) as error:
        fetch.parse_args(arguments)
    assert error.value.code == 2
