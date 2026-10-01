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
