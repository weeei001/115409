from datetime import date as Date
from decimal import Decimal
from typing import List, Optional, TypeVar, Generic

from pydantic import BaseModel, ConfigDict, Field


T = TypeVar("T")


class ListResponse(BaseModel, Generic[T]):
    symbol: str = Field(..., description="股票代號")
    start_date: Date = Field(..., description="查詢開始日期")
    end_date: Date = Field(..., description="查詢結束日期")
    total: int = Field(..., description="資料筆數")
    data: List[T]


class _OrmModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class FinancialStatementRowResponse(_OrmModel):
    date: Date
    symbol: str
    statement: str
    item_type: str
    origin_name: str
    value: Optional[Decimal] = None


class MonthlyRevenueResponse(_OrmModel):
    date: Date
    symbol: str
    country: Optional[str] = None
    revenue: Optional[int] = None
    revenue_month: Optional[int] = None
    revenue_year: Optional[int] = None
    create_time: Optional[str] = None


class StockValuationResponse(_OrmModel):
    date: Date
    symbol: str
    dividend_yield: Optional[Decimal] = None
    per: Optional[Decimal] = None
    pbr: Optional[Decimal] = None


class StockDividendResponse(_OrmModel):
    date: Date
    symbol: str
    year: str
    stock_earnings_distribution: Optional[Decimal] = None
    stock_statutory_surplus: Optional[Decimal] = None
    stock_ex_dividend_trading_date: Optional[Date] = None
    total_employee_stock_dividend: Optional[Decimal] = None
    total_employee_stock_dividend_amount: Optional[Decimal] = None
    ratio_of_employee_stock_dividend_of_total: Optional[Decimal] = None
    ratio_of_employee_stock_dividend: Optional[Decimal] = None
    cash_earnings_distribution: Optional[Decimal] = None
    cash_statutory_surplus: Optional[Decimal] = None
    cash_ex_dividend_trading_date: Optional[Date] = None
    cash_dividend_payment_date: Optional[Date] = None
    total_employee_cash_dividend: Optional[Decimal] = None
    total_number_of_cash_capital_increase: Optional[Decimal] = None
    cash_increase_subscription_rate: Optional[Decimal] = None
    cash_increase_subscription_price: Optional[Decimal] = None
    remuneration_of_directors_and_supervisors: Optional[Decimal] = None
    participate_distribution_of_total_shares: Optional[Decimal] = None
    announcement_date: Optional[Date] = None
    announcement_time: Optional[str] = None


class DividendResultResponse(_OrmModel):
    date: Date
    symbol: str
    before_price: Optional[Decimal] = None
    after_price: Optional[Decimal] = None
    stock_and_cash_dividend: Optional[Decimal] = None
    stock_or_cash_dividend: Optional[str] = None
    max_price: Optional[Decimal] = None
    min_price: Optional[Decimal] = None
    open_price: Optional[Decimal] = None
    reference_price: Optional[Decimal] = None


class MarginTradeResponse(_OrmModel):
    date: Date
    symbol: str
    margin_purchase_buy: Optional[int] = None
    margin_purchase_cash_repayment: Optional[int] = None
    margin_purchase_limit: Optional[int] = None
    margin_purchase_sell: Optional[int] = None
    margin_purchase_today_balance: Optional[int] = None
    margin_purchase_yesterday_balance: Optional[int] = None
    note: Optional[str] = None
    offset_loan_and_short: Optional[int] = None
    short_sale_buy: Optional[int] = None
    short_sale_cash_repayment: Optional[int] = None
    short_sale_limit: Optional[int] = None
    short_sale_sell: Optional[int] = None
    short_sale_today_balance: Optional[int] = None
    short_sale_yesterday_balance: Optional[int] = None


class ForeignShareholdingResponse(_OrmModel):
    date: Date
    symbol: str
    stock_name: Optional[str] = None
    international_code: Optional[str] = None
    foreign_investment_remaining_shares: Optional[int] = None
    foreign_investment_shares: Optional[int] = None
    foreign_investment_remain_ratio: Optional[Decimal] = None
    foreign_investment_shares_ratio: Optional[Decimal] = None
    foreign_investment_upper_limit_ratio: Optional[Decimal] = None
    chinese_investment_upper_limit_ratio: Optional[Decimal] = None
    number_of_shares_issued: Optional[int] = None
    recently_declare_date: Optional[Date] = None
    note: Optional[str] = None


class HoldingShareLevelResponse(_OrmModel):
    date: Date
    symbol: str
    holding_shares_level: str
    people: Optional[int] = None
    percent: Optional[Decimal] = None
    unit: Optional[int] = None


FinancialStatementListResponse = ListResponse[FinancialStatementRowResponse]
MonthlyRevenueListResponse = ListResponse[MonthlyRevenueResponse]
StockValuationListResponse = ListResponse[StockValuationResponse]
StockDividendListResponse = ListResponse[StockDividendResponse]
DividendResultListResponse = ListResponse[DividendResultResponse]
MarginTradeListResponse = ListResponse[MarginTradeResponse]
ForeignShareholdingListResponse = ListResponse[ForeignShareholdingResponse]
HoldingShareLevelListResponse = ListResponse[HoldingShareLevelResponse]
