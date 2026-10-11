from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

Stance = Literal["bullish", "mildly_bullish", "neutral", "mildly_bearish", "bearish"]
GroupKey = Literal["rule", "ai_plain", "ai_signals"]
Preset = Literal["conservative", "standard", "aggressive"]


class BacktestDecision(BaseModel):
    """What the model returns for one decision day; positions are set by the rule preset, not by the model."""
    stance: Stance
    evidence_ids: list[str] = Field(default_factory=list, max_length=6)
    reason: str = Field(max_length=200)


class GroupDecision(BaseModel):
    stance: Optional[Stance] = Field(default=None, description="這一組的五級判斷；AI 呼叫失敗時為 null，持股不變。")
    signal_keys: list[str] = Field(default_factory=list, description="引用的訊號（純規則組是用來判斷的訊號）。")
    reason: str = ""
    target_exposure: Optional[float] = Field(default=None, description=(
        "規則換算的目標持股比例 0–1；中性、AI 呼叫失敗，或最後一個判斷日（區間內沒有下一個交易日）為 null，持股不變。"))
    traded_shares: int = Field(default=0, description=(
        "隔日開盤成交的股數；買為正、賣為負。持股比例和目標相差不到 5 個百分點時不交易，為 0。"))
    failed: bool = False


class DecisionRecord(BaseModel):
    date: str = Field(description="判斷日（收盤後判斷）。")
    execution_date: Optional[str] = Field(default=None, description="成交日：判斷日的下一個交易日開盤。")
    forward_return_pct: Optional[float] = Field(default=None, description="判斷日收盤到之後第 5 個交易日收盤的漲跌（%）。")
    market_return_pct: Optional[float] = Field(default=None, description="同期間加權指數（未含息）的漲跌（%）。")
    active_signals: list[str] = Field(default_factory=list, description="當天證據清單裡的訊號。")
    groups: dict[GroupKey, GroupDecision]


class TierStats(BaseModel):
    stance: Stance
    count: int
    avg_forward_pct: Optional[float] = None
    hit_rate: Optional[float] = Field(default=None, description="方向判斷之後實際同向的比例；中性為 null。")


class CitationStats(BaseModel):
    key: str
    label: str
    available: int = Field(description="出現在證據清單的次數。")
    cited: int = Field(description="被這一組引用的次數。")
    avg_edge_pct: Optional[float] = Field(default=None, description="出現時，當時已知的平均優勢（相對任一天進場，百分點）。")
    cited_hit_rate: Optional[float] = Field(default=None, description="引用後的方向判斷命中率。")


class GroupResult(BaseModel):
    key: GroupKey
    label: str
    final_value: float
    total_return_pct: float
    max_drawdown_pct: float
    trades: int
    costs_paid: float
    avg_exposure: float = Field(description="期間平均持股比例 0–1。")
    directional_calls: int
    hit_rate: Optional[float] = None
    beat_market_rate: Optional[float] = Field(default=None, description="方向判斷相對大盤也同向的比例。")
    failed_calls: int = 0
    tiers: list[TierStats]
    citations: list[CitationStats] = Field(default_factory=list)
    equity: list[float] = Field(description="每個交易日收盤的資產，和 dates 對齊。")


class AIBacktestResult(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    symbol: str
    start: str
    end: str
    preset: Preset
    initial_cash: float
    decision_every: int
    model_name: Optional[str] = None
    dates: list[str] = Field(description="資產曲線的交易日。")
    buy_and_hold: list[float] = Field(description="第一個成交日開盤全數買進、之後不動的資產。")
    market_index: list[float] = Field(description="加權指數換算成同樣起始金額；缺資料的日子沿用前一天。")
    groups: list[GroupResult]
    decisions: list[DecisionRecord]
    method_note: str
