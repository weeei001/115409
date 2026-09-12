from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class SimulationRequest(BaseModel):
    symbol: str = Field(default="2330", pattern=r"^[0-9A-Za-z]{1,10}$")
    start: date = date(2025, 1, 1)
    end: date = date(2026, 9, 3)
    initial_cash: Decimal = Field(default=Decimal("1000000"), ge=10000, le=100000000,
                                 decimal_places=2, allow_inf_nan=False)
    confidence: int = Field(default=5, ge=1, le=10)

    @model_validator(mode="after")
    def ordered_dates(self):
        if self.start >= self.end:
            raise ValueError("start must be earlier than end")
        return self


class Decision(BaseModel):
    action: Literal["buy", "sell", "hold"]
    buy_pct: float = Field(ge=0, le=1, allow_inf_nan=False)
    sell_pct: float = Field(ge=0, le=1, allow_inf_nan=False)
    reason: str = Field(min_length=1, max_length=2000)
