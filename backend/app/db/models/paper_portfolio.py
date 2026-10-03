from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from app.db.base import Base


class PaperAccount(Base):
    __tablename__ = 'paper_accounts'
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    initial_cash = Column(Numeric(18, 2), nullable=False)
    cash = Column(Numeric(18, 2), nullable=False)


class PaperCashMovement(Base):
    __tablename__ = 'paper_cash_movements'
    id = Column(String(36), primary_key=True)
    user_id = Column(Integer, ForeignKey('paper_accounts.user_id', ondelete='CASCADE'), nullable=False, index=True)
    client_request_id = Column(String(128), nullable=False)
    kind = Column(String(16), nullable=False)
    amount = Column(Numeric(18, 2), nullable=False)
    created_at = Column(DateTime, nullable=False)
    __table_args__ = (UniqueConstraint('user_id', 'client_request_id', name='uq_paper_cash_request'),)


class PaperOrder(Base):
    __tablename__ = 'paper_orders'
    id = Column(String(36), primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    client_request_id = Column(String(128), nullable=False)
    symbol = Column(String(10), nullable=False)
    side = Column(String(4), nullable=False)
    status = Column(String(16), nullable=False, default='pending')
    budget = Column(Numeric(18, 2))
    quantity = Column(Integer)
    filled_quantity = Column(Integer, nullable=False, default=0)
    fill_price = Column(Numeric(18, 4))
    fee = Column(Numeric(18, 2), nullable=False, default=0)
    tax = Column(Numeric(18, 2), nullable=False, default=0)
    fee_rate = Column(Numeric(10, 7), nullable=False, default='0.001425')
    tax_rate = Column(Numeric(10, 7), nullable=False, default='0.003')
    created_at = Column(DateTime, nullable=False)
    trade_date = Column(Date)
    reason = Column(Text, nullable=False, default='')
    observation = Column(Text, nullable=False, default='')
    review_after_days = Column(Integer, nullable=False, default=20)
    conversation_id = Column(String(36))
    __table_args__ = (UniqueConstraint('user_id', 'client_request_id', name='uq_paper_request'),)


class PaperReview(Base):
    __tablename__ = 'paper_reviews'
    id = Column(String(36), primary_key=True)
    order_id = Column(String(36), ForeignKey('paper_orders.id', ondelete='CASCADE'), nullable=False, unique=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    status = Column(String(16), nullable=False, default='due')
    due_date = Column(Date, nullable=False)
    reviewed_at = Column(DateTime)
