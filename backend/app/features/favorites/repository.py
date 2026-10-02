from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db.models.favorite_stock import FavoriteStock
from app.db.models.stock_info import StockInfo


def stock(db: Session, symbol: str) -> StockInfo | None:
    return db.get(StockInfo, symbol)


def favorite(db: Session, user_id: int, symbol: str) -> FavoriteStock | None:
    return db.scalar(select(FavoriteStock).where(FavoriteStock.user_id == user_id, FavoriteStock.symbol == symbol))


def favorites(db: Session, user_id: int):
    # created_at has second precision; id breaks ties so the newest insert still comes first.
    return db.execute(
        select(FavoriteStock.symbol, StockInfo.name, FavoriteStock.created_at)
        .join(StockInfo, StockInfo.symbol == FavoriteStock.symbol)
        .where(FavoriteStock.user_id == user_id)
        .order_by(FavoriteStock.created_at.desc(), FavoriteStock.id.desc())
    ).all()


def delete_favorite(db: Session, user_id: int, symbol: str) -> None:
    db.execute(delete(FavoriteStock).where(FavoriteStock.user_id == user_id, FavoriteStock.symbol == symbol))
