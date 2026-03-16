from sqlalchemy import Column, BigInteger, String, DateTime, Text, Index, UniqueConstraint

from database import Base


class CnyesTWStockNews(Base):
    """
    對應資料表 `cnyes_tw_stock_news`
    """

    __tablename__ = "cnyes_tw_stock_news"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    news_id = Column(BigInteger, nullable=False, index=True, comment="來源新聞編號（唯一）")
    title = Column(String(500), nullable=False, comment="新聞標題")
    content = Column(Text, nullable=True, comment="新聞內文")
    related_stocks = Column(String(500), nullable=True, comment="關聯股票（逗號分隔）")
    publish_time = Column(DateTime, nullable=True, index=True, comment="發布時間")
    url = Column(String(1000), nullable=True, comment="原始新聞網址")
    created_at = Column(
        DateTime,
        nullable=False,
        comment="建立時間（由資料庫預設 CURRENT_TIMESTAMP）",
    )
    updated_at = Column(
        DateTime,
        nullable=False,
        comment="更新時間（由資料庫預設 CURRENT_TIMESTAMP ON UPDATE）",
    )

    __table_args__ = (
        UniqueConstraint("news_id", name="uk_news_id"),
        Index("idx_publish_time", "publish_time"),
    )

    def __repr__(self) -> str:
        return f"<CnyesTWStockNews(id={self.id}, news_id={self.news_id}, title={self.title!r})>"

