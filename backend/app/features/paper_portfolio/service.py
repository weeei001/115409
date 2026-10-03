"""Authenticated virtual cash ledger. All prices are daily closing prices, all sizes shares."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_DOWN, ROUND_HALF_UP
from hashlib import sha256
from uuid import uuid4
from zoneinfo import ZoneInfo

from app.core.errors import AppError, NotFound, Conflict
from app.db.models.paper_portfolio import PaperAccount, PaperCashMovement, PaperOrder, PaperReview
from app.db.models.notification import Notification
from app.features.paper_portfolio import repository as repo

TAIPEI = ZoneInfo('Asia/Taipei')


def _now(now=None):
    value = now or datetime.now(timezone.utc)
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _day(now):
    return _now(now).astimezone(TAIPEI).date()


def _money(value):
    return Decimal(value).quantize(Decimal('.01'), rounding=ROUND_HALF_UP)


def _holdings(records):
    holdings, realized = {}, Decimal(0)
    for row in sorted((r for r in records if r.status == 'filled'), key=lambda r: (r.trade_date, r.created_at, r.id)):
        item = holdings.setdefault(row.symbol, {'quantity': 0, 'cost': Decimal(0)})
        gross = row.fill_price * row.filled_quantity
        if row.side == 'buy':
            item['quantity'] += row.filled_quantity
            item['cost'] += gross + row.fee
        else:
            cost = item['cost'] if row.filled_quantity == item['quantity'] else _money(item['cost'] * row.filled_quantity / item['quantity'])
            item['quantity'] -= row.filled_quantity
            item['cost'] -= cost
            realized += gross - row.fee - row.tax - cost
    return holdings, realized


def _lock_account(db, user_id, required=True):
    if repo.lock_owner(db, user_id) is None:
        raise NotFound('找不到使用者')
    account = repo.account(db, user_id, lock=True)
    if account is None and required:
        raise Conflict('請先設定模擬投資預算')
    return account


def create_fund_movement(db, user_id, body, now=None):
    current = _now(now)
    try:
        account = _lock_account(db, user_id, required=False)
        movements = repo.fund_movements(db, user_id, lock=True)
        existing = next((row for row in movements if row.client_request_id == body.client_request_id), None)
        if existing:
            if existing.kind != body.kind or existing.amount != body.amount:
                raise Conflict('此請求已用於其他資金調整，請重新送出')
            db.commit()
            return snapshot(db, user_id, now=current)
        if body.kind == 'initial':
            if account is not None:
                raise Conflict('已設定投資預算，請使用增加或取回資金')
            account = PaperAccount(user_id=user_id, initial_cash=body.amount, cash=body.amount)
            db.add(account)
            db.flush()
        else:
            if account is None:
                raise Conflict('請先設定模擬投資預算')
            _settle(db, user_id, current)
            if body.kind == 'withdrawal':
                reserved = sum((row.budget for row in repo.orders(db, user_id, lock=True)
                                if row.status == 'pending' and row.side == 'buy'), Decimal(0))
                if body.amount > account.cash - reserved:
                    raise AppError('可用模擬資金不足，請減少取回金額或先取消待成交委託')
                account.cash -= body.amount
            else:
                account.cash += body.amount
        db.add(PaperCashMovement(id=str(uuid4()), user_id=user_id,
                                created_at=current.replace(tzinfo=None), **body.model_dump()))
        db.commit()
        return snapshot(db, user_id, now=current)
    except Exception:
        db.rollback()
        raise


def _order(row, sessions=None):
    result = {key: getattr(row, key) for key in ('id', 'client_request_id', 'symbol', 'side', 'status', 'budget', 'quantity', 'filled_quantity', 'fill_price', 'fee', 'tax', 'fee_rate', 'tax_rate', 'created_at', 'trade_date', 'reason', 'observation', 'review_after_days', 'conversation_id')}
    result.update(review_elapsed_days=None, review_remaining_days=None, review_due_date=None)
    if sessions is not None and row.status == 'filled' and row.side == 'buy':
        following = [day for day in sessions if day > row.trade_date]
        result['review_elapsed_days'] = len(following)
        result['review_remaining_days'] = max(0, row.review_after_days - len(following))
        if len(following) >= row.review_after_days:
            result['review_due_date'] = following[row.review_after_days - 1].isoformat()
    result['created_at'] = _now(row.created_at).isoformat()
    result['trade_date'] = row.trade_date.isoformat() if row.trade_date else None
    for key in ('budget', 'fill_price', 'fee', 'tax', 'fee_rate', 'tax_rate'):
        result[key] = float(result[key]) if result[key] is not None else None
    result['pending_reason'] = '等待送出日期後下一個交易日的收盤價；缺少當日行情時會繼續等待，不改用其他日期。' if row.status == 'pending' else None
    return result


def create_order(db, user_id, body, now=None):
    current = _now(now)
    try:
        account = _lock_account(db, user_id)
        _settle(db, user_id, current)
        records = repo.orders(db, user_id, lock=True)
        existing = next((r for r in records if r.client_request_id == body.client_request_id), None)
        if existing:
            fields = ('symbol', 'side', 'budget', 'quantity', 'reason', 'observation', 'review_after_days', 'conversation_id')
            if any(getattr(existing, k) != getattr(body, k) for k in fields):
                raise Conflict('此請求識別碼已用於其他委託，請重新建立草稿')
            db.commit()
            return _order(existing)
        if repo.stock(db, body.symbol) is None:
            raise NotFound('找不到股票')
        if body.conversation_id:
            conversation = repo.conversation(db, body.conversation_id)
            if conversation is None or conversation.user_id != user_id:
                raise NotFound('找不到對話')
        holdings, _ = _holdings(records)
        pending = [r for r in records if r.status == 'pending']
        if body.side == 'buy':
            available = account.cash - sum((r.budget for r in pending if r.side == 'buy'), Decimal(0))
            if body.budget > available:
                raise AppError('可用虛擬資金不足')
        else:
            shares = holdings.get(body.symbol, {}).get('quantity', 0)
            reserved = sum(r.quantity for r in pending if r.side == 'sell' and r.symbol == body.symbol)
            if body.quantity > shares - reserved:
                raise AppError('可賣股數不足')
        row = PaperOrder(id=str(uuid4()), user_id=user_id, created_at=current.replace(tzinfo=None),
                         fee_rate=Decimal('.001425'), tax_rate=Decimal('.003'), **body.model_dump())
        db.add(row)
        db.commit()
        return _order(row)
    except Exception:
        db.rollback()
        raise


def cancel_order(db, user_id, order_id, now=None):
    current = _now(now)
    try:
        _settle(db, user_id, current)
        row = next((r for r in repo.orders(db, user_id, lock=True) if r.id == order_id), None)
        if row is None:
            raise NotFound('找不到委託')
        if row.status == 'filled':
            raise Conflict('已成交的委託無法取消')
        if row.status == 'pending' and any(day > _day(row.created_at) for day in _eligible_sessions(db, current)):
            raise Conflict('預定成交日已收盤，目前等待行情補齊，無法取消委託')
        row.status = 'cancelled'
        db.commit()
        return _order(row)
    except Exception:
        db.rollback()
        raise


def _eligible_sessions(db, current):
    days = repo.sessions(db, _day(current))
    # A same-day closing price is eligible only once Taiwan's regular session is over.
    local = current.astimezone(TAIPEI)
    if (local.hour, local.minute) < (13, 30):
        days = [day for day in days if day < local.date()]
    return days


def _settle(db, user_id, current):
    account = _lock_account(db, user_id, required=False)
    if account is None:
        return
    records = repo.orders(db, user_id, lock=True)
    days = _eligible_sessions(db, current)
    for row in records:
        if row.status != 'pending':
            continue
        trade_day = next((day for day in days if day > _day(row.created_at)), None)
        if trade_day is None:
            continue
        price = repo.price(db, row.symbol, trade_day)
        if price is None or price.close is None or price.close <= 0:
            continue
        if row.side == 'buy':
            qty = int((row.budget / (price.close * (1 + row.fee_rate))).to_integral_value(rounding=ROUND_DOWN))
            # Fee rounding can free enough cents for one additional share.
            if price.close * (qty + 1) + _money(price.close * (qty + 1) * row.fee_rate) <= row.budget:
                qty += 1
            while qty > 0 and price.close * qty + _money(price.close * qty * row.fee_rate) > row.budget:
                qty -= 1
            if qty == 0:
                row.status = 'cancelled'
                continue
            fee = _money(price.close * qty * row.fee_rate)
            account.cash -= price.close * qty + fee
            tax = Decimal(0)
        else:
            qty = row.quantity
            fee = _money(price.close * qty * row.fee_rate)
            tax = _money(price.close * qty * row.tax_rate)
            account.cash += price.close * qty - fee - tax
        row.status, row.trade_date = 'filled', trade_day
        row.filled_quantity, row.fill_price, row.fee, row.tax = qty, price.close, fee, tax
    existing = {r.order_id for r in repo.reviews(db, user_id, lock=True)}
    for row in records:
        if row.status != 'filled' or row.side != 'buy' or row.id in existing:
            continue
        following = [day for day in days if day > row.trade_date]
        if len(following) < row.review_after_days:
            continue
        due = following[row.review_after_days - 1]
        review = PaperReview(id=str(uuid4()), user_id=user_id, order_id=row.id, due_date=due, status='due')
        db.add(review)
        timestamp = current.replace(tzinfo=None)
        db.add(Notification(user_id=user_id, kind='paper_review', symbol=row.symbol,
                            title=f'{row.symbol} 的模擬投資已到回顧時間',
                            body='回顧當初的投資理由，對照後續行情與新聞。',
                            url=f'/order?review={review.id}', dedupe_key=sha256(f'paper-review:{row.id}'.encode()).hexdigest(),
                            created_at=timestamp, expires_at=timestamp + timedelta(days=90), delivered_at=timestamp))
    # Locking rereads refresh ORM state even when the session disables autoflush.
    db.flush()


def reconcile(db, user_id=None, now=None):
    current = _now(now)
    owners = [user_id] if user_id is not None else repo.owners(db)
    for owner in owners:
        try:
            _settle(db, owner, current)
            db.commit()
        except Exception:
            db.rollback()
            raise
    return {'accounts': len(owners)}


def snapshot(db, user_id, now=None):
    """Read-only snapshot suitable for authenticated chat context."""
    current = _now(now)
    account = repo.account(db, user_id)
    records = repo.orders(db, user_id)
    holdings, realized = _holdings(records)
    pending = [r for r in records if r.status == 'pending']
    reserved = sum((r.budget for r in pending if r.side == 'buy'), Decimal(0))
    cash = account.cash if account else Decimal(0)
    initial_cash = account.initial_cash if account else Decimal(0)
    movements = repo.fund_movements(db, user_id)
    deposits = sum((row.amount for row in movements if row.kind == 'deposit'), Decimal(0))
    withdrawals = sum((row.amount for row in movements if row.kind == 'withdrawal'), Decimal(0))
    contributions = initial_cash + deposits - withdrawals
    positions, value, unrealized = [], Decimal(0), Decimal(0)
    position_values = {}
    unpriced = False
    for symbol, holding in holdings.items():
        if not holding['quantity']:
            continue
        latest = repo.latest_price(db, symbol, _day(current))
        mark = latest.close if latest else None
        market_value = _money(mark * holding['quantity']) if mark is not None else None
        position_values[symbol] = market_value
        profit = market_value - holding['cost'] if market_value is not None else None
        unpriced = unpriced or market_value is None
        if market_value is not None:
            value += market_value
            unrealized += profit
        positions.append(dict(symbol=symbol, quantity=holding['quantity'], average_cost=float(holding['cost'] / holding['quantity']),
                              market_price=float(mark) if mark is not None else None, market_date=latest.date.isoformat() if latest else None,
                              market_value=float(market_value) if market_value is not None else None, unrealized_pnl=float(profit) if profit is not None else None,
                              reserved_quantity=sum(r.quantity for r in pending if r.side == 'sell' and r.symbol == symbol)))
    equity = None if unpriced else cash + value

    def allocation(amount):
        if account is None or equity is None or equity <= 0 or amount is None:
            return None
        return float(_money(amount / equity * 100))

    for position in positions:
        position['allocation_pct'] = allocation(position_values[position['symbol']])
    sessions = _eligible_sessions(db, current)
    orders_by_id = {r.id: r for r in records}
    reviews = []
    for row in repo.reviews(db, user_id):
        order = orders_by_id[row.order_id]
        close = repo.price(db, order.symbol, row.due_date)
        start = repo.benchmark(db, order.trade_date)
        end = repo.benchmark(db, row.due_date)
        reviews.append(dict(id=row.id, order_id=row.order_id, symbol=order.symbol, status=row.status,
                            reason=order.reason, observation=order.observation, opened_date=order.trade_date.isoformat(),
                            due_date=row.due_date.isoformat(), review_after_days=order.review_after_days,
                            entry_price=float(order.fill_price), closing_price=float(close.close) if close and close.close else None,
                            price_return_pct=float((close.close / order.fill_price - 1) * 100) if close and close.close else None,
                            benchmark_return_pct=float((end.close / start.close - 1) * 100) if start and end and start.close > 0 else None,
                            comparison_note='價格報酬未含股息與費稅；帳戶損益含模擬費稅。除權息與其他公司行動未調整，請勿直接以漲跌認定判斷成敗。'))
    return dict(initialized=account is not None, initial_cash=float(initial_cash), cash=float(cash),
                total_deposits=float(deposits), total_withdrawals=float(withdrawals), net_contributions=float(contributions),
                total_pnl=None if unpriced else float(cash + value - contributions),
                fund_movements=[dict(id=row.id, kind=row.kind, amount=float(row.amount), created_at=_now(row.created_at).isoformat()) for row in reversed(movements)],
                available_cash=float(cash - reserved), reserved_cash=float(reserved), equity=float(equity) if equity is not None else None, valuation_status='missing_prices' if unpriced else 'available',
                holdings_value=None if unpriced else float(value), holdings_allocation_pct=allocation(value),
                cash_allocation_pct=allocation(cash), available_cash_allocation_pct=allocation(cash - reserved),
                reserved_cash_allocation_pct=allocation(reserved),
                realized_pnl=float(realized), unrealized_pnl=None if unpriced else float(unrealized), as_of=current.isoformat(),
                positions=positions, orders=[_order(r, sessions) for r in reversed(records)], reviews=reviews,
                accounting_note='以股為單位模擬交易；手續費 0.1425%、賣出稅 0.3%，四捨五入至分，無最低費用。此為固定模擬規則，不代表各商品實際稅費；股息與公司行動尚未計入。')


def get_portfolio(db, user_id, now=None):
    reconcile(db, user_id=user_id, now=now)
    return snapshot(db, user_id, now=now)


def acknowledge_review(db, user_id, review_id, now=None):
    try:
        _lock_account(db, user_id)
        row = next((r for r in repo.reviews(db, user_id, lock=True) if r.id == review_id), None)
        if row is None:
            raise NotFound('找不到回顧')
        row.status = 'reviewed'
        row.reviewed_at = _now(now).replace(tzinfo=None)
        db.commit()
        return {'id': row.id, 'status': row.status}
    except Exception:
        db.rollback()
        raise
