from decimal import Decimal
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class OrderCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    client_request_id: str = Field(min_length=1, max_length=128)
    symbol: str = Field(pattern=r'^[A-Za-z0-9]{1,10}$')
    side: Literal['buy', 'sell']
    budget: Decimal | None = Field(default=None, gt=0, le=1000000000, decimal_places=2)
    quantity: int | None = Field(default=None, gt=0, le=1000000000, strict=True)
    reason: str = Field(default='', max_length=4000)
    observation: str = Field(default='', max_length=4000)
    review_after_days: int = Field(default=20, ge=1, le=250)
    conversation_id: str | None = Field(default=None, max_length=36)

    @model_validator(mode='after')
    def validate_side(self):
        if self.side == 'buy' and (self.budget is None or self.quantity is not None):
            raise ValueError('Buy orders require budget only')
        if self.side == 'sell' and (self.quantity is None or self.budget is not None):
            raise ValueError('Sell orders require quantity only')
        return self
