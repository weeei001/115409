from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    Date,
    DateTime,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.mysql import MEDIUMTEXT

from database import Base


_ID_TYPE = BigInteger().with_variant(Integer, "sqlite")
_MEDIUM_TEXT = Text().with_variant(MEDIUMTEXT(), "mysql")

# kind 欄位可用值：/ai 情境推演移除後只剩文字簡報一條產線。
# 欄位本身保留，之後要再開第二條產線時直接加常數即可。
LLM_RESPONSE_KIND_TEXT_BRIEF = "text_brief"


class LlmResponse(Base):
    """個股 AI 分析的 LLM 回覆存檔。

    一列 = 一次 LLM 呼叫，同時擔任兩個角色：
    1. 快取：同一檔 + 同一基準日 + 同一 config_hash + 同一 kind 直接重播 `response_json`。
    2. 稽核：`raw_llm_text` / `normalized_json` 留下模型原始輸出與正規化結果，
       合規攔截或解析失敗時可還原「模型當時到底說了什麼」。
    """

    __tablename__ = "llm_responses"

    id = Column(_ID_TYPE, primary_key=True, autoincrement=True)
    symbol = Column(String(10), nullable=False)
    as_of_date = Column(Date, nullable=False)
    kind = Column(String(24), nullable=False)
    config_hash = Column(String(64), nullable=False)
    config_json = Column(Text, nullable=False)
    model_name = Column(String(128), nullable=True)
    is_fallback = Column(Boolean, nullable=False, default=False)
    news_count = Column(Integer, nullable=False, default=0)
    summary = Column(Text, nullable=True)
    raw_llm_text = Column(_MEDIUM_TEXT, nullable=True)
    # 正規化後的 payload；合規攔截時存的是被擋下來的原始內容，不會出現在 response_json。
    normalized_json = Column(_MEDIUM_TEXT, nullable=True)
    # 對外回應全文，供快取重播。
    response_json = Column(_MEDIUM_TEXT, nullable=True)
    latency_ms = Column(Integer, nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        Index("idx_llmr_lookup", "symbol", "as_of_date", "kind", "config_hash"),
        Index("idx_llmr_created", "created_at"),
    )
