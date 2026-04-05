from datetime import date as Date, datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class InstitutionalTradeBase(BaseModel):
    date: Date = Field(..., description="交易日期")
    symbol: str = Field(..., description="證券代號")
    stock_name: Optional[str] = Field(None, description="證券名稱")

    foreign_excl_dealer_buy: Optional[int] = Field(None, description="外陸資買進股數(不含外資自營商)")
    foreign_excl_dealer_sell: Optional[int] = Field(None, description="外陸資賣出股數(不含外資自營商)")
    foreign_excl_dealer_net: Optional[int] = Field(None, description="外陸資買賣超股數(不含外資自營商)")
    foreign_dealer_buy: Optional[int] = Field(None, description="外資自營商買進股數")
    foreign_dealer_sell: Optional[int] = Field(None, description="外資自營商賣出股數")
    foreign_dealer_net: Optional[int] = Field(None, description="外資自營商買賣超股數")

    investment_trust_buy: Optional[int] = Field(None, description="投信買進股數")
    investment_trust_sell: Optional[int] = Field(None, description="投信賣出股數")
    investment_trust_net: Optional[int] = Field(None, description="投信買賣超股數")

    dealer_net_total: Optional[int] = Field(None, description="自營商買賣超股數")
    dealer_self_buy: Optional[int] = Field(None, description="自營商買進股數(自行買賣)")
    dealer_self_sell: Optional[int] = Field(None, description="自營商賣出股數(自行買賣)")
    dealer_self_net: Optional[int] = Field(None, description="自營商買賣超股數(自行買賣)")
    dealer_hedge_buy: Optional[int] = Field(None, description="自營商買進股數(避險)")
    dealer_hedge_sell: Optional[int] = Field(None, description="自營商賣出股數(避險)")
    dealer_hedge_net: Optional[int] = Field(None, description="自營商買賣超股數(避險)")

    total_net: Optional[int] = Field(None, description="三大法人買賣超股數")


class InstitutionalTradeResponse(InstitutionalTradeBase):
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class InstitutionalTradeListResponse(BaseModel):
    symbol: str
    start_date: Date
    end_date: Date
    total: int
    data: List[InstitutionalTradeResponse]
