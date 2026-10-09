from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from app.core.errors import AppError, Conflict, NotFound
from app.db.models import User, StockInfo, DailyPrice, BenchmarkPrice, Conversation, Notification
from app.features.paper_portfolio import service
from app.features.paper_portfolio.schemas import FundCreate, OrderCreate


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
    if not service.snapshot(db, owner)['initialized']:
        service.create_fund_movement(db, owner, FundCreate(client_request_id='initial', kind='initial', amount=1000000), now=at(1))
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


def test_target_close_that_never_arrives_cancels_and_releases_budget(db_session, owner):
    row = buy(db_session, owner)
    market(db_session, 2)
    market(db_session, 3, 100)
    market(db_session, 4, 100)
    service.reconcile(db_session, owner, at(4))
    assert service.snapshot(db_session, owner, at(4))['orders'][0]['status'] == 'pending'
    market(db_session, 5, 100)
    service.reconcile(db_session, owner, at(5))
    snapshot = service.snapshot(db_session, owner, at(5))
    assert snapshot['orders'][0]['id'] == row['id']
    assert snapshot['orders'][0]['status'] == 'cancelled'
    assert snapshot['available_cash'] == 1000000


def test_nightly_reconcile_continues_after_one_account_fails(db_session, owner, monkeypatch):
    buy(db_session, owner)
    market(db_session, 2, 100)
    settle = service._settle

    def flaky(db, user_id, current):
        if user_id == 'broken':
            raise RuntimeError('corrupt account')
        return settle(db, user_id, current)

    monkeypatch.setattr(service.repo, 'owners', lambda db: ['broken', owner])
    monkeypatch.setattr(service, '_settle', flaky)
    assert service.reconcile(db_session, now=at(2)) == {'accounts': 2, 'failed': 1}
    assert service.snapshot(db_session, owner, at(2))['orders'][0]['status'] == 'filled'


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
    assert service.get_portfolio(db_session, owner)['cash'] == 0
    assert service.snapshot(db_session, owner)['initialized'] is False
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
    assert snapshot['holdings_value'] is None
    assert snapshot['positions'][0]['allocation_pct'] is None
    for key in ('cash_allocation_pct', 'available_cash_allocation_pct', 'reserved_cash_allocation_pct', 'holdings_allocation_pct'):
        assert snapshot[key] is None


def test_allocation_uses_total_equity_and_preserves_pending_cash(db_session, owner):
    import json
    from contextlib import nullcontext
    from app.features.chat.personal_context import read_personal_context

    fund(db_session, owner, 'initial', 30000)
    buy(db_session, owner, budget=10000)
    market(db_session, 2, 100)
    service.reconcile(db_session, owner, at(2))
    service.create_order(db_session, owner, OrderCreate(
        client_request_id='pending-allocation', symbol='2330', side='buy', budget=5000,
    ), now=at(2))
    snapshot = service.snapshot(db_session, owner, at(2))
    assert snapshot['equity'] == 29985.89
    assert snapshot['holdings_value'] == 9900
    assert snapshot['cash_allocation_pct'] == 66.98
    assert snapshot['available_cash_allocation_pct'] == 50.31
    assert snapshot['reserved_cash_allocation_pct'] == 16.67
    assert snapshot['holdings_allocation_pct'] == 33.02
    assert snapshot['positions'][0]['allocation_pct'] == 33.02
    _, evidence = read_personal_context(
        lambda: nullcontext(db_session), owner, {'portfolio'},
        query='目前模擬帳戶的可用資金與持股配置比例是多少？',
    )
    portfolio = json.loads(evidence.content)['portfolio']
    assert portfolio['available_cash_allocation_pct'] == 50.31
    assert portfolio['positions'][0]['allocation_pct'] == 33.02


def test_allocation_for_cash_only_uninitialized_and_empty_accounts(db_session, owner):
    keys = ('cash_allocation_pct', 'available_cash_allocation_pct', 'reserved_cash_allocation_pct', 'holdings_allocation_pct')
    snapshot = service.snapshot(db_session, owner, at(1))
    assert all(snapshot[key] is None for key in keys)
    snapshot = fund(db_session, owner, 'initial', 30000)
    assert snapshot['holdings_value'] == 0
    assert [snapshot[key] for key in keys] == [100, 100, 0, 0]
    buy(db_session, owner, budget=10000)
    snapshot = service.snapshot(db_session, owner, at(1))
    assert [snapshot[key] for key in keys] == [100, 66.67, 33.33, 0]
    service.cancel_order(db_session, owner, snapshot['orders'][0]['id'], now=at(1))
    snapshot = fund(db_session, owner, 'withdrawal', 30000)
    assert snapshot['equity'] == 0
    assert all(snapshot[key] is None for key in keys)


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
    assert client.post('/paper-portfolio/funds', json={
        'client_request_id': 'auth-funds', 'kind': 'initial', 'amount': 30000,
    }).status_code == 403


def fund(db, owner, kind, amount, key=None, day=1):
    return service.create_fund_movement(db, owner, FundCreate(
        client_request_id=key or kind, kind=kind, amount=amount), now=at(day))


def test_custom_budget_and_idempotent_fund_requests(db_session, owner):
    with pytest.raises(Conflict):
        service.create_order(db_session, owner, OrderCreate(client_request_id='unfunded', symbol='2330', side='buy', budget=1000), now=at(1))
    with pytest.raises(Conflict):
        fund(db_session, owner, 'deposit', 1000)
    result = fund(db_session, owner, 'initial', 30000)
    assert result['initialized'] is True
    assert result['initial_cash'] == result['available_cash'] == 30000
    assert result['total_pnl'] == 0
    replay = fund(db_session, owner, 'initial', 30000)
    assert replay['fund_movements'] == result['fund_movements']
    with pytest.raises(Conflict):
        fund(db_session, owner, 'initial', 50000)
    with pytest.raises(Conflict):
        fund(db_session, owner, 'initial', 30000, key='other-initial')
    fund(db_session, owner, 'deposit', 5000)
    result = fund(db_session, owner, 'deposit', 5000)
    assert result['cash'] == 35000
    assert result['total_deposits'] == 5000
    assert result['net_contributions'] == 35000
    assert result['total_pnl'] == 0
    with pytest.raises(Conflict):
        fund(db_session, owner, 'withdrawal', 5000, key='deposit')


def test_withdrawal_respects_reservations_and_does_not_change_profit(db_session, owner):
    fund(db_session, owner, 'initial', 30000)
    buy(db_session, owner, budget=20000)
    with pytest.raises(AppError):
        fund(db_session, owner, 'withdrawal', 10000.01)
    result = fund(db_session, owner, 'withdrawal', 10000)
    assert result['available_cash'] == 0
    assert result['total_withdrawals'] == 10000
    assert result['total_pnl'] == 0
    market(db_session, 2, 100)
    result = fund(db_session, owner, 'deposit', 5000, day=2)
    assert result['orders'][0]['status'] == 'filled'
    profit = result['total_pnl']
    assert profit == pytest.approx(result['realized_pnl'] + result['unrealized_pnl'])
    result = fund(db_session, owner, 'withdrawal', 5000, key='withdraw-after-fill', day=2)
    assert result['total_pnl'] == profit
    replay = fund(db_session, owner, 'withdrawal', 5000, key='withdraw-after-fill', day=2)
    assert replay['cash'] == result['cash']
    assert len(replay['fund_movements']) == 4


def test_existing_accounts_preserve_balances_and_funds_are_owner_scoped(db_session, owner):
    from app.db.models.paper_portfolio import PaperAccount
    db_session.add(PaperAccount(user_id=owner, initial_cash=1000000, cash=1000000))
    other = User(email='fund-other@example.com')
    db_session.add(other)
    db_session.commit()
    result = fund(db_session, owner, 'deposit', 5000, key='shared')
    assert result['initial_cash'] == 1000000
    assert result['cash'] == 1005000
    assert result['total_pnl'] == 0
    other_result = fund(db_session, other.id, 'initial', 1000, key='shared')
    assert other_result['cash'] == 1000
    assert len(other_result['fund_movements']) == 1
    assert service.snapshot(db_session, owner)['cash'] == 1005000


@pytest.mark.parametrize('amount', [0, -1, 'NaN', 'Infinity', '1.001', 1000000001])
def test_invalid_fund_amounts_rejected(amount):
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        FundCreate(client_request_id='invalid', kind='initial', amount=amount)


def test_fund_payload_cannot_supply_owner_or_time():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        FundCreate(client_request_id='invalid', kind='initial', amount=1000, user_id=123)
    with pytest.raises(ValidationError):
        FundCreate(client_request_id='invalid', kind='initial', amount=1000, created_at='2020-01-01')


def test_fund_endpoint_uses_authenticated_owner(client, db_session, owner, settings):
    from app.features.auth.service import create_access_token
    from app.db.models.paper_portfolio import PaperAccount
    token, _ = create_access_token(owner, settings)
    headers = {'Authorization': 'Bearer ' + token}
    assert client.get('/paper-portfolio', headers=headers).json()['initialized'] is False
    assert db_session.query(PaperAccount).count() == 0
    payload = {'client_request_id': 'first-budget', 'kind': 'initial', 'amount': '3000.50'}
    response = client.post('/paper-portfolio/funds', headers=headers, json=payload)
    assert response.status_code == 200, response.text
    assert response.json()['available_cash'] == 3000.5
    assert client.post('/paper-portfolio/funds', headers=headers, json=payload).json()['cash'] == 3000.5
    assert client.post('/paper-portfolio/funds', headers=headers, json={**payload, 'user_id': owner}).status_code == 422
    assert client.post('/paper-portfolio/funds', headers=headers, json={**payload, 'amount': 5000}).status_code == 409
    assert db_session.get(PaperAccount, owner).cash == Decimal('3000.50')


@pytest.mark.parametrize('next_action', ['withdrawal', 'order'])
def test_settlement_survives_locking_rereads_without_autoflush(db_session, owner, next_action):
    db_session.autoflush = False
    fund(db_session, owner, 'initial', 10000)
    buy(db_session, owner, budget=10000)
    market(db_session, 2, 100)
    if next_action == 'withdrawal':
        result = fund(db_session, owner, 'withdrawal', '85.89', day=2)
        assert result['cash'] == 0
        assert result['available_cash'] == 0
    else:
        service.create_order(db_session, owner, OrderCreate(
            client_request_id='next-buy', symbol='2330', side='buy', budget='85.89'), now=at(2))
        result = service.snapshot(db_session, owner, at(2))
        assert result['cash'] == 85.89
        assert result['available_cash'] == 0
        assert result['reserved_cash'] == 85.89
    original = next(row for row in result['orders'] if row['client_request_id'] == 'buy')
    assert original['status'] == 'filled'
    assert result['positions'][0]['quantity'] == 99
    service.reconcile(db_session, owner, at(2))
    repeated = service.snapshot(db_session, owner, at(2))
    assert repeated['cash'] == result['cash']
    assert repeated['positions'] == result['positions']


@pytest.mark.parametrize('operation', ['deposit', 'get'])
def test_post_commit_snapshot_refreshes_cash_after_concurrent_deposit(db_session, owner, operation):
    from sqlalchemy import event
    from sqlalchemy.orm import Session
    from app.db.models.paper_portfolio import PaperAccount
    db_session.autoflush = False
    fund(db_session, owner, 'initial', 30000)
    # Retain the row as production sessions do with expire_on_commit=False.
    retained_account = db_session.get(PaperAccount, owner)

    def concurrent_deposit(session):
        with Session(session.get_bind(), expire_on_commit=False, autoflush=False) as other:
            fund(other, owner, 'deposit', 1000, key='concurrent')

    event.listen(db_session, 'after_commit', concurrent_deposit, once=True)
    if operation == 'deposit':
        result = fund(db_session, owner, 'deposit', 2000)
        expected = 33000
    else:
        result = service.get_portfolio(db_session, owner, now=at(1))
        expected = 31000
    assert result['cash'] == expected
    assert result['net_contributions'] == expected
    assert result['total_pnl'] == 0
    assert retained_account.cash == expected



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


def test_user_facing_rule_text_is_plain_chinese(db_session, owner):
    """P2-125／P2-126：待成交說明與模擬規則用一般使用者看得懂的說法。"""
    buy(db_session, owner)
    portfolio = service.get_portfolio(db_session, owner, now=at(1))
    pending = [order for order in portfolio['orders'] if order['status'] == 'pending']
    assert pending and pending[0]['pending_reason'] == (
        '將以送出後下一個交易日的收盤價成交；該日行情補齊前會等待。'
        '若之後已有 3 個交易日行情、該日仍沒有收盤價（例如暫停交易），委託會自動取消，釋出保留的資金或股數。')
    note = portfolio['accounting_note']
    assert '證券交易稅 0.3%（賣出時）' in note and '計算到小數 2 位' in note and '未計入股息與除權息' in note
    for phrase in ('賣出稅', '四捨五入至分', '公司行動'):
        assert phrase not in note
