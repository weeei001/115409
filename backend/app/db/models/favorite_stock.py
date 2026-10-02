from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, func

from app.db.base import Base


class FavoriteStock(Base):
    __tablename__ = "favorite_stocks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    symbol = Column(String(10), nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "symbol", name="uq_favorite_user_symbol"),
        # SQLite index names are database-wide, so this cannot reuse simulated_orders' idx_user_created.
        Index("idx_favorite_user_created", "user_id", "created_at"),
    )

    def __repr__(self) -> str:
        return f"<FavoriteStock(user_id={self.user_id}, symbol='{self.symbol}')>"
