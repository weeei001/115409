from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


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


class AnalyzeFinalResponse(BaseModel):
    """`POST /analyze/final` 回應：摘要／情緒／建議／新聞等。**不含** `technical_highlights`、`institutional_data`、`raw_answer`（法人表請用 `POST /analyze/raw/*`；條列觀察請用 `POST /analyze/quick-insights`）。"""

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

