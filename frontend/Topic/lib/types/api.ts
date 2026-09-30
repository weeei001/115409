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

export interface SentimentEvidenceItem {
  field: 'title' | 'content';
  quote: string;
}

/** openapi 只寫 string；後端 news/sentiment.py 限定這 5 個值（openapi 未列，依後端實作） */
export type SentimentLabel = 'positive' | 'negative' | 'neutral' | 'mixed' | 'insufficient';

export interface SentimentResponse {
  target_stock_id: string;
  label: SentimentLabel | string;
  reason: string;
  evidence?: SentimentEvidenceItem[];
  analyzed_at?: string | null;
}

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
  content_kind?: string;
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
  sentiments?: SentimentResponse[];
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

// ── Simulated orders ──

export type OrderSide = 'buy' | 'sell';
export type OrderStatus = 'pending' | 'filled' | 'cancelled';
export type SellPlan = 'long_term' | 'by_date';

export interface SimulatedOrderCreate {
  user_id: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  sell_plan?: SellPlan | null;
  planned_sell_date?: string | null;
  trade_date?: string | null;
}

export interface SimulatedOrderResponse {
  user_id: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  sell_plan: SellPlan | null;
  planned_sell_date: string | null;
  id: string;
  trade_date: string;
  status: OrderStatus;
  estimated_amount: number;
  markup_basis: 'latest' | 'planned_sell' | 'fifo_realized' | null;
  reference_date: string | null;
  reference_close: number | null;
  markup_amount: number | null;
  markup_rate: number | null;
  created_at: string;
}

export interface SimulatedOrderListResponse {
  user_id: string;
  total: number;
  data: SimulatedOrderResponse[];
}

export interface AvailableLotsResponse {
  user_id: string;
  symbol: string;
  available_lots: number;
}

export interface SimulatedOrderCategoryProfitItem {
  category: string;
  order_count: number;
  symbols: string[];
  cost_amount: number;
  market_amount: number;
  profit_amount: number;
  profit_rate: number;
}

export interface SimulatedOrderCategoryProfitResponse {
  user_id: string;
  total_orders: number;
  priced_orders: number;
  unpriced_orders: number;
  data?: SimulatedOrderCategoryProfitItem[];
}
