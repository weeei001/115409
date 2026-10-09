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
