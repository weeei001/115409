from typing import List, Optional

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    symbols: List[str] = Field(..., description="股票代號，例如 ['2330']")
    with_news: bool = Field(True, description="是否包含新聞分析")


class InstitutionalRow(BaseModel):
    date: str = Field(..., description="交易日期")
    foreign_net: int = Field(0, description="外資淨買超（股）")
    trust_net: int = Field(0, description="投信淨買超（股）")
    dealer_net: int = Field(0, description="自營商淨買超（股）")
    total_net: int = Field(0, description="三大法人合計淨買超（股）")


class NewsSourceItem(BaseModel):
    id: str
    title: str
    summary: str = ""
    timestamp: str = ""
    url: Optional[str] = None


class ChatResponse(BaseModel):
    symbol: str = Field("", description="Parser 解析出的股票代號")
    date_start: str = Field("", description="Parser 解析出的起始日期 (YYYY-MM-DD)")
    date_end: str = Field("", description="Parser 解析出的結束日期 (YYYY-MM-DD)")
    focus: str = Field("general", description="查詢焦點 (technical/institutional/news/general)")
    summary: str = Field("", description="總結摘要")
    sentiment_score: float = Field(0.0, description="情緒分值 -1 ~ 1")
    technical_highlights: List[str] = Field(default_factory=list, description="技術指標重點")
    institutional_data: List[InstitutionalRow] = Field(default_factory=list, description="三大法人資訊")
    recommendation: str = Field("", description="最終建議")
    recommendation_basis: List[str] = Field(default_factory=list, description="建議依據")
    news_sources: List[NewsSourceItem] = Field(default_factory=list, description="資料來源")
    fallback_mode: bool = Field(False, description="是否為純數據模式")
    raw_answer: str = Field("", description="完整文字回覆")
