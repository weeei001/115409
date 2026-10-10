from datetime import date, timedelta

import pytest
from sqlalchemy import event, select

from app.db.models.daily_price import DailyPrice
from app.db.models.stock_info import StockInfo
from app.features.chat.stock_discovery import discover_stock_candidates, stock_industries


AS_OF = date(2026, 10, 8)


def add_stock(db, symbol, industry, *, day=AS_OF, volume=100, close=100):
    db.add(StockInfo(symbol=symbol, name=f"Company {symbol}", industry=industry))
    if day is not None:
        db.add(DailyPrice(symbol=symbol, date=day, volume_shares=volume, close=close))


def symbols(result):
    return [row["symbol"] for row in result["candidates"]]


def test_round_robin_covers_industries_and_deduplicates_overlap(db_session):
    for symbol, industry, volume in (("1001", "Semiconductors", 900),
                                     ("1002", "Computers", 800),
                                     ("1003", "Semiconductors", 700),
                                     ("1101", "Cement", 20), ("1102", "Cement", 10)):
        add_stock(db_session, symbol, industry, volume=volume)
    db_session.commit()
    result = discover_stock_candidates(db_session, [["Semiconductors", "Computers"], ["Cement"]], AS_OF)
    assert symbols(result) == ["1001", "1101", "1002"]
    assert result["groups"] == [
        {"industries": ["Semiconductors", "Computers"], "matched_count": 3,
         "eligible_count": 3, "selected_symbols": ["1001", "1002"]},
        {"industries": ["Cement"], "matched_count": 2,
         "eligible_count": 2, "selected_symbols": ["1101"]},
    ]
    overlap = discover_stock_candidates(db_session, [["Semiconductors"], ["Semiconductors", "Computers"]], AS_OF)
    assert symbols(overlap) == ["1001", "1002", "1003"]
    assert result["missing_groups"] == []


def test_latest_cutoff_excludes_future_missing_and_unusable_prices(db_session):
    add_stock(db_session, "1001", "Tech", volume=10)
    db_session.add(DailyPrice(symbol="1001", date=AS_OF + timedelta(days=1), close=999, volume_shares=99999))
    add_stock(db_session, "1002", "Tech", day=AS_OF - timedelta(days=1), volume=999)
    add_stock(db_session, "1003", "Tech", day=AS_OF + timedelta(days=1))
    add_stock(db_session, "1004", "Tech", day=None)
    add_stock(db_session, "1005", "Tech", close=0)
    db_session.add(DailyPrice(symbol="1005", date=AS_OF - timedelta(days=1), close=100))
    add_stock(db_session, "1006", "Tech", close=None)
    db_session.add(DailyPrice(symbol="9999", date=AS_OF, close=100, volume_shares=999999))
    db_session.commit()
    result = discover_stock_candidates(db_session, [["Tech"]], AS_OF, limit=6)
    assert symbols(result) == ["1001", "1002"]
    assert result["candidates"][0]["volume_shares"] == 10
    assert result["candidates"][0]["latest_price_date"] == AS_OF.isoformat()
    assert result["groups"][0]["matched_count"] == 6
    assert result["groups"][0]["eligible_count"] == 2


def test_empty_catalog_missing_groups_and_exact_literal_matching(db_session):
    assert discover_stock_candidates(db_session, [], AS_OF)["candidates"] == []
    malicious = "Tech') OR 1=1 --"
    add_stock(db_session, "1001", "Tech")
    add_stock(db_session, "1002", malicious, day=None)
    add_stock(db_session, "1003", "No prices", day=None)
    db_session.commit()
    result = discover_stock_candidates(db_session, [[malicious], ["No prices"], ["Unknown"]], AS_OF)
    assert result["candidates"] == []
    assert [group["matched_count"] for group in result["groups"]] == [1, 1, 0]
    assert result["missing_groups"] == [[malicious], ["No prices"], ["Unknown"]]
    assert discover_stock_candidates(db_session, [[]], AS_OF)["candidates"] == []
    assert len(list(db_session.scalars(select(StockInfo)))) == 3


def test_all_catalog_cap_ties_and_missing_volume_are_deterministic(db_session):
    for index in reversed(range(1, 9)):
        add_stock(db_session, str(index), None if index == 1 else "Tech")
    add_stock(db_session, "0", "Tech", volume=None)
    db_session.commit()
    result = discover_stock_candidates(db_session, [], AS_OF, limit=99)
    assert symbols(result) == ["1", "2", "3", "4", "5", "6"]
    assert result["groups"][0]["matched_count"] == 9
    assert result["groups"][0]["eligible_count"] == 9
    assert discover_stock_candidates(db_session, [], AS_OF, limit=1)["candidates"] == result["candidates"][:1]
    with pytest.raises(ValueError, match="positive"):
        discover_stock_candidates(db_session, [], AS_OF, limit=0)
    with pytest.raises(ValueError, match="three"):
        discover_stock_candidates(db_session, [["Tech"]] * 4, AS_OF)


def test_catalog_labels_and_discovery_do_not_flush_or_commit(db_session):
    for symbol, industry in (("1", "Tech"), ("2", "Tech"), ("3", "Cement"),
                             ("4", None), ("5", ""), ("6", "   ")):
        add_stock(db_session, symbol, industry)
    db_session.commit()
    mutations = []
    event.listen(db_session, "before_commit", lambda session: mutations.append("commit"))
    event.listen(db_session, "before_flush", lambda *args: mutations.append("flush"))
    add_stock(db_session, "7", "Pending")
    assert stock_industries(db_session) == ["Cement", "Tech"]
    result = discover_stock_candidates(db_session, [], AS_OF, limit=6)
    assert len(result["candidates"]) == 6
    assert "7" not in symbols(result)
    assert mutations == []
