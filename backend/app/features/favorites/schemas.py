from datetime import datetime

from pydantic import BaseModel


class FavoriteStockResponse(BaseModel):
    symbol: str
    name: str
    created_at: datetime


class FavoriteStockListResponse(BaseModel):
    items: list[FavoriteStockResponse]
