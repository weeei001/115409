from datetime import date, datetime
from decimal import Decimal
from typing import List, Literal, Optional
import re

from pydantic import BaseModel, Field, field_validator, model_validator


class SimulatedOrderCreate(BaseModel):
    session_id: str = Field(..., min_length=1, max_length=36, description="前端匿名會話ID")
    symbol: str = Field(..., min_length=1, max_length=12, description="股票代號")
    side: Literal["buy", "sell"] = Field(..., description="買賣方向")
    order_type: Literal["market", "limit"] = Field(..., description="委託類型（目前僅支援 market）")
    price: Optional[Decimal] = Field(None, gt=0, description="限價委託價格")
    trade_date: Optional[date] = Field(None, description="模擬下單日期（可指定過去日期）")
    quantity: int = Field(..., gt=0, description="委託數量（張）")

    @field_validator("session_id")
    @classmethod
    def validate_session_id(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("session_id 不可為空")
        return normalized

    @field_validator("symbol")
    @classmethod
    def validate_symbol(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not re.fullmatch(r"[0-9A-Z.]+", normalized):
            raise ValueError("symbol 格式不正確")
        return normalized

    @model_validator(mode="after")
    def validate_price_by_order_type(self) -> "SimulatedOrderCreate":
        if self.order_type != "market":
            raise ValueError("目前僅支援市價（market）模擬")
        if self.order_type == "limit" and self.price is None:
            raise ValueError("limit 單必須提供 price")
        if self.order_type == "market" and self.price is not None:
            raise ValueError("market 單不可提供 price")
        if self.trade_date is not None and self.trade_date > date.today():
            raise ValueError("trade_date 不可晚於今天")
        return self


class SimulatedOrderResponse(BaseModel):
    id: str = Field(..., description="委託編號")
    session_id: str = Field(..., description="前端匿名會話ID")
    symbol: str = Field(..., description="股票代號")
    side: Literal["buy", "sell"] = Field(..., description="買賣方向")
    order_type: Literal["market", "limit"] = Field(..., description="委託類型")
    price: Optional[Decimal] = Field(None, description="限價價格")
    trade_date: date = Field(..., description="模擬下單日期")
    quantity: int = Field(..., description="委託數量（張）")
    status: Literal["pending", "filled", "cancelled"] = Field(..., description="委託狀態")
    estimated_amount: int = Field(..., description="預估成交金額（元）")
    created_at: datetime = Field(..., description="建立時間")


class SimulatedOrderListResponse(BaseModel):
    session_id: str
    total: int
    data: List[SimulatedOrderResponse]


class SimulatedOrderCategoryProfitItem(BaseModel):
    category: str = Field(..., description="股票代號（依個股彙總，非產業分類）")
    order_count: int = Field(..., description="該股票委託筆數")
    symbols: List[str] = Field(..., description="涉及股票代號（與 category 一致，供相容用）")
    cost_amount: int = Field(..., description="成本金額（元）")
    market_amount: int = Field(..., description="最新估值金額（元）")
    profit_amount: int = Field(..., description="收益金額（元）")
    profit_rate: float = Field(..., description="收益率（%）")


class SimulatedOrderCategoryProfitResponse(BaseModel):
    session_id: str = Field(..., description="前端匿名會話ID")
    total_orders: int = Field(..., description="總委託筆數")
    priced_orders: int = Field(..., description="可估值委託筆數")
    unpriced_orders: int = Field(..., description="無最新行情委託筆數")
    data: List[SimulatedOrderCategoryProfitItem] = Field(default_factory=list, description="依股票代號彙總之收益統計")
