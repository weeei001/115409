from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class ChatRequest(BaseModel):
    """單次完整分析請求（對應 `POST /analyze`）。"""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "symbols": ["2330"],
                "with_news": True,
            }
        }
    )

    symbols: List[str] = Field(
        ...,
        description="股票代號列表；後端僅使用**第一個**有效代號（會轉大寫）。",
        examples=[["2330"], ["2330", "2454"]],
    )
    with_news: bool = Field(
        True,
        description="是否納入新聞／RAG 摘要；若後端新聞服務不可用仍可能回傳分析，但新聞欄位可能為空。",
    )


class InstitutionalRow(BaseModel):
    date: str = Field(..., description="交易日期")
    foreign_net: int = Field(0, description="外資淨買超（股）")
    trust_net: int = Field(0, description="投信淨買超（股）")
    dealer_net: int = Field(0, description="自營商淨買超（股）")
    total_net: int = Field(0, description="三大法人合計淨買超（股）")


class NewsSourceItem(BaseModel):
    id: str = Field(..., description="新聞項目 ID（後端內部或 RAG 來源）")
    title: str = Field(..., description="標題")
    summary: str = Field("", description="摘要或內文節錄")
    timestamp: str = Field("", description="發佈或取得時間（ISO 字串）")
    url: Optional[str] = Field(None, description="原文連結；無則 null")


AnalysisStatus = Literal["data_ready", "highlights_ready", "done"]


class ChatResponse(BaseModel):
    """`POST /analyze` 成功回應；兩階段：技術／籌碼分析 + 新聞綜合（synthesize）。"""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "symbol": "2330",
                "date_start": "2026-03-01",
                "date_end": "2026-04-01",
                "summary": "（摘要文字）",
                "sentiment_score": 0.15,
                "technical_highlights": ["（條列）"],
                "institutional_data": [],
                "recommendation": "中性觀望（理由請見全形括號內）",
                "news_sources": [],
                "fallback_mode": False,
                "raw_answer": "",
                "status": "done",
            }
        }
    )

    symbol: str = Field("", description="股票代號（大寫）")
    date_start: str = Field("", description="Parser 解析出的起始日期 (YYYY-MM-DD)")
    date_end: str = Field("", description="Parser 解析出的結束日期 (YYYY-MM-DD)")
    summary: str = Field("", description="總結摘要（技術＋籌碼＋新聞綜合）")
    sentiment_score: float = Field(
        0.0,
        description="多空情緒：-1（極空）～ 1（極多），0 為中性。",
    )
    technical_highlights: List[str] = Field(
        default_factory=list,
        description="技術／籌碼條列重點（字串陣列）。",
    )
    institutional_data: List[InstitutionalRow] = Field(
        default_factory=list,
        description="區間內三大法人買賣超列資料（依後端截取）。",
    )
    recommendation: str = Field(
        "",
        description="最終建議，格式為「偏多／偏空／中性觀望」＋全形括號內簡述理由",
    )
    news_sources: List[NewsSourceItem] = Field(
        default_factory=list,
        description="相關新聞來源列表（RAG／摘要）。",
    )
    fallback_mode: bool = Field(
        False,
        description="若為 true：LLM 失敗或降級，僅規則化／部分資料，請審慎使用。",
    )
    raw_answer: str = Field(
        "",
        description="將摘要、技術面、建議等拼接之完整文字，便於直接顯示。",
    )
    status: Optional[AnalysisStatus] = Field(
        None,
        description="`done`：完整分析；其餘值多為內部或相容用。",
    )


class AnalyzeFinalResponse(BaseModel):
    """`POST /analyze/final` 回應：摘要／情緒／建議／新聞等。**不含** `technical_highlights`（請用 `POST /analyze/quick-insights` 的 `points`）；**不含** `institutional_data`（法人表請用 `POST /analyze/raw/*`）。"""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "symbol": "2330",
                "date_start": "2026-03-01",
                "date_end": "2026-04-01",
                "summary": "（整合摘要）",
                "sentiment_score": 0.2,
                "recommendation": "偏多（理由）",
                "news_sources": [],
                "fallback_mode": False,
                "raw_answer": "",
                "status": "done",
            }
        }
    )

    symbol: str = Field("", description="股票代號（大寫）")
    date_start: str = Field("", description="起始日期 (YYYY-MM-DD)")
    date_end: str = Field("", description="結束日期 (YYYY-MM-DD)")
    summary: str = Field("", description="總結摘要")
    sentiment_score: float = Field(0.0, description="情緒分值 -1 ~ 1")
    recommendation: str = Field(
        "",
        description="最終建議，格式為「偏多／偏空／中性觀望」＋全形括號內簡述理由",
    )
    news_sources: List[NewsSourceItem] = Field(default_factory=list, description="資料來源")
    fallback_mode: bool = Field(False, description="是否為降級模式")
    raw_answer: str = Field("", description="完整文字回覆")
    status: Optional[AnalysisStatus] = Field(
        None,
        description="完整分析時為 done",
    )


class AnalyzeSymbolsRequest(BaseModel):
    """僅股票代號。回溯區間（自然日）由後端常數固定，**請求不得帶入** `lookback_days`。"""

    model_config = ConfigDict(json_schema_extra={"example": {"symbols": ["2330"]}})

    symbols: List[str] = Field(
        ...,
        description="股票代號；後端使用第一個有效代號（轉大寫）。",
        examples=[["2330"]],
    )


class AnalyzePricesResponse(BaseModel):
    """`POST /analyze/raw/prices`：僅日 K 價量。"""

    status: Literal["prices_ready"] = Field("prices_ready", description="固定 `prices_ready`")
    symbol: str
    date_start: str
    date_end: str
    prices: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="價量陣列。",
    )


class AnalyzeIndicatorsResponse(BaseModel):
    """`POST /analyze/raw/indicators`：僅技術指標序列。"""

    status: Literal["indicators_ready"] = Field(
        "indicators_ready",
        description="固定 `indicators_ready`",
    )
    symbol: str
    date_start: str
    date_end: str
    indicators: List[Dict[str, Any]] = Field(default_factory=list, description="指標列")


class AnalyzeInstitutionalSliceResponse(BaseModel):
    """`POST /analyze/raw/institutional`：僅三大法人買賣超。"""

    status: Literal["institutional_ready"] = Field(
        "institutional_ready",
        description="固定 `institutional_ready`",
    )
    symbol: str
    date_start: str
    date_end: str
    institutional_data: List[InstitutionalRow] = Field(default_factory=list)


class QuickInsightsResponse(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "symbol": "2330",
                "date_start": "2026-03-01",
                "date_end": "2026-04-01",
                "points": ["2026-04-01 RSI(14)=55.0 接近中性區"],
                "fallback_mode": False,
            }
        }
    )

    symbol: str = Field(..., description="股票代號")
    date_start: str = Field(..., description="分析區間起日")
    date_end: str = Field(..., description="分析區間迄日")
    points: List[str] = Field(
        default_factory=list,
        description="3～5 條「特別之處」短句；需含日期與數據時依模型輸出。",
    )
    fallback_mode: bool = Field(
        False,
        description="true 表示 LLM 失敗，改為規則化摘要。",
    )

