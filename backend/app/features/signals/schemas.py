from typing import Literal, Optional

from pydantic import BaseModel, Field


class PeriodStats(BaseModel):
    events: int = Field(description="已走完觀察期、去除重疊後的事件數。")
    avg_return_pct: Optional[float] = Field(default=None, description="成立日收盤到第 N 個交易日收盤的平均漲跌（%）。")
    up_rate: Optional[float] = Field(default=None, description="之後上漲的比例，0–1。")
    beat_market_rate: Optional[float] = Field(default=None, description="漲跌勝過同期加權指數的比例，0–1；缺大盤資料的事件不計。")
    avg_excess_pct: Optional[float] = Field(default=None, description="平均漲跌減同期加權指數漲跌（百分點）。")
    net_return_pct: Optional[float] = Field(
        default=None, description="平均漲跌扣一次買賣的成本（%）；只有一般解讀偏多的訊號才算，偏空訊號為 null。")


class SignalStats(BaseModel):
    key: str
    label: str
    definition: str
    reading: Literal["bullish", "bearish"] = Field(description="一般解讀：bullish 偏多、bearish 偏空。不是買賣建議。")
    source: str = Field(description="訊號用到的資料：價格與均線、成交量、技術指標、法人籌碼、月營收。")
    discovery: PeriodStats = Field(description="挑選期（start 到 split 前一天）的統計。")
    validation: PeriodStats = Field(description="驗證期（split 到 end）的統計。")
    pending: int = Field(description="期間內成立、但觀察期還沒走完的事件數。")


class RecentSignal(BaseModel):
    date: str
    key: str
    label: str
    reading: Literal["bullish", "bearish"]


class SignalEvidenceItem(BaseModel):
    id: str = Field(description="證據編號 sg_01 起；AI 判斷時用這個編號引用。")
    key: str
    label: str
    definition: str
    reading: Literal["bullish", "bearish"] = Field(description="一般解讀：bullish 偏多、bearish 偏空。不是買賣建議。")
    source: str
    fired_on: str = Field(description="訊號成立的交易日。")
    trading_days_ago: int = Field(description="成立日距判斷日幾個交易日；0 是判斷日當天。")
    all_stocks: PeriodStats = Field(description="截至判斷日，股票清單全部股票的歷史統計。")
    this_stock: PeriodStats = Field(description="截至判斷日，這檔股票自己的歷史統計；次數通常很少。")
    edge_vs_baseline_pct: Optional[float] = Field(
        default=None, description="全部股票的平均漲跌減同期任一天進場的平均漲跌（百分點）。")


class SignalEvidenceResponse(BaseModel):
    symbol: str
    as_of: str = Field(description="查詢的日期。")
    decision_date: str = Field(description="實際使用的判斷日：查詢日當天或之前最近的交易日。")
    horizon: int
    baseline: PeriodStats = Field(description="截至判斷日，全部股票任一天進場的歷史統計。")
    items: list[SignalEvidenceItem] = Field(
        description="判斷日往前 horizon 個交易日內（含當天）成立、觀察期還沒走完的訊號；同一訊號只列最近一次。")
    method_note: str


class SignalCheckResponse(BaseModel):
    symbol: Optional[str] = Field(default=None, description="查詢的股票代號；全部股票合計時為 null。")
    stock_count: int = Field(description="納入統計的股票檔數。")
    horizon: int = Field(description="觀察成立後第幾個交易日的收盤。")
    start: str
    split: str
    end: str
    latest_date: Optional[str] = Field(default=None, description="資料中最新的交易日。")
    round_trip_cost_pct: float = Field(description="一次買賣的成本（%）：手續費買賣各一次加賣出證交稅。")
    baseline: SignalStats = Field(description="任一天進場：同一批股票、同一期間每隔 N 個交易日取一次，訊號要比它好才有意義。")
    signals: list[SignalStats]
    recent: list[RecentSignal] = Field(
        default_factory=list, description="單一股票時，最近 10 個交易日成立的訊號（新到舊）；全部股票時為空。")
    method_note: str
