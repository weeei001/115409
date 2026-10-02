from datetime import date, timedelta

from app.db.models.daily_price import DailyPrice


def test_fixed_volume_history_uses_last_sixty_stored_days_not_visible_range(client, db_session):
    days = []
    day = date(2025, 1, 1)
    while len(days) < 80:
        # Include a long gap to rule out an assumed calendar-day warmup.
        if day.weekday() < 5 and not date(2025, 2, 1) <= day <= date(2025, 5, 1):
            days.append(day)
        day += timedelta(days=1)
    db_session.add_all(DailyPrice(symbol="2330", date=day, open=100, high=110, low=90, close=100,
                                  volume_shares=index + 1) for index, day in enumerate(days))
    db_session.add(DailyPrice(symbol="2454", date=days[-1], close=100, volume_shares=99999))
    db_session.commit()
    params = {"end_date": days[-1].isoformat(), "limit": 60}
    result = client.get("/stocks/2330/history", params=params)
    assert result.status_code == 200
    rows = result.json()["data"]
    assert len(rows) == 60
    assert [row["date"] for row in rows] == [day.isoformat() for day in reversed(days[-60:])]
    assert sum(row["volume_shares"] for row in rows[:20]) / 20 == 70.5
    assert sum(row["volume_shares"] for row in rows) / 60 == 50.5
    assert all(row["symbol"] == "2330" for row in rows)
    for start in (days[0], days[-18]):
        chart = client.get("/stocks/2330/chart/candlestick-ma", params={**params, "start_date": start, "ma_periods": "20,60"})
        assert chart.status_code == 200
        assert chart.json()["dates"][0] == start.isoformat()
        assert client.get("/stocks/2330/history", params=params).json()["data"] == rows


def test_volume_history_preserves_missing_zero_and_nontrading_end_date(client, db_session):
    friday = date(2026, 9, 25)
    db_session.add_all([
        DailyPrice(symbol="2330", date=friday - timedelta(days=1), volume_shares=None),
        DailyPrice(symbol="2330", date=friday, volume_shares=0),
        DailyPrice(symbol="2330", date=friday + timedelta(days=3), volume_shares=999),
    ])
    db_session.commit()
    response = client.get("/stocks/2330/history", params={"end_date": friday + timedelta(days=2), "limit": 60})
    assert response.status_code == 200
    assert [row["volume_shares"] for row in response.json()["data"]] == [0, None]


def test_visible_history_range_filters_total_and_every_page(client, db_session):
    days = [date(2026, 1, 1) + timedelta(days=index) for index in range(80)]
    db_session.add_all(DailyPrice(symbol="2330", date=day, close=100, volume_shares=index)
                       for index, day in enumerate(days))
    db_session.add(DailyPrice(symbol="2454", date=days[40], close=200, volume_shares=1000))
    db_session.commit()
    params = {"start_date": days[10], "end_date": days[70], "limit": 30}
    rows = []
    for skip in (0, 30, 60):
        response = client.get("/stocks/2330/history", params={**params, "skip": skip})
        assert response.status_code == 200
        assert response.json()["total"] == 61
        rows.extend(response.json()["data"])
    assert [row["date"] for row in rows] == [day.isoformat() for day in reversed(days[10:71])]
    short = client.get("/stocks/2330/history", params={**params, "start_date": days[65]}).json()
    assert short["total"] == 6
    assert [row["date"] for row in short["data"]] == [day.isoformat() for day in reversed(days[65:71])]
    empty = client.get("/stocks/2330/history", params={**params, "start_date": "2027-01-01", "end_date": "2027-02-01"}).json()
    assert empty["total"] == 0
    assert empty["data"] == []
