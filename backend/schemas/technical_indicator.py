from datetime import date as Date
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, Field


class TechnicalIndicatorBase(BaseModel):
    date: Date = Field(..., description="日期")
    symbol: str = Field(..., description="股票代號")
    ma5: Optional[Decimal] = Field(None, description="5日均線")
    ma10: Optional[Decimal] = Field(None, description="10日均線")
    ma20: Optional[Decimal] = Field(None, description="20日均線")
    ma60: Optional[Decimal] = Field(None, description="60日均線")
    k_value: Optional[Decimal] = Field(None, description="KD K值")
    d_value: Optional[Decimal] = Field(None, description="KD D值")
    rsi14: Optional[Decimal] = Field(None, description="14日RSI")
    macd: Optional[Decimal] = Field(None, description="MACD")
    macd_signal: Optional[Decimal] = Field(None, description="MACD訊號線")
    macd_hist: Optional[Decimal] = Field(None, description="MACD柱狀圖")
    bb_upper: Optional[Decimal] = Field(None, description="布林上軌")
    bb_middle: Optional[Decimal] = Field(None, description="布林中軌")
    bb_lower: Optional[Decimal] = Field(None, description="布林下軌")
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
