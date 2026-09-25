from datetime import date

import httpx
import pytest
from sqlalchemy import select

from app.db.models.benchmark_price import BenchmarkPrice
from app.jobs.market import benchmark
from app.jobs.market_history import OfficialClient


# Official September 2024 MI_5MINS_HIST response, reduced to three real rows.
# https://www.twse.com.tw/indicesReport/MI_5MINS_HIST?date=20240901&response=json
OFFICIAL = {
    "stat": "OK", "date": "20240901",
    "fields": ["日期", "開盤指數", "最高指數", "最低指數", "收盤指數"],
    "data": [
        ["113/09/02", "22,341.90", "22,439.31", "22,178.04", "22,235.10"],
        ["113/09/03", "22,240.11", "22,303.50", "22,092.21", "22,092.21"],
        ["113/09/04", "21,574.65", "21,574.65", "20,922.17", "21,092.75"],
    ],
}


def test_official_parser_filters_range_and_preserves_gaps():
    rows = benchmark.parse(OFFICIAL, date(2024, 9, 3), date(2024, 9, 4))
    assert rows == [
        {"symbol": "TAIEX", "date": date(2024, 9, 3), "close": "22092.21"},
        {"symbol": "TAIEX", "date": date(2024, 9, 4), "close": "21092.75"},
    ]
    missing = {**OFFICIAL, "data": [OFFICIAL["data"][0], ["113/09/03", "", "", "", "--"], OFFICIAL["data"][2]]}
    assert [row["date"].day for row in benchmark.parse(missing, date(2024, 9, 1), date(2024, 9, 30))] == [2, 4]
    assert benchmark.parse({"stat": "很抱歉，沒有符合條件的資料!"}, date(2024, 9, 1), date(2024, 9, 30)) == []
    with pytest.raises(ValueError, match="fields"):
        benchmark.parse({**OFFICIAL, "fields": ["changed"]}, date(2024, 9, 1), date(2024, 9, 30))


@pytest.mark.parametrize("raw_date,close", [("invalid113/09/02", "1"), ("113/02/31", "1"),
                                         ("113/09/02", "9" * 400), ("113/09/02", "0")])
def test_parser_rejects_malformed_dates_and_out_of_range_closes(raw_date, close):
    with pytest.raises(ValueError):
        benchmark.parse({**OFFICIAL, "data": [[raw_date, "", "", "", close]]},
                        date(2024, 1, 1), date(2024, 12, 31))


@pytest.mark.parametrize("close", ["NaN", "Infinity", "-Infinity", "--"])
def test_parser_never_persists_nonfinite_values(close):
    assert benchmark.parse({**OFFICIAL, "data": [["113/09/02", "", "", "", close]]},
                           date(2024, 9, 1), date(2024, 9, 30)) == []


def test_import_is_idempotent_and_refreshes_latest_month(db_session):
    requested = []
    def official(request):
        requested.append(request.url.params["date"])
        return httpx.Response(200, json=OFFICIAL)

    db_session.add(BenchmarkPrice(symbol="TAIEX", date=date(2024, 8, 2), close=22000))
    db_session.commit()
    with httpx.Client(transport=httpx.MockTransport(official)) as http:
        client = OfficialClient(http, interval=0, retries=0)
        benchmark.import_history(db_session.get_bind(), client, date(2024, 8, 1), date(2024, 9, 4), incremental=True)
        assert requested == ["20240801", "20240901"]
        requested.clear()
        benchmark.import_history(db_session.get_bind(), client, date(2024, 8, 1), date(2024, 9, 4), incremental=True)
        assert requested == ["20240901"]
    assert len(list(db_session.scalars(select(BenchmarkPrice)))) == 4


def test_endpoint_metadata_order_gaps_and_empty(client, db_session):
    path = "/stocks/benchmark/history?start_date=2024-09-01&end_date=2024-09-04"
    empty = client.get(path)
    assert empty.status_code == 200
    assert empty.json()["data"] == [] and empty.json()["total"] == 0
    db_session.add_all([
        BenchmarkPrice(symbol="TAIEX", date=date(2024, 9, 4), close=21092.75),
        BenchmarkPrice(symbol="TAIEX", date=date(2024, 9, 2), close=22235.10),
        BenchmarkPrice(symbol="TAIEX", date=date(2024, 8, 30), close=22000),
    ])
    db_session.commit()
    response = client.get(path)
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == "TAIEX"
    assert data["basis"] == "price_index_excluding_dividends" and data["source"] == "TWSE"
    assert data["data"] == [{"date": "2024-09-02", "close": 22235.1}, {"date": "2024-09-04", "close": 21092.75}]
    assert data["total"] == 2
    assert client.get("/stocks/benchmark/history?start_date=2024-09-04&end_date=2024-09-01").status_code == 400
    assert client.get("/stocks/benchmark/history?start_date=bad&end_date=2024-09-01").status_code == 422


def test_api_before_worker_initialization_degrades_without_creating_table(client, db_session):
    from sqlalchemy import inspect

    engine = db_session.get_bind()
    BenchmarkPrice.__table__.drop(engine)
    response = client.get("/stocks/benchmark/history?start_date=2024-09-01&end_date=2024-09-04")
    assert response.status_code == 503
    assert response.json() == {"detail": "Database service unavailable"}
    assert not inspect(engine).has_table(BenchmarkPrice.__tablename__)


def test_runtime_openapi_includes_benchmark_contract(client):
    document = client.get("/openapi.json").json()
    operation = document["paths"]["/stocks/benchmark/history"]["get"]
    assert [item["name"] for item in operation["parameters"]] == ["start_date", "end_date"]
    assert operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/BenchmarkHistory")
    schemas = document["components"]["schemas"]
    assert schemas["BenchmarkHistory"]["properties"]["basis"]["const"] == "price_index_excluding_dividends"
    assert schemas["BenchmarkDay"]["properties"]["close"]["type"] == "number"
