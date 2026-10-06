from sqlalchemy import func, select
from app.db.models.user import User
from app.db.models.paper_portfolio import PaperAccount, PaperCashMovement, PaperOrder, PaperReview
from app.db.models.daily_price import DailyPrice
from app.db.models.benchmark_price import BenchmarkPrice


def lock_owner(db, user_id):
    return db.scalar(select(User).where(User.id == user_id).with_for_update())


def account(db, user_id, lock=False):
    query = select(PaperAccount).where(PaperAccount.user_id == user_id).execution_options(populate_existing=True)
    if lock:
        query = query.with_for_update()
    return db.scalar(query)


def orders(db, user_id, lock=False):
    query = select(PaperOrder).where(PaperOrder.user_id == user_id).order_by(PaperOrder.created_at, PaperOrder.id).execution_options(populate_existing=True)
    if lock:
        query = query.with_for_update()
    return list(db.scalars(query))


def fund_movements(db, user_id, lock=False):
    query = select(PaperCashMovement).where(PaperCashMovement.user_id == user_id).order_by(PaperCashMovement.created_at, PaperCashMovement.id).execution_options(populate_existing=True)
    if lock:
        query = query.with_for_update()
    return list(db.scalars(query))


def reviews(db, user_id, lock=False):
    query = select(PaperReview).where(PaperReview.user_id == user_id).order_by(PaperReview.due_date.desc()).execution_options(populate_existing=True)
    if lock:
        query = query.with_for_update()
    return list(db.scalars(query))


def sessions(db, until):
    return list(db.scalars(select(BenchmarkPrice.date).where(BenchmarkPrice.symbol == 'TAIEX', BenchmarkPrice.date <= until).order_by(BenchmarkPrice.date)))


def price(db, symbol, day):
    return db.get(DailyPrice, (day, symbol))


def priced_sessions_after(db, symbol, after, until):
    return db.scalar(select(func.count()).select_from(DailyPrice).where(
        DailyPrice.symbol == symbol, DailyPrice.date > after, DailyPrice.date <= until, DailyPrice.close > 0))


def latest_price(db, symbol, until):
    return db.scalar(select(DailyPrice).where(DailyPrice.symbol == symbol, DailyPrice.date <= until, DailyPrice.close > 0).order_by(DailyPrice.date.desc()).limit(1))


def owners(db):
    return list(db.scalars(select(PaperAccount.user_id).order_by(PaperAccount.user_id)))


def stock(db, symbol):
    from app.db.models.stock_info import StockInfo
    return db.get(StockInfo, symbol)


def conversation(db, conversation_id):
    from app.db.models.conversation import Conversation
    return db.get(Conversation, conversation_id)


def benchmark(db, day):
    return db.get(BenchmarkPrice, ('TAIEX', day))
