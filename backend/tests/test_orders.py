from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import event, select

from app.db.models.daily_price import DailyPrice
from app.db.models.simulated_order import SimulatedOrder
from app.features.orders import service
from app.features.orders.schemas import SimulatedOrderCreate


def order(order_id, side="buy", quantity=1, amount=100000, trade_date=date(2025, 1, 1), **fields):
    return SimulatedOrder(
        id=order_id, user_id="anonymous-001", symbol="2330", side=side, quantity=quantity,
        estimated_amount=amount, trade_date=trade_date, status="filled",
        sell_plan=fields.pop("sell_plan", "long_term" if side == "buy" else None),
        created_at=datetime(2025, 1, 1) + timedelta(seconds=order_id), **fields,
    )


def test_fifo_partial_lots_preserve_total_cost_and_rounding():
    records = [order(1, quantity=3, amount=100001)]
    records += [order(i, side="sell", amount=40000, trade_date=date(2025, 1, i)) for i in (2, 3, 4)]
    costs = service.fifo_sell_costs(records)
    assert costs == {2: Decimal(33334), 3: Decimal(33334), 4: Decimal(33333)}
    assert sum(costs.values()) == Decimal(100001)
    fields = service.markup_fields(records[1], costs, {}, {})
    assert fields == dict(markup_basis="fifo_realized", reference_date=date(2025, 1, 2),
                          reference_close=40.0, markup_amount=6666, markup_rate=20.0)
    payload = SimulatedOrderCreate(user_id="guest", symbol="2330", side="buy", quantity=1)
    assert service.calculate_estimated_amount(payload, Decimal("100.0005")) == 100001


def test_fifo_respects_symbol_order_id_and_expiry():
    records = [
        order(1, amount=100000, sell_plan="by_date", planned_sell_date=date(2025, 1, 2)),
        order(2, side="sell", trade_date=date(2025, 1, 2)),
        order(3, side="sell", trade_date=date(2025, 1, 3)),
        order(4, quantity=2, amount=240000, trade_date=date(2025, 1, 3)),
        order(5, side="sell", trade_date=date(2025, 1, 3)),
    ]
    assert service.fifo_sell_costs(list(reversed(records))) == {2: Decimal(100000), 5: Decimal(120000)}
    records[1].trade_date = date(2025, 1, 3)
    assert 2 not in service.fifo_sell_costs(records)


def test_chronology_and_available_lots_keep_existing_asof_rules():
    records = [
        order(1, quantity=3, sell_plan="by_date", planned_sell_date=date(2025, 1, 5)),
        order(2, quantity=2),
        order(3, side="sell", trade_date=date(2025, 1, 3)),
    ]
    assert service.available_lots(records, date(2025, 1, 5)) == 4
    assert service.available_lots(records, date(2025, 1, 6)) == 1
    assert service.check_trade_chronology(records, "sell", date(2024, 12, 31)) == "賣出日不可早於首筆買進日（2025-01-01）"
    assert service.check_trade_chronology(records, "sell", date(2025, 1, 1)) is None
    assert service.check_trade_chronology([records[2]], "buy", date(2025, 1, 4)) is not None
    assert service.check_trade_chronology([records[2]], "buy", date(2025, 1, 2)) is None


def test_create_list_available_and_fifo_summary_without_auth(client, db_session):
    db_session.add_all([
        DailyPrice(symbol="2330", date=date(2025, 1, 1), close=Decimal("100.25")),
        DailyPrice(symbol="2330", date=date(2025, 1, 2), close=Decimal("110.50")),
        DailyPrice(symbol="2330", date=date(2025, 1, 3), close=Decimal("120.25")),
    ])
    db_session.commit()
    body = {"user_id": " guest ", "symbol": " 2330 ", "side": "buy", "quantity": 2, "trade_date": "2025-01-01"}
    created = client.post("/simulated-orders/", json=body)
    assert created.status_code == 200, created.text
    data = created.json()
    assert data["id"] == "ORD-000001"
    assert data["user_id"] == "guest" and data["symbol"] == "2330"
    assert data["status"] == "filled" and data["estimated_amount"] == 200500
    assert data["sell_plan"] == "long_term" and data["planned_sell_date"] is None
    assert data["markup_basis"] == "latest" and data["markup_amount"] == 40000
    assert data["markup_rate"] == 19.95
    available = client.get("/simulated-orders/available-lots", params={"user_id": " guest ", "symbol": " 2330 "})
    assert available.json() == {"user_id": "guest", "symbol": "2330", "available_lots": 2}
    sold = client.post("/simulated-orders/", json={**body, "side": "sell", "quantity": 1, "trade_date": "2025-01-02", "sell_plan": "invalid-ignored", "planned_sell_date": "ignored"})
    assert sold.status_code == 200, sold.text
    sell = sold.json()
    assert sell["sell_plan"] is None and sell["planned_sell_date"] is None
    assert sell["estimated_amount"] == 110500 and sell["markup_amount"] == 10250
    assert sell["markup_basis"] == "fifo_realized" and sell["markup_rate"] == 10.22
    listed = client.get("/simulated-orders/", params={"user_id": "guest", "limit": 1}).json()
    assert listed["total"] == 1 and len(listed["data"]) == 1
    summary = client.get("/simulated-orders/profit-by-category", params={"user_id": "guest"}).json()
    assert summary == {"user_id": "guest", "total_orders": 2, "priced_orders": 2, "unpriced_orders": 0, "data": [
        {"category": "2330", "symbols": ["2330"], "order_count": 2, "cost_amount": 300750,
         "market_amount": 351000, "profit_amount": 50250, "profit_rate": 16.71},
    ]}


def test_create_rejects_nontrading_day_oversell_and_out_of_order(client, db_session):
    db_session.add_all([
        DailyPrice(symbol="2330", date=date(2025, 1, 1), close=100),
        DailyPrice(symbol="2330", date=date(2025, 1, 2), close=100),
    ])
    db_session.commit()
    payload = {"user_id": "guest", "symbol": "2330", "side": "buy", "quantity": 1, "trade_date": "2025-01-02"}
    assert client.post("/simulated-orders/", json={**payload, "trade_date": "2025-01-03"}).status_code == 404
    assert client.post("/simulated-orders/", json=payload).status_code == 200
    too_early = client.post("/simulated-orders/", json={**payload, "side": "sell", "trade_date": "2025-01-01"})
    assert too_early.status_code == 400 and "首筆買進日" in too_early.json()["detail"]
    oversell = client.post("/simulated-orders/", json={**payload, "side": "sell", "quantity": 2})
    assert oversell.status_code == 400 and "目前可賣 1 張" in oversell.json()["detail"]
    assert len(list(db_session.scalars(select(SimulatedOrder)))) == 1


def test_planned_sell_public_null_and_summary_fallback(db_session):
    records = [
        order(1, sell_plan="by_date", planned_sell_date=date(2025, 1, 4)),
        order(2, sell_plan="by_date", planned_sell_date=date.today() + timedelta(days=1)),
        order(3),
    ]
    db_session.add_all(records + [
        DailyPrice(symbol="2330", date=date(2025, 1, 3), close=Decimal("110.25")),
        DailyPrice(symbol="2330", date=date(2025, 1, 6), close=None),
    ])
    db_session.commit()
    data = {row.id: row for row in service.list_orders(db_session, "anonymous-001", 100)["data"]}
    assert data["ORD-000001"].reference_date == date(2025, 1, 3)
    assert data["ORD-000001"].markup_amount == 10250
    assert data["ORD-000002"].markup_basis == "planned_sell"
    assert data["ORD-000002"].reference_close is None and data["ORD-000002"].markup_amount is None
    assert data["ORD-000003"].markup_basis is None and data["ORD-000003"].markup_amount is None
    summary = service.profit_by_category(db_session, "anonymous-001")
    assert summary["priced_orders"] == 3 and summary["data"][0]["profit_amount"] == 30750


def test_unpriced_orders_stay_null_and_counted(db_session):
    db_session.add_all([order(1), order(2, side="sell", quantity=2)])
    db_session.commit()
    listed = service.list_orders(db_session, "anonymous-001", 100)
    assert all(row.markup_amount is None and row.reference_close is None for row in listed["data"])
    assert service.profit_by_category(db_session, "anonymous-001") == dict(
        user_id="anonymous-001", total_orders=2, priced_orders=0, unpriced_orders=2, data=[],
    )


def test_valuation_queries_are_batched_and_reads_never_commit(db_session, monkeypatch):
    db_session.add_all([order(i, sell_plan="by_date", planned_sell_date=date(2025, 1, i)) for i in range(1, 26)])
    db_session.add_all([DailyPrice(symbol="2330", date=date(2025, 1, i), close=Decimal(100 + i)) for i in range(1, 26)])
    db_session.commit()
    statements = []
    def count_queries(connection, cursor, statement, parameters, context, executemany):
        statements.append(statement)
    event.listen(db_session.bind, "before_cursor_execute", count_queries)
    monkeypatch.setattr(db_session, "commit", lambda: pytest.fail("Read path must not commit"))
    try:
        listed = service.list_orders(db_session, "anonymous-001", 100)
        assert len(listed["data"]) == 25 and len(statements) == 3
        assert listed["data"][0].reference_close == 125.0
        assert listed["data"][-1].reference_close == 101.0
    finally:
        event.remove(db_session.bind, "before_cursor_execute", count_queries)
