from pydantic import BaseModel, Field, field_validator
from datetime import date as Date
from decimal import Decimal
from typing import Optional, List


# 基礎 Schema
class DailyPriceBase(BaseModel):
    date: Date = Field(..., description="日期")
    symbol: str = Field(..., min_length=1, max_length=10, description="股票代號")
    open: Optional[Decimal] = Field(None, description="開盤價")
    high: Optional[Decimal] = Field(None, description="最高價")
    low: Optional[Decimal] = Field(None, description="最低價")
    close: Optional[Decimal] = Field(None, description="收盤價")
    volume_shares: Optional[int] = Field(None, description="成交股數")
    amount: Optional[int] = Field(None, description="成交金額")
    change: Optional[Decimal] = Field(None, description="漲跌價差")
    trades: Optional[int] = Field(None, description="成交筆數")


# 返回給客戶端的 Schema
class DailyPriceResponse(DailyPriceBase):
    class Config:
        from_attributes = True


class SymbolDateRangeResponseBase(BaseModel):
    symbol: str
    start_date: Date
    end_date: Date


class TotalSymbolDateRangeResponseBase(SymbolDateRangeResponseBase):
    total: int


# K線圖數據 Schema（前端繪圖用）
class CandlestickData(BaseModel):
    date: str = Field(..., description="日期（YYYY-MM-DD 格式）")
    open: float = Field(..., description="開盤價")
    high: float = Field(..., description="最高價")
    low: float = Field(..., description="最低價")
    close: float = Field(..., description="收盤價")
    volume: int = Field(..., description="成交股數")


# 統計數據 Schema
class PriceStatistics(BaseModel):
    symbol: str = Field(..., description="股票代號")
    start_date: Date = Field(..., description="開始日期")
    end_date: Date = Field(..., description="結束日期")
    highest_price: Optional[Decimal] = Field(None, description="最高價")
    lowest_price: Optional[Decimal] = Field(None, description="最低價")
    average_close: Optional[Decimal] = Field(None, description="平均收盤價")
    total_volume: Optional[int] = Field(None, description="總成交股數")
    total_amount: Optional[int] = Field(None, description="總成交金額")
    trading_days: int = Field(..., description="交易天數")


# 歷史價格列表 Schema
class HistoricalPriceList(TotalSymbolDateRangeResponseBase):
    data: List[DailyPriceResponse]


# K線圖數據列表 Schema
class CandlestickResponse(TotalSymbolDateRangeResponseBase):
    data: List[CandlestickData]


# 多股票比較 Schema
class MultiStockData(BaseModel):
    date: str
    prices: dict[str, Optional[float]]  # {symbol: close_price}


class MultiStockResponse(BaseModel):
    start_date: Date
    end_date: Date
    symbols: List[str]
    data: List[MultiStockData]


# K線圖 + 移動平均線 Schema
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
    moving_averages: dict  # {"MA5": [...], "MA10": [...], "MA20": [...]}


# 成交量分析 Schema
class VolumeData(BaseModel):
    date: str
    volume: int
    amount: int
    close: float
    change: float


class VolumeAnalysisResponse(SymbolDateRangeResponseBase):
    data: List[VolumeData]


# 價格變化 Schema
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
    price_volume: List[dict]
    institutional_trades: List[dict]
    volume_with_chips: List[ChipsVolumeData]
    technical_indicators: List[dict]
