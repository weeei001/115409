from datetime import datetime, timezone

from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.errors import NotFound
from app.db.models.favorite_stock import FavoriteStock
from app.db.models.user import User
from app.features.favorites import repository
from app.features.favorites.schemas import FavoriteStockListResponse, FavoriteStockResponse


def normalize_symbol(symbol: str) -> str:
    return symbol.strip().upper()


def _commit(db: Session) -> None:
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise


def list_favorites(db: Session, user: User) -> FavoriteStockListResponse:
    rows = repository.favorites(db, user.id)
    return FavoriteStockListResponse(items=[
        FavoriteStockResponse(symbol=row.symbol, name=row.name, created_at=row.created_at) for row in rows
    ])


def add_favorite(db: Session, user: User, symbol: str) -> FavoriteStockResponse:
    user_id, symbol = user.id, normalize_symbol(symbol)
    stock = repository.stock(db, symbol)
    if stock is None:
        raise NotFound(f"找不到股票 {symbol}")
    name = stock.name
    favorite = repository.favorite(db, user_id, symbol)
    if favorite is None:
        favorite = FavoriteStock(user_id=user_id, symbol=symbol,
                                 created_at=datetime.now(timezone.utc).replace(tzinfo=None))
        db.add(favorite)
        try:
            _commit(db)
        except IntegrityError:
            # A concurrent request stored the same pair first; PUT stays idempotent.
            favorite = repository.favorite(db, user_id, symbol)
            if favorite is None:
                raise
        else:
            db.refresh(favorite)
    return FavoriteStockResponse(symbol=symbol, name=name, created_at=favorite.created_at)


def remove_favorite(db: Session, user: User, symbol: str) -> None:
    repository.delete_favorite(db, user.id, normalize_symbol(symbol))
    _commit(db)
