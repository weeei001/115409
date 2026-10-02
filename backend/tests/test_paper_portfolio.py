from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from app.core.errors import AppError, Conflict, NotFound
from app.db.models import User, StockInfo, DailyPrice, BenchmarkPrice, Conversation, Notification
from app.features.paper_portfolio import service
from app.features.paper_portfolio.schemas import OrderCreate


def at(day):
    return datetime(2026, 9, day, 8, tzinfo=timezone.utc)


@pytest.fixture
def owner(db_session):
    user = User(email='paper@example.com', password_hash='unused')
    db_session.add_all([user, StockInfo(symbol='2330', name='TSMC')])
    db_session.commit()
    return user.id


def market(db, day, close=None):
    db.add(BenchmarkPrice(symbol='TAIEX', date=date(2026, 9, day), close=20000 + day))
    if close is not None:
        db.add(DailyPrice(symbol='2330', date=date(2026, 9, day), close=close))
    db.commit()


def buy(db, owner, key='buy', budget=10000, **kwargs):
    return service.create_order(db, owner, OrderCreate(client_request_id=key, symbol='2330', side='buy', budget=budget, **kwargs), now=at(1))


def test_reservations_idempotency_cancellation(db_session, owner):
    row = buy(db_session, owner, budget=600000)
    assert buy(db_session, owner, budget=600000)['id'] == row['id']
    assert service.snapshot(db_session, owner)['available_cash'] == 400000
    with pytest.raises(Conflict):
        buy(db_session, owner, budget=500000)
    with pytest.raises(AppError):
        buy(db_session, owner, key='second', budget=500000)
    service.cancel_order(db_session, owner, row['id'])
    assert service.snapshot(db_session, owner)['available_cash'] == 1000000


def test_partial_sell_cost_basis_and_share_reservation(db_session, owner):
    buy(db_session, owner)
    market(db_session, 2, 100)
    service.reconcile(db_session, owner, at(2))
    snapshot = service.snapshot(db_session, owner, at(2))
    assert snapshot['positions'][0]['quantity'] == 99
    assert snapshot['cash'] == 990085.89
    payload = OrderCreate(client_request_id='sell', symbol='2330', side='sell', quantity=40)
    service.create_order(db_session, owner, payload, now=at(2))
    with pytest.raises(AppError):
        service.create_order(db_session, owner, payload.model_copy(update={'client_request_id': 'sell2', 'quantity': 60}), now=at(2))
    market(db_session, 3, 120)
    service.reconcile(db_session, owner, at(3))
    snapshot = service.snapshot(db_session, owner, at(3))
    assert snapshot['positions'][0]['quantity'] == 59
    assert snapshot['realized_pnl'] == 773.06
    assert snapshot['cash'] == 994864.65
    assert snapshot['equity'] == 1001944.65
    assert snapshot['equity'] - snapshot['initial_cash'] == pytest.approx(snapshot['realized_pnl'] + snapshot['unrealized_pnl'])


def test_missing_target_close_never_uses_later_price(db_session, owner):
    row = buy(db_session, owner)
    market(db_session, 2)
    market(db_session, 3, 200)
    service.reconcile(db_session, owner, at(3))
    assert service.snapshot(db_session, owner, at(3))['orders'][0]['status'] == 'pending'
    db_session.add(DailyPrice(symbol='2330', date=date(2026, 9, 2), close=100))
    db_session.commit()
    service.reconcile(db_session, owner, at(3))
    filled = service.snapshot(db_session, owner, at(3))['orders'][0]
    assert filled['id'] == row['id']
    assert filled['trade_date'] == '2026-09-02'
    assert filled['fill_price'] == 100


def test_review_due_once_without_automatic_sale(db_session, owner):
    buy(db_session, owner, review_after_days=1, reason='Revenue thesis', observation='Next revenue release')
    market(db_session, 2, 100)
    market(db_session, 3, 105)
    service.reconcile(db_session, owner, at(3))
    service.reconcile(db_session, owner, at(3))
    snapshot = service.snapshot(db_session, owner, at(3))
    assert snapshot['positions'][0]['quantity'] == 99
    assert len(snapshot['orders']) == len(snapshot['reviews']) == 1
    review = snapshot['reviews'][0]
    assert review['reason'] == 'Revenue thesis'
    assert review['status'] == 'due'
    assert review['price_return_pct'] == 5
    assert db_session.query(Notification).count() == 1
    service.acknowledge_review(db_session, owner, review['id'])
    assert service.snapshot(db_session, owner, at(3))['reviews'][0]['status'] == 'reviewed'


def test_owner_isolation_and_conversation_ownership(db_session, owner):
    other = User(email='other@example.com')
    db_session.add(other)
    db_session.commit()
    db_session.add(Conversation(id='private', user_id=other.id, title='', updated_at=at(1).replace(tzinfo=None)))
    db_session.commit()
    with pytest.raises(NotFound):
        buy(db_session, owner, conversation_id='private')
    row = buy(db_session, owner)
    assert service.snapshot(db_session, other.id)['orders'] == []
    with pytest.raises(NotFound):
        service.cancel_order(db_session, other.id, row['id'])
    assert service.snapshot(db_session, owner)['orders'][0]['status'] == 'pending'


def test_snapshot_is_read_only_and_future_or_intraday_prices_do_not_fill(db_session, owner):
    from app.db.models.paper_portfolio import PaperAccount
    assert service.snapshot(db_session, owner)['cash'] == 1000000
    assert db_session.query(PaperAccount).count() == 0
    buy(db_session, owner)
    market(db_session, 2, 100)
    service.reconcile(db_session, owner, datetime(2026, 9, 2, 2, tzinfo=timezone.utc))
    assert service.snapshot(db_session, owner)['orders'][0]['status'] == 'pending'
    service.reconcile(db_session, owner, at(2))
    assert service.snapshot(db_session, owner)['orders'][0]['status'] == 'filled'


def test_cancel_after_eligible_close_cannot_avoid_execution(db_session, owner):
    row = buy(db_session, owner)
    market(db_session, 2, 100)
    with pytest.raises(Conflict):
        service.cancel_order(db_session, owner, row['id'], now=at(2))
    service.reconcile(db_session, owner, at(2))
    assert service.snapshot(db_session, owner, at(2))['orders'][0]['status'] == 'filled'


def test_missing_valuation_is_explicit(db_session, owner):
    buy(db_session, owner)
    market(db_session, 2, 100)
    service.reconcile(db_session, owner, at(2))
    db_session.query(DailyPrice).delete()
    db_session.commit()
    snapshot = service.snapshot(db_session, owner, at(2))
    assert snapshot['equity'] is None
    assert snapshot['unrealized_pnl'] is None
    assert snapshot['positions'][0]['market_price'] is None
    assert snapshot['valuation_status'] == 'missing_prices'


def test_next_order_settles_existing_and_releases_budget_remainder(db_session, owner):
    buy(db_session, owner, budget=1000000)
    market(db_session, 2, 100)
    row = service.create_order(db_session, owner, OrderCreate(client_request_id='sell', symbol='2330', side='sell', quantity=1), now=at(2))
    assert row['status'] == 'pending'
    snapshot = service.snapshot(db_session, owner, at(2))
    assert snapshot['reserved_cash'] == 0
    assert snapshot['positions'][0]['reserved_quantity'] == 1


def test_unexpected_owner_or_timestamp_payload_rejected():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        OrderCreate(client_request_id='key', symbol='2330', side='buy', budget=100, user_id=999)
    with pytest.raises(ValidationError):
        OrderCreate(client_request_id='key', symbol='2330', side='buy', budget=100, created_at='2020-01-01')


def test_missing_fill_price_does_not_allow_cancellation_after_close(db_session, owner):
    row = buy(db_session, owner)
    market(db_session, 2)
    with pytest.raises(Conflict):
        service.cancel_order(db_session, owner, row['id'], now=at(2))
    assert service.snapshot(db_session, owner, at(2))['orders'][0]['status'] == 'pending'


def test_portfolio_endpoints_require_authentication(client):
    assert client.get('/paper-portfolio').status_code == 403
    assert client.post('/paper-portfolio/orders', json={
        'client_request_id': 'auth-test', 'symbol': '2330', 'side': 'buy', 'budget': 1000,
    }).status_code == 403



def test_review_countdown_excludes_fill_day_future_and_intraday_sessions(db_session, owner):
    buy(db_session, owner, review_after_days=2)
    pending = service.snapshot(db_session, owner, at(1))['orders'][0]
    assert pending['review_elapsed_days'] is None
    assert pending['review_remaining_days'] is None
    assert pending['review_due_date'] is None
    market(db_session, 2, 100)
    market(db_session, 3, 105)
    market(db_session, 4, 110)
    service.reconcile(db_session, owner, at(2))
    filled = service.snapshot(db_session, owner, at(2))['orders'][0]
    assert filled['review_elapsed_days'] == 0
    assert filled['review_remaining_days'] == 2
    assert filled['review_due_date'] is None
    intraday = service.snapshot(db_session, owner, datetime(2026, 9, 3, 2, tzinfo=timezone.utc))['orders'][0]
    assert intraday['review_elapsed_days'] == 0
    assert intraday['review_remaining_days'] == 2
    next_close = service.snapshot(db_session, owner, at(3))['orders'][0]
    assert next_close['review_elapsed_days'] == 1
    assert next_close['review_remaining_days'] == 1
    assert next_close['review_due_date'] is None
    due = service.snapshot(db_session, owner, at(4))['orders'][0]
    assert due['review_elapsed_days'] == 2
    assert due['review_remaining_days'] == 0
    assert due['review_due_date'] == '2026-09-04'
