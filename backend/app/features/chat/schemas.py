from typing import Annotated, Literal
from uuid import uuid4

from pydantic import BaseModel, Field, PrivateAttr, field_validator, model_validator


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=6000)


class AskRequest(BaseModel):
    _user_id: int | None = PrivateAttr(default=None)
    _conversation_id: str | None = PrivateAttr(default=None)
    _turn_id: str | None = PrivateAttr(default=None)
    _planning_trace: list[dict] = PrivateAttr(default_factory=list)
    _evidence_trace: dict = PrivateAttr(default_factory=dict)
    query: str = Field(min_length=1, max_length=6000)
    stock_id: str | None = Field(default=None, pattern=r"^[0-9]{4,6}$")
    stream: bool = Field(default=False, description="保留舊請求相容性；回覆一律使用一般 JSON。")
    answer_detail: Literal["plain", "standard", "technical"] = "plain"
    history: list[ChatTurn] = Field(default_factory=list, max_length=8)

    @field_validator("query")
    @classmethod
    def nonblank_query(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Query must not be blank")
        return value.strip()


class PaperOrderIntent(BaseModel):
    mode: Literal["none", "offer", "draft"] = "none"
    side: Literal["buy", "sell"] | None = None
    budget: float | None = Field(default=None, gt=0, le=1000000000, allow_inf_nan=False)
    quantity: int | None = Field(default=None, gt=0, le=1000000000, strict=True)


class IntentDetails(BaseModel):
    is_finance: bool = True
    stocks: list[str] = Field(default_factory=list)
    time_from: str | None = None
    time_to: str | None = None
    suggested_questions: list[Annotated[str, Field(min_length=1, max_length=200)]] = Field(default_factory=list, max_length=3)
    standalone_query: str | None = Field(default=None, max_length=6000)
    display_focus: list[Literal["price", "technical", "institutional", "fundamental", "comparison", "news"]] = Field(default_factory=list)
    forward_outlook: bool = Field(default=False, strict=True)
    news_scope: Literal["selected_stocks", "market_wide"] = "selected_stocks"
    paper_order: PaperOrderIntent = Field(default_factory=PaperOrderIntent)


class Intent(IntentDetails):
    """由後端編譯的可執行資料需求，不直接採用呼叫端輸入。"""

    data_needs: list[Literal["news", "market", "knowledge", "help", "favorites", "portfolio"]]


class SourceChunk(BaseModel):
    title: str
    source: str
    source_name: str
    pub_time: str
    url: str
    stock_id: str
    content: str
    score: float
    citation_id: str = ""
    category: str = "news"
    article_id: str | None = None
    chunk_id: str | None = None
    chunk_index: int | None = None
    char_start: int | None = None
    char_end: int | None = None
    content_hash: str | None = None
    revision: str | None = None
    index_version: str | None = None
    embedding_model: str | None = None
    stock_ids: list[str] = Field(default_factory=list)
    analysis_status: str | None = None
    analysis_input_hash: str | None = None
    analysis_config_hash: str | None = None
    impact_scopes: list[str] = Field(default_factory=list)
    impact_company_ids: list[str] = Field(default_factory=list)
    impact_industry_ids: list[str] = Field(default_factory=list)
    impact_directions: list[str] = Field(default_factory=list)
    impact_importance: list[str] = Field(default_factory=list)
    impact_topics: list[str] = Field(default_factory=list)
    impact_context: list[dict] = Field(default_factory=list)
    retrieval_branch: str | None = None
    shared_fact_ids: list[str] = Field(default_factory=list)
    shared_facts: list[dict] = Field(default_factory=list)
    source_relationships: list[dict] = Field(default_factory=list)
    source_state: dict | None = None
    in_time_range: bool = True

    @model_validator(mode="before")
    @classmethod
    def null_strings(cls, data):
        if not isinstance(data, dict):
            return data
        return {key: "" if value is None and key in cls.model_fields
                and cls.model_fields[key].annotation is str else value
                for key, value in data.items()}


class ChatAction(BaseModel):
    type: Literal["navigate"] = "navigate"
    label: str
    path: str = Field(pattern=r"^(?:/|/ai|/compare|/order|/stock/[0-9]{4,6})$")


class PaperOrderDraft(BaseModel):
    type: Literal["paper_order_draft"] = "paper_order_draft"
    draft_id: str = Field(default_factory=lambda: str(uuid4()))
    label: str = "建立模擬單草稿"
    symbol: str = Field(pattern=r"^[0-9]{4,6}$")
    side: Literal["buy", "sell"]
    budget: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    quantity: int | None = Field(default=None, gt=0)
    reason: str = Field(default="", max_length=2000)
    observation: str = Field(default="", max_length=2000)
    review_after_days: int = Field(default=20, ge=1, le=250)
    conversation_id: str | None = None


class ChatFollowUp(BaseModel):
    type: Literal["follow_up"] = "follow_up"
    label: str = Field(min_length=1, max_length=200)
    query: str = Field(min_length=1, max_length=6000)


class DashboardBlock(BaseModel):
    title: str
    description: str = ""
    source_ids: list[str] = Field(default_factory=list)


class DashboardMetric(BaseModel):
    label: str
    value: float | None
    unit: str = ""
    date: str | None = None


class DashboardMetrics(DashboardBlock):
    kind: Literal["metrics"] = "metrics"
    items: list[DashboardMetric]


class DashboardSeries(BaseModel):
    name: str
    values: list[float | None]


class DashboardChart(DashboardBlock):
    kind: Literal["chart"] = "chart"
    dates: list[str]
    series: list[DashboardSeries]
    unit: str = ""


class DashboardTable(DashboardBlock):
    kind: Literal["table"] = "table"
    columns: list[str]
    rows: list[list[str]]


class DashboardNewsItem(BaseModel):
    title: str
    publisher: str
    published_at: str
    url: str
    source_id: str
    article_id: str | None = Field(default=None, max_length=64)


class DashboardNews(DashboardBlock):
    kind: Literal["news"] = "news"
    items: list[DashboardNewsItem]


class ChatDashboard(BaseModel):
    title: str
    blocks: list[Annotated[DashboardMetrics | DashboardChart | DashboardTable | DashboardNews,
                           Field(discriminator="kind")]]


class AskResponse(BaseModel):
    # Recognition context stays out of API payloads and saved messages.
    _company_catalog: dict = PrivateAttr(default_factory=dict)
    _requires_portfolio: bool = PrivateAttr(default=False)
    answer: str
    detected_stocks: list[str]
    time_range: dict | None
    sources: list[SourceChunk]
    tokens: dict
    duration_ms: int
    current_time: str
    actions: list[ChatAction | ChatFollowUp | PaperOrderDraft] = Field(default_factory=list)
    dashboard: ChatDashboard | None = None
