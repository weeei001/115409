from sqlalchemy import BigInteger, Column, Date, DECIMAL, Index, String, Text

from app.db.base import Base


class FinancialStatementRow(Base):
    __tablename__ = "market_financial_statement_rows"

    date = Column(Date, primary_key=True, nullable=False)
    symbol = Column(String(10), primary_key=True, nullable=False)
    statement = Column(String(16), primary_key=True, nullable=False)
    item_type = Column(String(128), primary_key=True, nullable=False)
    origin_name = Column(String(255), primary_key=True, nullable=False, default="")
    value = Column(DECIMAL(24, 4), nullable=True)

    __table_args__ = (Index("idx_fsr_symbol_date", "symbol", "date"),)


class MonthlyRevenue(Base):
    __tablename__ = "market_monthly_revenues"

    date = Column(Date, primary_key=True, nullable=False)
    symbol = Column(String(10), primary_key=True, nullable=False)
    country = Column(String(32), nullable=True)
    revenue = Column(BigInteger, nullable=True)
    revenue_month = Column(BigInteger, nullable=True)
    revenue_year = Column(BigInteger, nullable=True)
    create_time = Column(String(32), nullable=True)

    __table_args__ = (Index("idx_fmr_symbol_date", "symbol", "date"),)


class StockValuation(Base):
    __tablename__ = "market_stock_valuations"

    date = Column(Date, primary_key=True, nullable=False)
    symbol = Column(String(10), primary_key=True, nullable=False)
    dividend_yield = Column(DECIMAL(10, 4), nullable=True)
    per = Column(DECIMAL(10, 4), nullable=True)
    pbr = Column(DECIMAL(10, 4), nullable=True)

    __table_args__ = (Index("idx_fsv_symbol_date", "symbol", "date"),)


class DividendResult(Base):
    __tablename__ = "market_dividend_results"

    date = Column(Date, primary_key=True, nullable=False)
    symbol = Column(String(10), primary_key=True, nullable=False)
    before_price = Column(DECIMAL(12, 4), nullable=True)
    after_price = Column(DECIMAL(12, 4), nullable=True)
    stock_and_cash_dividend = Column(DECIMAL(12, 4), nullable=True)
    stock_or_cash_dividend = Column(String(16), nullable=True)
    max_price = Column(DECIMAL(12, 4), nullable=True)
    min_price = Column(DECIMAL(12, 4), nullable=True)
    open_price = Column(DECIMAL(12, 4), nullable=True)
    reference_price = Column(DECIMAL(12, 4), nullable=True)

    __table_args__ = (Index("idx_fdr_symbol_date", "symbol", "date"),)


class MarginTrade(Base):
    __tablename__ = "market_margin_trades"

    date = Column(Date, primary_key=True, nullable=False)
    symbol = Column(String(10), primary_key=True, nullable=False)
    margin_purchase_buy = Column(BigInteger, nullable=True)
    margin_purchase_cash_repayment = Column(BigInteger, nullable=True)
    margin_purchase_limit = Column(BigInteger, nullable=True)
    margin_purchase_sell = Column(BigInteger, nullable=True)
    margin_purchase_today_balance = Column(BigInteger, nullable=True)
    margin_purchase_yesterday_balance = Column(BigInteger, nullable=True)
    note = Column(String(64), nullable=True)
    offset_loan_and_short = Column(BigInteger, nullable=True)
    short_sale_buy = Column(BigInteger, nullable=True)
    short_sale_cash_repayment = Column(BigInteger, nullable=True)
    short_sale_limit = Column(BigInteger, nullable=True)
    short_sale_sell = Column(BigInteger, nullable=True)
    short_sale_today_balance = Column(BigInteger, nullable=True)
    short_sale_yesterday_balance = Column(BigInteger, nullable=True)

    __table_args__ = (Index("idx_fmt_symbol_date", "symbol", "date"),)


class ForeignShareholding(Base):
    __tablename__ = "market_foreign_shareholdings"

    date = Column(Date, primary_key=True, nullable=False)
    symbol = Column(String(10), primary_key=True, nullable=False)
    stock_name = Column(String(64), nullable=True)
    international_code = Column(String(32), nullable=True)
    foreign_investment_remaining_shares = Column(BigInteger, nullable=True)
    foreign_investment_shares = Column(BigInteger, nullable=True)
    foreign_investment_remain_ratio = Column(DECIMAL(10, 4), nullable=True)
    foreign_investment_shares_ratio = Column(DECIMAL(10, 4), nullable=True)
    foreign_investment_upper_limit_ratio = Column(DECIMAL(10, 4), nullable=True)
    chinese_investment_upper_limit_ratio = Column(DECIMAL(10, 4), nullable=True)
    number_of_shares_issued = Column(BigInteger, nullable=True)
    recently_declare_date = Column(Date, nullable=True)
    note = Column(Text, nullable=True)

    __table_args__ = (Index("idx_ffh_symbol_date", "symbol", "date"),)


class HoldingShareLevel(Base):
    __tablename__ = "market_holding_share_levels"

    date = Column(Date, primary_key=True, nullable=False)
    symbol = Column(String(10), primary_key=True, nullable=False)
    holding_shares_level = Column(String(32), primary_key=True, nullable=False)
    people = Column(BigInteger, nullable=True)
    percent = Column(DECIMAL(10, 4), nullable=True)
    unit = Column(BigInteger, nullable=True)

    __table_args__ = (Index("idx_fhsl_symbol_date", "symbol", "date"),)
