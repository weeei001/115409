from sqlalchemy import Column, DateTime, Float, Index, Integer, String, Text, func
from sqlalchemy.dialects.mysql import LONGTEXT

from database import Base

_LONG_TEXT = Text().with_variant(LONGTEXT(), "mysql")


class NewsSentiment(Base):
    """
    對應資料表 `news_sentiments`
    儲存新聞對目標公司的情緒分類結果。
    複合主鍵為 (article_id, target_stock_id)。
    """

    __tablename__ = "news_sentiments"

    article_id = Column(
        String(64),
        primary_key=True,
        comment="文章唯一識別碼（關聯 news_articles.article_id）",
    )
    target_stock_id = Column(
        String(20),
        primary_key=True,
        comment="目標股票代號（例如 2330）",
    )
    input_hash = Column(
        String(64),
        nullable=False,
        index=True,
        comment="正規化標題、內文、發布時間、目標代號與名稱之 SHA-256",
    )
    config_hash = Column(
        String(64),
        nullable=False,
        index=True,
        comment="模型、Prompt、Schema、正規化規則與參數之 SHA-256",
    )
    status = Column(
        String(20),
        nullable=False,
        index=True,
        default="success",
        comment="狀態：success, failed, skipped",
    )
    label = Column(
        String(20),
        nullable=True,
        comment="情緒標籤：positive, negative, neutral, mixed, insufficient",
    )
    reason = Column(
        String(255),
        nullable=True,
        comment="簡短理由（1~80 字元）",
    )
    evidence = Column(
        _LONG_TEXT,
        nullable=True,
        comment="原文依據引用 JSON（[{\"field\": \"title\"|\"content\", \"quote\": \"...\"}]）",
    )
    model = Column(
        String(50),
        nullable=True,
        comment="使用的 LLM 模型名稱",
    )
    prompt_version = Column(
        String(20),
        nullable=True,
        comment="使用的 Prompt 版本",
    )
    input_tokens = Column(
        Integer,
        nullable=True,
        comment="輸入 Token 數",
    )
    output_tokens = Column(
        Integer,
        nullable=True,
        comment="輸出 Token 數",
    )
    reasoning_tokens = Column(
        Integer,
        nullable=True,
        comment="推理 Token 數（若有）",
    )
    estimated_cost_usd = Column(
        Float,
        nullable=True,
        comment="估算美元成本",
    )
    analyzed_at = Column(
        DateTime,
        nullable=True,
        comment="分析完成時間",
    )
    error_code = Column(
        String(255),
        nullable=True,
        comment="錯誤碼（失敗或跳過時）",
    )
    created_at = Column(
        DateTime,
        nullable=True,
        server_default=func.current_timestamp(),
        comment="記錄建立時間",
    )
    updated_at = Column(
        DateTime,
        nullable=True,
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
        comment="記錄更新時間",
    )

    __table_args__ = (
        Index("idx_sentiment_input_config", "input_hash", "config_hash"),
        Index("idx_sentiment_lookup", "target_stock_id", "status"),
    )

    def __repr__(self) -> str:
        return (
            f"<NewsSentiment(article_id={self.article_id!r}, "
            f"target_stock_id={self.target_stock_id!r}, "
            f"label={self.label!r}, status={self.status!r})>"
        )
