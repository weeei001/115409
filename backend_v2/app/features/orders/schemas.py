import re
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class SimulatedOrderBase(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=128)
    symbol: str = Field(..., min_length=1, max_length=12)
    side: Literal["buy", "sell"]
    quantity: int = Field(..., gt=0)
    sell_plan: Literal["long_term", "by_date"] | None = None
    planned_sell_date: date | None = None


class SimulatedOrderCreate(SimulatedOrderBase):
    trade_date: date | None = None

    @field_validator("user_id")
    @classmethod
    def validate_user_id(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("user_id 不可為空")
        return value

    @field_validator("symbol")
    @classmethod
    def validate_symbol(cls, value: str) -> str:
        value = value.strip().upper()
        if not re.fullmatch(r"[0-9A-Z.]+", value):
            raise ValueError("symbol 格式不正確")
        return value

    @model_validator(mode="before")
    @classmethod
    def normalize_sell_fields(cls, data: object) -> object:
        if not isinstance(data, dict):
            return data
        data = dict(data)
        if data.get("side") == "sell":
            data["sell_plan"] = None
            data["planned_sell_date"] = None
        elif data.get("side") == "buy" and data.get("sell_plan") is None:
            data["sell_plan"] = "long_term"
        return data

    @model_validator(mode="after")
    def validate_dates(self):
        if self.trade_date is not None and self.trade_date > date.today():
            raise ValueError("trade_date 不可晚於今天")
        if self.side == "buy":
            if self.sell_plan == "long_term":
                if self.planned_sell_date is not None:
                    raise ValueError("長期持有時不可指定 planned_sell_date")
            elif self.planned_sell_date is None:
                raise ValueError("指定賣出日時必須提供 planned_sell_date")
            elif self.planned_sell_date < (self.trade_date or date.today()):
                raise ValueError("預計賣出日不可早於模擬下單日")
        return self


class SimulatedOrderResponse(SimulatedOrderBase):
    id: str
    trade_date: date
    status: Literal["pending", "filled", "cancelled"]
    estimated_amount: int
    markup_basis: Literal["latest", "planned_sell", "fifo_realized"] | None = None
    reference_date: date | None = None
    reference_close: float | None = None
    markup_amount: int | None = None
    markup_rate: float | None = None
    created_at: datetime


class SimulatedOrderListResponse(BaseModel):
    user_id: str
    total: int
    data: list[SimulatedOrderResponse]


class AvailableLotsResponse(BaseModel):
    user_id: str
    symbol: str
    available_lots: int


class SimulatedOrderCategoryProfitItem(BaseModel):
    category: str
    order_count: int
    symbols: list[str]
    cost_amount: int
    market_amount: int
    profit_amount: int
    profit_rate: float


class SimulatedOrderCategoryProfitResponse(BaseModel):
    user_id: str = Field(..., max_length=128)
    total_orders: int
    priced_orders: int
    unpriced_orders: int
    data: list[SimulatedOrderCategoryProfitItem] = Field(default_factory=list)
