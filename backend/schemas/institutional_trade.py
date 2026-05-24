from datetime import date as Date, datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


class InstitutionalTradeBase(BaseModel):
    date: Date = Field(..., description="交易日期")
    symbol: str = Field(..., description="證券代號")
    foreign_buy: Optional[int] = Field(None, description="外資買進股數")
    foreign_sell: Optional[int] = Field(None, description="外資賣出股數")
    foreign_net: Optional[int] = Field(None, description="外資買賣超股數")

    investment_trust_buy: Optional[int] = Field(None, description="投信買進股數")
    investment_trust_sell: Optional[int] = Field(None, description="投信賣出股數")
    investment_trust_net: Optional[int] = Field(None, description="投信買賣超股數")

    dealer_buy: Optional[int] = Field(None, description="自營商買進股數")
    dealer_sell: Optional[int] = Field(None, description="自營商賣出股數")
    dealer_net: Optional[int] = Field(None, description="自營商買賣超股數")

    total_institutional_buy: Optional[int] = Field(None, description="三大法人買進股數")
    total_institutional_sell: Optional[int] = Field(None, description="三大法人賣出股數")
    total_institutional_net: Optional[int] = Field(None, description="三大法人買賣超股數")


class InstitutionalTradeResponse(InstitutionalTradeBase):
    model_config = ConfigDict(
        from_attributes=True,
        json_schema_extra={
            "example": {
                "date": "2026-05-20",
                "symbol": "2330",
                "foreign_buy": 12000000,
                "foreign_sell": 9500000,
                "foreign_net": 2500000,
                "investment_trust_buy": 1800000,
                "investment_trust_sell": 900000,
                "investment_trust_net": 900000,
                "dealer_buy": 700000,
                "dealer_sell": 1000000,
                "dealer_net": -300000,
                "total_institutional_buy": 14500000,
                "total_institutional_sell": 11400000,
                "total_institutional_net": 3100000,
            }
        },
    )


class InstitutionalTradeListResponse(BaseModel):
    symbol: str = Field(..., description="股票代號")
    start_date: Date = Field(..., description="查詢開始日期")
    end_date: Date = Field(..., description="查詢結束日期")
    total: int = Field(..., description="資料筆數")
    data: List[InstitutionalTradeResponse] = Field(..., description="三大法人買賣超列表")
