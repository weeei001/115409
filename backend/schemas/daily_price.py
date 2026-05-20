from pydantic import BaseModel, ConfigDict, Field
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
    model_config = ConfigDict(
        from_attributes=True,
        json_schema_extra={
            "example": {
                "date": "2026-05-20",
                "symbol": "2330",
                "open": "915.00",
                "high": "925.00",
                "low": "910.00",
                "close": "920.00",
                "volume_shares": 32100000,
                "amount": 29532000000,
                "change": "5.00",
                "trades": 18750,
            }
        },
    )


class SymbolDateRangeResponseBase(BaseModel):
    symbol: str
    start_date: Date
    end_date: Date


class TotalSymbolDateRangeResponseBase(SymbolDateRangeResponseBase):
    total: int


class DateRangeResponse(BaseModel):
    symbol: str = Field(..., description="股票代號")
    min_date: Date = Field(..., description="資料庫中最早交易日")
    max_date: Date = Field(..., description="資料庫中最新交易日")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "symbol": "2330",
                "min_date": "2024-01-02",
                "max_date": "2026-05-20",
            }
        }
    )


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

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "symbol": "2330",
                "start_date": "2026-05-01",
                "end_date": "2026-05-20",
                "highest_price": "930.00",
                "lowest_price": "895.00",
                "average_close": "912.35",
                "total_volume": 412000000,
                "total_amount": 376120000000,
                "trading_days": 14,
            }
        }
    )


# 歷史價格列表 Schema
class HistoricalPriceList(TotalSymbolDateRangeResponseBase):
    data: List[DailyPriceResponse]

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "symbol": "2330",
                "start_date": "2026-05-01",
                "end_date": "2026-05-20",
                "total": 2,
                "data": [
                    {
                        "date": "2026-05-19",
                        "symbol": "2330",
                        "open": "910.00",
                        "high": "918.00",
                        "low": "905.00",
                        "close": "915.00",
                        "volume_shares": 28700000,
                        "amount": 26260500000,
                        "change": "3.00",
                        "trades": 16500,
                    },
                    {
                        "date": "2026-05-20",
                        "symbol": "2330",
                        "open": "915.00",
                        "high": "925.00",
                        "low": "910.00",
                        "close": "920.00",
                        "volume_shares": 32100000,
                        "amount": 29532000000,
                        "change": "5.00",
                        "trades": 18750,
                    },
                ],
            }
        }
    )


# K線圖數據列表 Schema
class CandlestickResponse(TotalSymbolDateRangeResponseBase):
    data: List[CandlestickData]


# 多股票比較 Schema
class MultiStockData(BaseModel):
    date: str = Field(..., description="交易日期（YYYY-MM-DD）")
    prices: dict[str, Optional[float]] = Field(..., description="各股票收盤價；無交易資料時為 null")


class MultiStockResponse(BaseModel):
    start_date: Date = Field(..., description="查詢開始日期")
    end_date: Date = Field(..., description="查詢結束日期")
    symbols: List[str] = Field(..., description="比較股票代號")
    data: List[MultiStockData] = Field(..., description="依日期排列的比較資料")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "start_date": "2026-05-01",
                "end_date": "2026-05-20",
                "symbols": ["2330", "2317"],
                "data": [
                    {
                        "date": "2026-05-20",
                        "prices": {
                            "2330": 920.0,
                            "2317": 168.5,
                        },
                    }
                ],
            }
        }
    )


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
    moving_averages: dict = Field(..., description="移動平均線資料，例如 MA5、MA10、MA20")


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
    price_volume: List[dict] = Field(..., description="價量資料，包含日期、收盤價、成交量、成交金額與漲跌")
    institutional_trades: List[dict] = Field(..., description="三大法人買賣超資料")
    volume_with_chips: List[ChipsVolumeData]
    technical_indicators: List[dict] = Field(..., description="技術指標資料，包含均線、RSI、KD、MACD 等")
