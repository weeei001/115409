from datetime import date, datetime
from typing import List, Literal, Optional
import re

from pydantic import BaseModel, Field, field_validator, model_validator


OrderSide = Literal["buy", "sell"]
SellPlan = Optional[Literal["long_term", "by_date"]]


class SimulatedOrderBase(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=128, description="使用者識別（前端匿名 user id）")
    symbol: str = Field(..., min_length=1, max_length=12, description="股票代號")
    side: OrderSide = Field(..., description="買賣方向")
    quantity: int = Field(..., gt=0, description="委託數量（張）")
    sell_plan: SellPlan = Field(
        default=None,
        description="僅買進：長期持有或指定預計賣出日；賣出單應為 null（無預計賣出計畫）",
    )
    planned_sell_date: Optional[date] = Field(
        None,
        description="預計賣出日（僅買進且 sell_plan=by_date 時必填）",
    )


class SimulatedOrderCreate(SimulatedOrderBase):
    trade_date: Optional[date] = Field(None, description="模擬下單日期（可指定過去日期）")

    @field_validator("user_id")
    @classmethod
    def validate_user_id(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("user_id 不可為空")
        return normalized

    @field_validator("symbol")
    @classmethod
    def validate_symbol(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not re.fullmatch(r"[0-9A-Z.]+", normalized):
            raise ValueError("symbol 格式不正確")
        return normalized

    @model_validator(mode="before")
    @classmethod
    def normalize_sell_order_fields(cls, data: object) -> object:
        """賣出單無賣出計畫：sell_plan / planned_sell_date 皆為 null。"""
        if not isinstance(data, dict):
            return data
        d = dict(data)
        if d.get("side") == "sell":
            d["sell_plan"] = None
            d["planned_sell_date"] = None
            return d
        if d.get("side") == "buy" and d.get("sell_plan") is None:
            d["sell_plan"] = "long_term"
        return d

    @model_validator(mode="after")
    def validate_simulated_order(self) -> "SimulatedOrderCreate":
        if self.trade_date is not None and self.trade_date > date.today():
            raise ValueError("trade_date 不可晚於今天")
        if self.side == "sell":
            if self.sell_plan is not None or self.planned_sell_date is not None:
                raise ValueError("賣出單不可帶 sell_plan 或 planned_sell_date")
            return self
        effective_trade = self.trade_date or date.today()
        if self.sell_plan == "long_term":
            if self.planned_sell_date is not None:
                raise ValueError("長期持有時不可指定 planned_sell_date")
        else:
            if self.planned_sell_date is None:
                raise ValueError("指定賣出日時必須提供 planned_sell_date")
            if self.planned_sell_date < effective_trade:
                raise ValueError("預計賣出日不可早於模擬下單日")
        return self


class SimulatedOrderResponse(SimulatedOrderBase):
    id: str = Field(..., description="委託編號")
    trade_date: date = Field(..., description="模擬下單日期")
    status: Literal["pending", "filled", "cancelled"] = Field(..., description="委託狀態")
    estimated_amount: int = Field(..., description="預估成交金額（元）")
    markup_basis: Optional[Literal["latest", "planned_sell", "fifo_realized"]] = Field(
        None,
        description="試算依據：latest=最新收盤；planned_sell=預計賣出日（含以前最近交易日）收盤；fifo_realized=賣出單依下單日成交金額減 FIFO 配對之買進成本（實現損益）",
    )
    reference_date: Optional[date] = Field(None, description="參考收盤所屬交易日（賣出單為模擬賣出日）")
    reference_close: Optional[float] = Field(None, description="參考收盤價（賣出單為賣出日成交價）")
    markup_amount: Optional[int] = Field(
        None,
        description="試算損益金額（元）；買進為市值−成本；賣出為實現損益（賣出金額−配對買進成本）",
    )
    markup_rate: Optional[float] = Field(
        None,
        description="試算收益率（%；買進以預估成交金額為分母；賣出以 FIFO 配對買進成本為分母）",
    )
    created_at: datetime = Field(..., description="建立時間")


class SimulatedOrderListResponse(BaseModel):
    user_id: str
    total: int
    data: List[SimulatedOrderResponse]


class AvailableLotsResponse(BaseModel):
    user_id: str = Field(..., description="使用者識別")
    symbol: str = Field(..., description="股票代號")
    available_lots: int = Field(..., description="依委託推算之可賣張數（by_date 已過預計賣出日者不計入持倉）")


class SimulatedOrderCategoryProfitItem(BaseModel):
    category: str = Field(..., description="股票代號（依個股彙總，非產業分類）")
    order_count: int = Field(..., description="該股票委託筆數")
    symbols: List[str] = Field(..., description="涉及股票代號（與 category 一致，供相容用）")
    cost_amount: int = Field(..., description="成本金額（元）")
    market_amount: int = Field(..., description="最新估值金額（元）")
    profit_amount: int = Field(..., description="收益金額（元）")
    profit_rate: float = Field(..., description="收益率（%）")


class SimulatedOrderCategoryProfitResponse(BaseModel):
    user_id: str = Field(..., max_length=128, description="使用者識別（前端匿名 user id）")
    total_orders: int = Field(..., description="總委託筆數")
    priced_orders: int = Field(..., description="可估值委託筆數")
    unpriced_orders: int = Field(..., description="無最新行情委託筆數")
    data: List[SimulatedOrderCategoryProfitItem] = Field(default_factory=list, description="依股票代號彙總之收益統計")
