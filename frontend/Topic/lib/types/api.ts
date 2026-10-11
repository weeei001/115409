/**
 * 後端回應型別，欄位與型別照 openapi.json `components/schemas` 抄寫。
 * Decimal 欄位在 openapi 是 string，這裡維持 string，轉數字交給 lib/mappers。
 * 標「openapi 未列」的地方是經過確認、依後端實作保留的欄位（見 docs/PARITY.md 決議 D5）。
 */

// ── Market ──

export interface StockInfo {
  symbol: string;
  name: string;
  industry?: string | null;
}

export interface DailyPriceResponse {
  date: string;
  symbol: string;
  open: string | null;
  high: string | null;
  low: string | null;
  close: string | null;
  volume_shares: number | null;
  amount: number | null;
  change: string | null;
  trades: number | null;
}

export interface HistoricalPriceList {
  symbol: string;
  start_date: string;
  end_date: string;
  total: number;
  data: DailyPriceResponse[];
}

export interface DateRangeResponse {
  symbol: string;
  min_date: string;
  max_date: string;
}

export interface PriceStatistics {
  symbol: string;
  start_date: string;
  end_date: string;
  highest_price: string | null;
  lowest_price: string | null;
  average_close: string | null;
  total_volume: number | null;
  total_amount: number | null;
  trading_days: number;
}

export interface CandlestickWithMA {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
  change: number;
}

export interface CandlestickWithMAResponse {
  symbol: string;
  start_date: string;
  end_date: string;
  dates: string[];
  candlestick: CandlestickWithMA[];
  /** openapi 只寫 object；鍵為 `MA{period}`，值與 dates 等長（openapi 未列，依後端實作） */
  moving_averages: Record<string, Array<number | null>>;
}

export interface VolumeData {
  date: string;
  volume: number;
  amount: number;
  close: number;
  change: number;
}

export interface VolumeAnalysisResponse {
  symbol: string;
  start_date: string;
  end_date: string;
  data: VolumeData[];
}

export interface PriceChangeData {
  date: string;
  close: number;
  change: number;
  change_percent: number;
}

export interface PriceChangeResponse {
  symbol: string;
  start_date: string;
  end_date: string;
  data: PriceChangeData[];
}

export interface MultiStockData {
  date: string;
  prices: Record<string, number | null>;
}

export interface MultiStockResponse {
  start_date: string;
  end_date: string;
  symbols: string[];
  data: MultiStockData[];
}

export interface InstitutionalTradeResponse {
  date: string;
  symbol: string;
  foreign_buy: number | null;
  foreign_sell: number | null;
  foreign_net: number | null;
  investment_trust_buy: number | null;
  investment_trust_sell: number | null;
  investment_trust_net: number | null;
  dealer_buy: number | null;
  dealer_sell: number | null;
  dealer_net: number | null;
  total_institutional_buy: number | null;
  total_institutional_sell: number | null;
  total_institutional_net: number | null;
}

export interface InstitutionalTradeListResponse {
  symbol: string;
  start_date: string;
  end_date: string;
  total: number;
  data: InstitutionalTradeResponse[];
}

export interface TechnicalIndicatorResponse {
  date: string;
  symbol: string;
  close: string | null;
  ma5: string | null;
  ma10: string | null;
  ma20: string | null;
  ma60: string | null;
  ma120: string | null;
  ma240: string | null;
  rsi5: string | null;
  rsi10: string | null;
  rsv9: string | null;
  kd_k9: string | null;
  kd_d9: string | null;
  kd_j9: string | null;
  ema12: string | null;
  ema26: string | null;
  macd_dif: string | null;
  macd_dea: string | null;
  macd_signal: string | null;
  macd_hist: string | null;
  boll_mid20: string | null;
  boll_upper20: string | null;
  boll_lower20: string | null;
  volume_ma5: string | null;
}

export interface TechnicalIndicatorListResponse {
  symbol: string;
  start_date: string;
  end_date: string;
  total: number;
  data: TechnicalIndicatorResponse[];
}

export interface ChipsVolumeData {
  date: string;
  close: number | null;
  volume: number | null;
  foreign_net: number | null;
  investment_trust_net: number | null;
  dealer_net: number | null;
  total_institutional_net: number | null;
}

export interface ChipsVolumeChartResponse {
  symbol: string;
  start_date: string;
  end_date: string;
  data: ChipsVolumeData[];
}

// ── News ──

export type NewsImpactDirection = 'positive' | 'negative' | 'neutral' | 'mixed' | 'uncertain';
export type NewsImpactScope = 'market' | 'industry' | 'company';

export interface NewsEvidence {
  field: 'title' | 'content';
  quote: string;
}

export interface NewsEvent {
  key: string;
  summary: string;
  statement_type: 'fact' | 'plan' | 'forecast' | 'opinion';
  speaker?: string | null;
  topics: string[];
  evidence: NewsEvidence[];
}

export interface NewsImpact {
  event_key: string;
  target_type: NewsImpactScope;
  target_id: string;
  target_name?: string | null;
  direction: NewsImpactDirection;
  importance: 'high' | 'medium' | 'low';
  basis: 'reported' | 'inferred';
  reason: string;
  evidence: NewsEvidence[];
}

export interface NewsEventAnalysis {
  content_truncated?: boolean;
  content_kind?: string | null;
  validation_scope?: string;
  status: 'pending' | 'success' | 'failed' | 'skipped';
  events: NewsEvent[];
  impacts: NewsImpact[];
  analyzed_at?: string | null;
}

export interface NewsSourceState {
  eligible: boolean;
  status: 'active' | 'untracked' | 'conflict' | 'superseded' | 'historical';
  canonical_key?: string;
  canonical_url?: string;
  revision_id?: string | null;
  observed_at?: string | null;
  limitation?: string;
}

export interface News {
  source_state?: NewsSourceState;
  target_industries?: string[];
  article_id: string;
  source: string | null;
  source_group: string | null;
  stock_id: string | null;
  title: string | null;
  pub_time: string | null;
  url: string | null;
  tags: string | null;
  content: string | null;
  created_at: string | null;
  event_analysis: NewsEventAnalysis;
}

export interface PaginatedNewsResponse {
  total_is_exact?: boolean;
  result_scope?: string;
  page: number;
  page_size: number;
  total: number;
  items: News[];
}

/**
 * GET /news/industries：openapi 的回應 schema 是空的，形狀依後端 `news/service.py` 的 `industries()`（openapi 未列，決議 D5）。
 * id 是新聞 `industry` 參數要的代碼（例如 TWSE:24）；name 是「上市 · 半導體業」這種含市場前綴的名稱。
 */
export interface NewsIndustry {
  id: string;
  name: string;
}

export interface NewsIndustriesResponse {
  items: NewsIndustry[];
}

// ── Auth ──

export interface UserPublic {
  id: number;
  email: string;
  display_name: string | null;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: UserPublic;
}

export interface MessageResponse {
  message: string;
}

// ── Favorites（決議 F1：已從 production openapi 同步，端點與 schema 與原手寫版本相同） ──

export interface FavoriteStockResponse {
  symbol: string;
  name: string;
  created_at: string;
}

export interface FavoriteStockListResponse {
  items: FavoriteStockResponse[];
}

// ── AI 成效（AI 摘要命中率、對話回饋） ──

export type TrackRecordHorizonKey = 'short_1_5' | 'swing_6_20' | 'medium_21_40';

export interface TrackRecordOutcome {
  horizon: TrackRecordHorizonKey;
  stance?: string | null;
  call: 'up' | 'down' | 'none';
  /** 基準日收盤到區間終點收盤的漲跌幅（%）；未到期為 null */
  return_pct?: number | null;
  /** 同期間加權指數（未含息）的漲跌幅（%）；未到期或缺大盤資料為 null */
  benchmark_return_pct?: number | null;
  /** 區間終點的交易日（YYYY-MM-DD）；未到期為 null */
  resolved_on?: string | null;
  result: 'hit' | 'miss' | 'no_call' | 'pending';
}

export interface TrackRecordItem {
  symbol: string;
  as_of_date: string;
  overall_stance?: string | null;
  outcomes: TrackRecordOutcome[];
}

export interface TrackRecordHorizon {
  horizon: TrackRecordHorizonKey;
  trading_days: number;
  directional_calls: number;
  hits: number;
  /** 0–1；沒有樣本為 null */
  hit_rate?: number | null;
  /** 同一批樣本中實際上漲的比例（每次都猜漲的命中率），0–1 */
  up_baseline_rate?: number | null;
  /** 已到期、有方向判斷且有同期大盤資料的樣本數 */
  relative_calls?: number;
  /** 看多且漲幅勝過大盤、看空且表現落後大盤的次數 */
  relative_hits?: number;
  /** relative_hits / relative_calls，0–1；沒有樣本為 null */
  relative_hit_rate?: number | null;
  no_call: number;
  pending: number;
}

/** openapi: GET /analyze/stock-behavior/track-record → AITrackRecordResponse */
export interface AITrackRecordResponse {
  symbol?: string | null;
  days: number;
  window_start: string;
  snapshot_count: number;
  horizons: TrackRecordHorizon[];
  recent: TrackRecordItem[];
  method_note: string;
}

/** openapi: PUT/DELETE /api/conversations/{conversation_id}/messages/{message_id}/feedback → MessageFeedback */
export interface MessageFeedback {
  message_id: string;
  rating: 'up' | 'down' | null;
}

/** openapi: GET /admin/ai-feedback → AIFeedbackSummary */
export interface AIFeedbackSummary {
  days: number;
  ready: boolean;
  completed_answers: number;
  rated: number;
  helpful: number;
  unhelpful: number;
  helpful_rate?: number | null;
  recent_unhelpful: Array<{ message_id: string; conversation_id: string; rated_at: string; answer_excerpt: string }>;
}

// ── AI 回測（GET /admin/ai-backtest/stream 的 done 事件、GET /admin/ai-backtest/result） ──

export type BacktestStance = 'bullish' | 'mildly_bullish' | 'neutral' | 'mildly_bearish' | 'bearish';
export type BacktestGroupKey = 'rule' | 'ai_plain' | 'ai_signals';
export type BacktestPreset = 'conservative' | 'standard' | 'aggressive';

export interface BacktestGroupDecision {
  /** AI 呼叫失敗時為 null，持股不變 */
  stance?: BacktestStance | null;
  signal_keys?: string[];
  reason?: string;
  /** 規則換算的目標持股比例 0–1；中性為 null */
  target_exposure?: number | null;
  /** 隔日開盤成交的股數；買為正、賣為負 */
  traded_shares?: number;
  failed?: boolean;
}

export interface BacktestDecisionRecord {
  date: string;
  execution_date?: string | null;
  /** 判斷日收盤到之後第 5 個交易日收盤的漲跌（%） */
  forward_return_pct?: number | null;
  market_return_pct?: number | null;
  active_signals?: string[];
  groups: Partial<Record<BacktestGroupKey, BacktestGroupDecision>>;
}

export interface BacktestTierStats {
  stance: BacktestStance;
  count: number;
  avg_forward_pct?: number | null;
  hit_rate?: number | null;
}

export interface BacktestCitationStats {
  key: string;
  label: string;
  available: number;
  cited: number;
  avg_edge_pct?: number | null;
  cited_hit_rate?: number | null;
}

export interface BacktestGroupResult {
  key: BacktestGroupKey;
  label: string;
  final_value: number;
  total_return_pct: number;
  max_drawdown_pct: number;
  trades: number;
  costs_paid: number;
  /** 0–1 */
  avg_exposure: number;
  directional_calls: number;
  hit_rate?: number | null;
  beat_market_rate?: number | null;
  failed_calls?: number;
  tiers: BacktestTierStats[];
  citations?: BacktestCitationStats[];
  /** 每個交易日收盤的資產，和 AIBacktestResult.dates 對齊 */
  equity: number[];
}

/** openapi: AIBacktestResult */
export interface AIBacktestResult {
  symbol: string;
  start: string;
  end: string;
  preset: BacktestPreset;
  initial_cash: number;
  decision_every: number;
  model_name?: string | null;
  dates: string[];
  buy_and_hold: number[];
  market_index: number[];
  groups: BacktestGroupResult[];
  decisions: BacktestDecisionRecord[];
  method_note: string;
}

// ── 訊號檢驗（GET /admin/signal-check） ──

export type SignalReading = 'bullish' | 'bearish';

export interface SignalPeriodStats {
  /** 已走完觀察期、去除重疊後的事件數 */
  events: number;
  /** 成立日收盤到第 N 個交易日收盤的平均漲跌（%） */
  avg_return_pct?: number | null;
  /** 0–1 */
  up_rate?: number | null;
  /** 漲跌勝過同期加權指數的比例，0–1 */
  beat_market_rate?: number | null;
  /** 平均漲跌減同期加權指數漲跌（百分點） */
  avg_excess_pct?: number | null;
  /** 扣一次買賣成本後的平均漲跌（%）；只有偏多訊號才算 */
  net_return_pct?: number | null;
}

export interface SignalStats {
  key: string;
  label: string;
  definition: string;
  /** 一般解讀，不是買賣建議 */
  reading: SignalReading;
  source: string;
  discovery: SignalPeriodStats;
  validation: SignalPeriodStats;
  /** 期間內成立、觀察期還沒走完的事件數 */
  pending: number;
}

export interface RecentSignal {
  date: string;
  key: string;
  label: string;
  reading: SignalReading;
}

export interface SignalEvidenceItem {
  /** 證據編號 sg_01 起；AI 判斷時用這個編號引用 */
  id: string;
  key: string;
  label: string;
  definition: string;
  reading: SignalReading;
  source: string;
  fired_on: string;
  /** 成立日距判斷日幾個交易日；0 是判斷日當天 */
  trading_days_ago: number;
  /** 截至判斷日，股票清單全部股票的歷史統計 */
  all_stocks: SignalPeriodStats;
  /** 截至判斷日，這檔股票自己的歷史統計 */
  this_stock: SignalPeriodStats;
  /** 全部股票的平均漲跌減任一天進場（百分點） */
  edge_vs_baseline_pct?: number | null;
}

/** openapi: GET /admin/signal-evidence → SignalEvidenceResponse */
export interface SignalEvidenceResponse {
  symbol: string;
  as_of: string;
  /** 查詢日當天或之前最近的交易日 */
  decision_date: string;
  horizon: number;
  baseline: SignalPeriodStats;
  items: SignalEvidenceItem[];
  method_note: string;
}

/** openapi: GET /admin/signal-check → SignalCheckResponse */
export interface SignalCheckResponse {
  symbol?: string | null;
  stock_count: number;
  horizon: number;
  start: string;
  split: string;
  end: string;
  latest_date?: string | null;
  round_trip_cost_pct: number;
  /** 任一天進場：同一批股票、同一期間每隔 N 個交易日取一天 */
  baseline: SignalStats;
  signals: SignalStats[];
  recent?: RecentSignal[];
  method_note: string;
}

/** openapi: GET /admin/ai-usage → AIUsageSummary（AI 摘要的 token、產生時間與估算成本） */
export interface AIUsageSummary {
  days: number;
  /** 期間內產生的摘要份數，含沒有通過檢查、未產出內容的 */
  briefs: number;
  unavailable: number;
  /** 有 token 紀錄的份數；平均與成本只用這些計算 */
  measured: number;
  avg_prompt_tokens?: number | null;
  avg_completion_tokens?: number | null;
  avg_latency_seconds?: number | null;
  /** 需要第二次呼叫的比例，0–1 */
  retry_rate?: number | null;
  /** 美元／百萬 token */
  input_price_per_m: number;
  output_price_per_m: number;
  avg_cost_usd?: number | null;
  total_cost_usd?: number | null;
}
