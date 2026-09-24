from datetime import date as Date
from decimal import Decimal
from typing import Generic, List, Optional, TypeVar

from pydantic import BaseModel, ConfigDict, Field


class DailyPriceBase(BaseModel):
    date: Date = Field(...)
    symbol: str = Field(..., min_length=1, max_length=10)
    open: Optional[Decimal] = Field(None)
    high: Optional[Decimal] = Field(None)
    low: Optional[Decimal] = Field(None)
    close: Optional[Decimal] = Field(None)
    volume_shares: Optional[int] = Field(None)
    amount: Optional[int] = Field(None)
    change: Optional[Decimal] = Field(None)
    trades: Optional[int] = Field(None)

class DailyPriceResponse(DailyPriceBase):
    model_config = ConfigDict(from_attributes=True)

class StockInfoResponse(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=10)
    name: str = Field(..., min_length=1, max_length=64)
    industry: Optional[str] = None

class SymbolDateRangeResponseBase(BaseModel):
    symbol: str
    start_date: Date
    end_date: Date

class TotalSymbolDateRangeResponseBase(SymbolDateRangeResponseBase):
    total: int

class DateRangeResponse(BaseModel):
    symbol: str = Field(...)
    min_date: Date = Field(...)
    max_date: Date = Field(...)

class PriceStatistics(BaseModel):
    symbol: str = Field(...)
    start_date: Date = Field(...)
    end_date: Date = Field(...)
    highest_price: Optional[Decimal] = Field(None)
    lowest_price: Optional[Decimal] = Field(None)
    average_close: Optional[Decimal] = Field(None)
    total_volume: Optional[int] = Field(None)
    total_amount: Optional[int] = Field(None)
    trading_days: int = Field(...)

class HistoricalPriceList(TotalSymbolDateRangeResponseBase):
    data: List[DailyPriceResponse]

class MultiStockData(BaseModel):
    date: str = Field(...)
    prices: dict[str, Optional[float]] = Field(...)

class MultiStockResponse(BaseModel):
    start_date: Date = Field(...)
    end_date: Date = Field(...)
    symbols: List[str] = Field(...)
    data: List[MultiStockData] = Field(...)

class CandlestickWithMA(BaseModel):
    date: str
    open: float
    high: float
    low: float
    close: float
    volume: int
    amount: int
    change: float

class CandlestickWithMAResponse(SymbolDateRangeResponseBase):
    dates: List[str]
    candlestick: List[CandlestickWithMA]
    moving_averages: dict = Field(...)

class VolumeData(BaseModel):
    date: str
    volume: int
    amount: int
    close: float
    change: float

class VolumeAnalysisResponse(SymbolDateRangeResponseBase):
    data: List[VolumeData]

class PriceChangeData(BaseModel):
    date: str
    close: float
    change: float
    change_percent: float

class PriceChangeResponse(SymbolDateRangeResponseBase):
    data: List[PriceChangeData]

class ChipsVolumeData(BaseModel):
    date: str
    close: Optional[float] = None
    volume: Optional[int] = None
    foreign_net: Optional[int] = None
    investment_trust_net: Optional[int] = None
    dealer_net: Optional[int] = None
    total_institutional_net: Optional[int] = None

class ChipsVolumeChartResponse(SymbolDateRangeResponseBase):
    data: List[ChipsVolumeData]

class IntegratedChartResponse(SymbolDateRangeResponseBase):
    price_volume: List[dict] = Field(...)
    institutional_trades: List[dict] = Field(...)
    volume_with_chips: List[ChipsVolumeData]
    technical_indicators: List[dict] = Field(...)

class InstitutionalTradeBase(BaseModel):
    date: Date = Field(...)
    symbol: str = Field(...)
    foreign_buy: Optional[int] = Field(None)
    foreign_sell: Optional[int] = Field(None)
    foreign_net: Optional[int] = Field(None)
    investment_trust_buy: Optional[int] = Field(None)
    investment_trust_sell: Optional[int] = Field(None)
    investment_trust_net: Optional[int] = Field(None)
    dealer_buy: Optional[int] = Field(None)
    dealer_sell: Optional[int] = Field(None)
    dealer_net: Optional[int] = Field(None)
    total_institutional_buy: Optional[int] = Field(None)
    total_institutional_sell: Optional[int] = Field(None)
    total_institutional_net: Optional[int] = Field(None)

class InstitutionalTradeResponse(InstitutionalTradeBase):
    model_config = ConfigDict(from_attributes=True)

class InstitutionalTradeListResponse(BaseModel):
    symbol: str = Field(...)
    start_date: Date = Field(...)
    end_date: Date = Field(...)
    total: int = Field(...)
    data: List[InstitutionalTradeResponse] = Field(...)

class TechnicalIndicatorBase(BaseModel):
    date: Date = Field(...)
    symbol: str = Field(...)
    close: Optional[Decimal] = Field(None)
    ma5: Optional[Decimal] = Field(None)
    ma10: Optional[Decimal] = Field(None)
    ma20: Optional[Decimal] = Field(None)
    ma60: Optional[Decimal] = Field(None)
    ma120: Optional[Decimal] = Field(None)
    ma240: Optional[Decimal] = Field(None)
    rsi5: Optional[Decimal] = Field(None)
    rsi10: Optional[Decimal] = Field(None)
    rsv9: Optional[Decimal] = Field(None)
    kd_k9: Optional[Decimal] = Field(None)
    kd_d9: Optional[Decimal] = Field(None)
    kd_j9: Optional[Decimal] = Field(None)
    ema12: Optional[Decimal] = Field(None)
    ema26: Optional[Decimal] = Field(None)
    macd_dif: Optional[Decimal] = Field(None)
    macd_dea: Optional[Decimal] = Field(None)
    macd_signal: Optional[Decimal] = Field(None)
    macd_hist: Optional[Decimal] = Field(None)
    boll_mid20: Optional[Decimal] = Field(None)
    boll_upper20: Optional[Decimal] = Field(None)
    boll_lower20: Optional[Decimal] = Field(None)
    volume_ma5: Optional[Decimal] = Field(None)

class TechnicalIndicatorResponse(TechnicalIndicatorBase):
    model_config = ConfigDict(from_attributes=True)

class TechnicalIndicatorListResponse(BaseModel):
    symbol: str = Field(...)
    start_date: Date = Field(...)
    end_date: Date = Field(...)
    total: int = Field(...)
    data: List[TechnicalIndicatorResponse] = Field(...)
T = TypeVar('T')

class ListResponse(BaseModel, Generic[T]):
    symbol: str = Field(...)
    start_date: Date = Field(...)
    end_date: Date = Field(...)
    total: int = Field(...)
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
DividendResultListResponse = ListResponse[DividendResultResponse]
MarginTradeListResponse = ListResponse[MarginTradeResponse]
ForeignShareholdingListResponse = ListResponse[ForeignShareholdingResponse]
HoldingShareLevelListResponse = ListResponse[HoldingShareLevelResponse]
