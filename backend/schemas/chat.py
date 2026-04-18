from datetime import date
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


class ScoreWeightsItem(BaseModel):
    technical: float = Field(0.38, description="技術面權重")
    institutional: float = Field(0.30, description="籌碼面權重")
    news: float = Field(0.15, description="新聞/RAG 權重")
    momentum: float = Field(0.17, description="量價動能權重")


class ScoreExplanationsItem(BaseModel):
    technical: str = Field("", description="技術面計分解釋")
    institutional: str = Field("", description="籌碼面計分解釋")
    news: str = Field("", description="新聞面計分解釋")
    momentum: str = Field("", description="量價動能計分解釋")


class ScoreBreakdownItem(BaseModel):
    technical_score: float = Field(0.0, description="技術面分數（-1 ~ 1）")
    institutional_score: float = Field(0.0, description="籌碼面分數（-1 ~ 1）")
    news_score: float = Field(0.0, description="新聞面分數（-1 ~ 1）")
    momentum_score: float = Field(0.0, description="量價動能分數（-1 ~ 1）")
    weighted_score: float = Field(0.0, description="加權總分（-1 ~ 1）")
    weights: ScoreWeightsItem = Field(default_factory=ScoreWeightsItem)
    explanations: ScoreExplanationsItem = Field(default_factory=ScoreExplanationsItem)


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
                "recommendation_basis": [
                    "技術面解釋",
                    "籌碼面解釋",
                    "新聞面解釋",
                    "量價動能解釋",
                ],
                "news_sources": [],
                "score_breakdown": {
                    "technical_score": 0.4,
                    "institutional_score": 0.3,
                    "news_score": 0.2,
                    "momentum_score": 0.1,
                    "weighted_score": 0.28,
                    "weights": {
                        "technical": 0.38,
                        "institutional": 0.30,
                        "news": 0.15,
                        "momentum": 0.17,
                    },
                    "explanations": {
                        "technical": "技術面解釋",
                        "institutional": "籌碼面解釋",
                        "news": "新聞面解釋",
                        "momentum": "量價動能解釋",
                    },
                },
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
    recommendation_basis: List[str] = Field(
        default_factory=list,
        description="四個面向（技術／籌碼／新聞／量價動能）的解釋條列",
    )
    news_sources: List[NewsSourceItem] = Field(default_factory=list, description="資料來源")
    score_breakdown: ScoreBreakdownItem = Field(
        default_factory=ScoreBreakdownItem,
        description="後端固定權重計分明細",
    )
    fallback_mode: bool = Field(False, description="是否為降級模式")
    status: Optional[AnalysisStatus] = Field(
        None,
        description="完整分析時為 done",
    )


class AnalyzeSymbolsRequest(BaseModel):
    """僅股票代號。回溯區間（自然日）由後端常數固定，**請求不得帶入** `lookback_days`。"""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "symbols": ["2330"],
                "as_of_date": "2026-04-01",
            }
        }
    )

    symbols: List[str] = Field(
        ...,
        description="股票代號；後端使用第一個有效代號（轉大寫）。",
        examples=[["2330"]],
    )
    as_of_date: Optional[date] = Field(
        default=None,
        description="Optional historical anchor date for analysis (YYYY-MM-DD).",
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


class AnalyzeReportResponse(BaseModel):
    """Aggregated non-stream response used by `POST /analyze/report`."""

    symbol: str = Field("", description="Stock symbol")
    date_start: str = Field("", description="Analysis start date (YYYY-MM-DD)")
    date_end: str = Field("", description="Analysis end date (YYYY-MM-DD)")

    summary: str = Field("", description="Final integrated summary")
    sentiment_score: float = Field(0.0, description="Weighted sentiment score in range [-1, 1]")
    recommendation: str = Field("", description="Recommendation generated by backend score policy")
    recommendation_basis: List[str] = Field(default_factory=list, description="Recommendation basis points")

    news_sources: List[NewsSourceItem] = Field(default_factory=list, description="Referenced news items")
    score_breakdown: ScoreBreakdownItem = Field(default_factory=ScoreBreakdownItem)
    fallback_mode: bool = Field(False, description="True when final analysis used fallback mode")

    quick_points: List[str] = Field(default_factory=list, description="Quick insights points")
    quick_fallback_mode: bool = Field(
        False,
        description="True when quick insights used fallback mode",
    )
    institutional_data: List[InstitutionalRow] = Field(default_factory=list)

    status: Literal["done"] = Field("done")
