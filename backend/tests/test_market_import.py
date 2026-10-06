"""Market CSV import precision, transaction, and CLI regression coverage."""
import csv
import json
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import event, select

from app.jobs.market import import_csv
from app.db.models.daily_price import DailyPrice
from app.db.models.technical_indicator import TechnicalIndicator


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


def test_import_all_datasets_preserves_decimal_bigint_and_schema(tmp_path, db_session):
    values = {
        "price_volume": {"close": "106.00"},
        "institutional": {"total_institutional_net": "63"},
        "financial_statements": {"statement": "income", "item_type": "EPS", "origin_name": "Earnings", "value": "10.12345"},
        "monthly_revenue": {"revenue": "9007199254740993", "revenue_month": "1", "revenue_year": "2024"},
        "per_pbr": {"per": "18.12345"},
        "dividend_result": {"stock_and_cash_dividend": "4.12345"},
        "margin": {"margin_purchase_buy": "10"},
        "foreign_shareholding": {"number_of_shares_issued": "9007199254740993"},
        "holding_shares_per": {"holding_shares_level": "1-999", "percent": "5.12345"},
    }
    for suffix, model in import_csv.CSV_MODELS.items():
        row = {**dict.fromkeys([column.name for column in model.__table__.columns], ""),
               "date": "2024-01-06", "symbol": "2330", **values[suffix]}
        write_csv(tmp_path / f"2330_{suffix}.csv", [row])
    statements = []
    listener = lambda conn, cursor, statement, parameters, context, executemany: statements.append(statement)
    event.listen(db_session.bind, "before_cursor_execute", listener)
    try:
        with db_session.begin():
            imported = import_csv.import_symbol(db_session, tmp_path, "2330")
    finally:
        event.remove(db_session.bind, "before_cursor_execute", listener)
    assert all(imported[suffix] == 1 for suffix in values)
    assert not any(sql.lstrip().upper().startswith(("CREATE", "ALTER", "DROP")) for sql in statements)
    key = (date(2024, 1, 6), "2330")
    expected = {
        "price_volume": ("close", Decimal("106.00")),
        "institutional": ("total_institutional_net", 63),
        "financial_statements": ("value", Decimal("10.1235")),
        "monthly_revenue": ("revenue", 9007199254740993),
        "per_pbr": ("per", Decimal("18.1235")),
        "dividend_result": ("stock_and_cash_dividend", Decimal("4.1235")),
        "margin": ("margin_purchase_buy", 10),
        "foreign_shareholding": ("number_of_shares_issued", 9007199254740993),
        "holding_shares_per": ("percent", Decimal("5.1235")),
    }
    for suffix, (field, value) in expected.items():
        model_key = (*key, "income", "EPS", "Earnings") if suffix == "financial_statements" else (
            (*key, "1-999") if suffix == "holding_shares_per" else key)
        assert getattr(db_session.get(import_csv.CSV_MODELS[suffix], model_key), field) == value
    assert db_session.get(import_csv.CSV_MODELS["per_pbr"], key).pbr is None
