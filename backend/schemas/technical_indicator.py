from datetime import date as Date
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, Field


class TechnicalIndicatorBase(BaseModel):
    date: Date = Field(..., description="日期")
    symbol: str = Field(..., description="股票代號")
    close: Optional[Decimal] = Field(None, description="收盤價")
    ma5: Optional[Decimal] = Field(None, description="5日均線")
    ma10: Optional[Decimal] = Field(None, description="10日均線")
    ma20: Optional[Decimal] = Field(None, description="20日均線")
    ma60: Optional[Decimal] = Field(None, description="60日均線")
    ma120: Optional[Decimal] = Field(None, description="120日均線")
    ma240: Optional[Decimal] = Field(None, description="240日均線")
    rsi5: Optional[Decimal] = Field(None, description="5日RSI")
    rsi10: Optional[Decimal] = Field(None, description="10日RSI")
    rsv9: Optional[Decimal] = Field(None, description="9日RSV")
    kd_k9: Optional[Decimal] = Field(None, description="KD K值")
    kd_d9: Optional[Decimal] = Field(None, description="KD D值")
    kd_j9: Optional[Decimal] = Field(None, description="KD J值")
    ema12: Optional[Decimal] = Field(None, description="12日EMA")
    ema26: Optional[Decimal] = Field(None, description="26日EMA")
    macd_dif: Optional[Decimal] = Field(None, description="MACD DIF")
    macd_dea: Optional[Decimal] = Field(None, description="MACD DEA")
    macd_signal: Optional[Decimal] = Field(None, description="MACD訊號線")
    macd_hist: Optional[Decimal] = Field(None, description="MACD柱狀圖")
    boll_mid20: Optional[Decimal] = Field(None, description="20日布林中軌")
    boll_upper20: Optional[Decimal] = Field(None, description="20日布林上軌")
    boll_lower20: Optional[Decimal] = Field(None, description="20日布林下軌")
    volume_ma5: Optional[Decimal] = Field(None, description="5日均量")


class TechnicalIndicatorResponse(TechnicalIndicatorBase):
    class Config:
        from_attributes = True


class TechnicalIndicatorListResponse(BaseModel):
    symbol: str
    start_date: Date
    end_date: Date
    total: int
    data: List[TechnicalIndicatorResponse]
