from typing import Annotated

from fastapi import APIRouter, Path

from app.features.auth.router import CurrentUser, Database
from app.features.favorites import service
from app.features.favorites.schemas import FavoriteStockListResponse, FavoriteStockResponse


router = APIRouter(prefix="/favorites", tags=["收藏股"])
# Matches stock_info.symbol String(10).
Symbol = Annotated[str, Path(max_length=10)]


@router.get("/", response_model=FavoriteStockListResponse, responses={401: {}, 403: {}})
def list_favorites(user: CurrentUser, db: Database):
    return service.list_favorites(db, user)


@router.put("/{symbol}", response_model=FavoriteStockResponse, responses={401: {}, 403: {}, 404: {}, 422: {}})
def add_favorite(symbol: Symbol, user: CurrentUser, db: Database):
    return service.add_favorite(db, user, symbol)


@router.delete("/{symbol}", status_code=204, responses={401: {}, 403: {}, 422: {}})
def remove_favorite(symbol: Symbol, user: CurrentUser, db: Database):
    service.remove_favorite(db, user, symbol)
