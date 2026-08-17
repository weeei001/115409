from sqlalchemy import Column, DateTime, Index, String, Text, func
from sqlalchemy.dialects.mysql import LONGTEXT

from database import Base


_LONG_TEXT = Text().with_variant(LONGTEXT(), "mysql")


class NewsArticle(Base):
    """
    對應資料表 `news_articles`

    一列 = 一篇新聞。`article_id` 為 md5(f"{source}_{title}_{pub_time}")，
    由各來源爬蟲產生，同一篇文章重複抓取時不會重複寫入。
    """

    __tablename__ = "news_articles"

    article_id = Column(String(64), primary_key=True, comment="文章唯一識別碼 md5(source_title_pub_time)")
    source = Column(String(50), nullable=True, index=True, comment="新聞來源（cnyes / ltn / udn ...）")
    source_group = Column(String(50), nullable=True, comment="來源分組（媒體站台或 cmoney）")
    stock_id = Column(String(20), nullable=True, index=True, comment="主要關聯股票代號")
    title = Column(Text, nullable=True, comment="新聞標題")
    pub_time = Column(
        String(40),
        nullable=True,
        index=True,
        comment="發布時間字串（ISO8601 或 YYYY-MM-DD HH:MM:SS）",
    )
    url = Column(Text, nullable=True, comment="原始新聞網址")
    tags = Column(Text, nullable=True, comment="標籤／其他關聯股票（逗號分隔）")
    content = Column(_LONG_TEXT, nullable=True, comment="新聞內文")
    created_at = Column(
        DateTime,
        nullable=True,
        server_default=func.current_timestamp(),
        comment="建立時間（由資料庫預設 CURRENT_TIMESTAMP）",
    )

    __table_args__ = (
        Index("idx_stock_id", "stock_id"),
        Index("idx_pub_time", "pub_time"),
        Index("idx_source", "source"),
    )

    def __repr__(self) -> str:
        return f"<NewsArticle(article_id={self.article_id!r}, stock_id={self.stock_id!r}, title={self.title!r})>"
