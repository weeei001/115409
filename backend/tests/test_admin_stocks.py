from sqlalchemy import select

from app.db.models.admin import AdminAuditLog
from app.db.models.stock_info import StockInfo
from app.features.admin import service
from app.features.market.repository import stock_names
from test_admin import account


def catalog(monkeypatch):
    monkeypatch.setattr(service, "load_catalog", lambda: {
        "2408": {"name": "南亞科", "industry_name": "半導體業", "market": "TWSE"},
        "6488": {"name": "環球晶", "industry_name": "半導體業", "market": "TPEx"},
    })


def test_stock_catalog_and_addition_use_database_membership(client, db_session, settings, monkeypatch):
    catalog(monkeypatch)
    _, headers = account(db_session, settings, "manager@example.com", administrator=True)
    result = client.get("/admin/stocks?query=南亞", headers=headers).json()
    assert result["total"] == 1 and not result["items"][0]["supported"]
    response = client.post("/admin/stocks", headers=headers, json={"symbol": "2408"})
    assert response.status_code == 200
    assert stock_names(db_session) == {"2408": "南亞科"}
    assert db_session.get(StockInfo, "2408").industry == "半導體業"
    result = client.get("/admin/stocks?query=2408", headers=headers).json()
    assert result["items"][0]["supported"] is True
    assert client.post("/admin/stocks", headers=headers, json={"symbol": "2408"}).status_code == 409
    assert client.post("/admin/stocks", headers=headers, json={"symbol": "9999"}).status_code == 422
    assert client.post("/admin/stocks", headers=headers, json={"symbol": "../bad"}).status_code == 422
    records = list(db_session.scalars(select(AdminAuditLog).where(AdminAuditLog.action == "stock.add")))
    assert [row.status for row in records] == ["succeeded", "failed", "failed"]


def test_stock_management_requires_admin(client, db_session, settings, monkeypatch):
    catalog(monkeypatch)
    _, headers = account(db_session, settings, "member@example.com")
    assert client.get("/admin/stocks", headers=headers).status_code == 403
    assert client.post("/admin/stocks", headers=headers, json={"symbol": "2408"}).status_code == 403
    assert stock_names(db_session) == {}


def test_missing_catalog_keeps_supported_stocks_visible(client, db_session, settings, monkeypatch):
    monkeypatch.setattr(service, "load_catalog", lambda: {})
    _, headers = account(db_session, settings, "manager@example.com", administrator=True)
    db_session.add(StockInfo(symbol="2408", name="南亞科"))
    db_session.commit()
    result = client.get("/admin/stocks", headers=headers).json()
    assert result["catalog_available"] is False
    assert result["items"][0]["supported"] is True
    assert client.post("/admin/stocks", headers=headers, json={"symbol": "6488"}).status_code == 503
    assert stock_names(db_session) == {"2408": "南亞科"}
