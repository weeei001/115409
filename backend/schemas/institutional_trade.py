from datetime import date as Date, datetime
from typing import List, Optional

from pydantic import BaseModel, Field


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
    class Config:
        from_attributes = True


class InstitutionalTradeListResponse(BaseModel):
    symbol: str
    start_date: Date
    end_date: Date
    total: int
    data: List[InstitutionalTradeResponse]
