import json
from contextlib import nullcontext
from copy import deepcopy
from uuid import uuid4

import pytest

from app.features.chat.personal_context import read_personal_context
from app.features.paper_portfolio import service


def order(status, side="buy"):
    return {"id": str(uuid4()), "symbol": "2330", "status": status, "side": side}


def read_snapshot(monkeypatch, snapshot, query="Inspect all pending orders"):
    monkeypatch.setattr(service, "snapshot", lambda db, user_id: deepcopy(snapshot))
    _, source = read_personal_context(lambda: nullcontext(object()), 7, {"portfolio"}, query=query)
    return json.loads(source.content)["portfolio"]


def test_old_pending_orders_survive_history_limit_without_changing_account_totals(monkeypatch):
    history = [order("filled" if index % 2 else "cancelled") for index in range(30)]
    pending = [order("pending", "buy" if index % 2 else "sell") for index in range(25)]
    totals = {"cash": 50000, "available_cash": 38000, "reserved_cash": 12000,
              "equity": 75000, "total_pnl": 5000,
              "positions": [{"symbol": "2330", "quantity": 100, "reserved_quantity": 13}]}
    result = read_snapshot(monkeypatch, {**totals, "orders": history + pending})

    assert [row["id"] for row in result["orders"] if row["status"] == "pending"] == [row["id"] for row in pending]
    assert [row["id"] for row in result["orders"] if row["status"] != "pending"] == [row["id"] for row in history[:20]]
    assert {key: result[key] for key in totals} == totals
    assert result["context_counts"]["orders_total"] == 55
    assert result["context_counts"]["orders_shown"] == 45
    assert result["context_counts"]["pending_orders_total"] == 25
    assert result["context_counts"]["pending_orders_shown"] == 25
    assert result["context_counts"]["historical_orders_total"] == 30
    assert result["context_counts"]["historical_orders_shown"] == 20
    assert result["context_coverage"] == {"pending_orders": "complete", "historical_orders": "partial"}


def test_requested_orders_and_reviews_are_retained_once_alongside_all_pending(monkeypatch):
    history = [order("filled") for _ in range(25)]
    pending = [order("pending") for _ in range(22)]
    review = {"id": str(uuid4()), "order_id": history[-1]["id"], "status": "reviewed"}
    requested = [pending[-1]["id"], history[0]["id"], history[-2]["id"], review["id"]]
    result = read_snapshot(monkeypatch, {"orders": history + pending, "reviews": [review]},
                           query="Review " + " and ".join(requested))
    shown = [row["id"] for row in result["orders"]]
    expected = {row["id"] for row in history[:20] + history[-2:] + pending}

    assert set(shown) == expected
    assert len(shown) == len(expected)
    assert result["reviews"] == [review]
    assert result["context_counts"]["historical_orders_shown"] == 22
    assert result["context_counts"]["pending_orders_shown"] == 22
    assert result["context_counts"]["orders_shown"] == 44


@pytest.mark.parametrize("pending_count,history_count", [(0, 0), (24, 0), (0, 20), (3, 20)])
def test_complete_coverage_is_explicit_for_small_history_and_any_pending_count(
        monkeypatch, pending_count, history_count):
    records = [order("pending") for _ in range(pending_count)] + [order("filled") for _ in range(history_count)]
    result = read_snapshot(monkeypatch, {"orders": records})
    assert result["orders"] == records
    assert result["context_coverage"] == {"pending_orders": "complete", "historical_orders": "complete"}
    assert result["context_counts"]["pending_orders_total"] == pending_count
    assert result["context_counts"]["pending_orders_shown"] == pending_count
