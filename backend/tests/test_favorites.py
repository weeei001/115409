from datetime import datetime

import pytest
from sqlalchemy import select, update

from app.db.models.favorite_stock import FavoriteStock
from app.db.models.stock_info import StockInfo
from app.db.models.user import User
from app.features.auth.service import create_access_token
from app.features.favorites import repository


@pytest.fixture(autouse=True)
def stocks(db_session):
    db_session.add_all([StockInfo(symbol="2330", name="台積電"), StockInfo(symbol="2317", name="鴻海")])
    db_session.commit()


def login(db_session, settings, email="person@example.com"):
    user = User(email=email, password_hash=None, is_active=True)
    db_session.add(user)
    db_session.commit()
    token, _ = create_access_token(user.id, settings)
    return {"Authorization": "Bearer " + token}


def symbols(client, headers):
    response = client.get("/favorites/", headers=headers)
    assert response.status_code == 200, response.text
    return [item["symbol"] for item in response.json()["items"]]


def test_every_endpoint_requires_a_bearer_token(client):
    # FastAPI 0.115 HTTPBearer rejects a missing or non-Bearer header with 403 before the handler runs.
    for method, path in (("get", "/favorites/"), ("put", "/favorites/2330"), ("delete", "/favorites/2330")):
        assert client.request(method, path).status_code == 403
        assert client.request(method, path, headers={"Authorization": "Basic xyz"}).status_code == 403
        invalid = client.request(method, path, headers={"Authorization": "Bearer not-a-token"})
        assert invalid.status_code == 401
        assert invalid.json() == {"detail": "Invalid or expired token"}


def test_add_list_and_remove_newest_first(client, db_session, settings):
    headers = login(db_session, settings)
    assert client.get("/favorites/", headers=headers).json() == {"items": []}
    added = client.put("/favorites/2330", headers=headers)
    assert added.status_code == 200, added.text
    body = added.json()
    assert set(body) == {"symbol", "name", "created_at"}
    assert body["symbol"] == "2330" and body["name"] == "台積電"
    datetime.fromisoformat(body["created_at"])
    assert client.put("/favorites/2317", headers=headers).status_code == 200
    items = client.get("/favorites/", headers=headers).json()["items"]
    assert [item["symbol"] for item in items] == ["2317", "2330"]
    assert items[1] == body
    db_session.execute(update(FavoriteStock).where(FavoriteStock.symbol == "2317").values(created_at=datetime(2020, 1, 1)))
    db_session.commit()
    assert symbols(client, headers) == ["2330", "2317"]
    removed = client.delete("/favorites/2330", headers=headers)
    assert removed.status_code == 204 and removed.content == b""
    assert client.delete("/favorites/2330", headers=headers).status_code == 204
    assert symbols(client, headers) == ["2317"]


def test_repeated_put_keeps_a_single_row(client, db_session, settings):
    headers = login(db_session, settings)
    first = client.put("/favorites/2330", headers=headers)
    second = client.put("/favorites/2330", headers=headers)
    assert first.status_code == second.status_code == 200
    assert second.json() == first.json()
    assert len(db_session.scalars(select(FavoriteStock)).all()) == 1
    assert symbols(client, headers) == ["2330"]


def test_concurrent_duplicate_insert_returns_the_stored_row(client, db_session, settings, monkeypatch):
    headers = login(db_session, settings)
    first = client.put("/favorites/2330", headers=headers).json()
    original, calls = repository.favorite, []
    def stale_first_read(db, user_id, symbol):
        calls.append(symbol)
        return None if len(calls) == 1 else original(db, user_id, symbol)
    monkeypatch.setattr(repository, "favorite", stale_first_read)
    second = client.put("/favorites/2330", headers=headers)
    assert second.status_code == 200, second.text
    assert second.json() == first
    assert calls == ["2330", "2330"]
    assert len(db_session.scalars(select(FavoriteStock)).all()) == 1


def test_unknown_symbol_is_not_found(client, db_session, settings):
    headers = login(db_session, settings)
    response = client.put("/favorites/9999", headers=headers)
    assert response.status_code == 404
    assert response.json() == {"detail": "找不到股票 9999"}
    assert client.put("/favorites/" + "1" * 11, headers=headers).status_code == 422
    assert db_session.scalar(select(FavoriteStock)) is None


def test_users_only_see_and_remove_their_own_favorites(client, db_session, settings):
    a = login(db_session, settings, "a@example.com")
    b = login(db_session, settings, "b@example.com")
    assert client.put("/favorites/2330", headers=a).status_code == 200
    assert client.put("/favorites/2317", headers=b).status_code == 200
    assert symbols(client, a) == ["2330"]
    assert symbols(client, b) == ["2317"]
    assert client.delete("/favorites/2330", headers=b).status_code == 204
    assert symbols(client, a) == ["2330"]
