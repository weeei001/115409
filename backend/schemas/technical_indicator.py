from datetime import date as Date
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


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
    model_config = ConfigDict(
        from_attributes=True,
        json_schema_extra={
            "example": {
                "date": "2026-05-20",
                "symbol": "2330",
                "close": "920.00",
                "ma5": "912.40",
                "ma10": "905.10",
                "ma20": "898.30",
                "ma60": "875.20",
                "ma120": "850.75",
                "ma240": "810.55",
                "rsi5": "62.50",
                "rsi10": "58.30",
                "rsv9": "71.20",
                "kd_k9": "65.10",
                "kd_d9": "60.80",
                "kd_j9": "73.70",
                "ema12": "908.90",
                "ema26": "895.40",
                "macd_dif": "13.50",
                "macd_dea": "10.20",
                "macd_signal": "3.30",
                "macd_hist": "6.60",
                "boll_mid20": "898.30",
                "boll_upper20": "940.20",
                "boll_lower20": "856.40",
                "volume_ma5": "30200000.00",
            }
        },
    )


class TechnicalIndicatorListResponse(BaseModel):
    symbol: str = Field(..., description="股票代號")
    start_date: Date = Field(..., description="查詢開始日期")
    end_date: Date = Field(..., description="查詢結束日期")
    total: int = Field(..., description="資料筆數")
    data: List[TechnicalIndicatorResponse] = Field(..., description="技術指標列表")
