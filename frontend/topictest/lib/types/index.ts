// ── AI Analysis (kept from original) ──

export interface RAGSource {
  id: string;
  title: string;
  date: string;
  url?: string;
}

export interface AITrendAnalysis {
  conclusion: string;
  confidence: number;
  summary: string;
  sources: RAGSource[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

// ── Advisor Report Types ──

export type AdvisorAction = 'buy' | 'sell' | 'wait';

export interface AdvisorSource {
  title: string;
  url?: string | null;
  publisher?: string | null;
  published_at?: string | null;
  type?: string | null;
  /** 來自 /analyze news_sources */
  summary?: string | null;
}

export interface AdvisorTechnicalSignal {
  name: string;
  value?: string | number | null;
  interpretation: string;
}

export interface AdvisorInstitutionalFlowItem {
  name: string;
  net_amount: number | null;
  trend?: string | null;
}

export interface AdvisorInstitutionalFlow {
  summary?: string | null;
  items: AdvisorInstitutionalFlowItem[];
}

export interface AdvisorReport {
  symbol: string;
  generated_at: string;
  summary: string;
  technical_signals: AdvisorTechnicalSignal[];
  institutional_flow: AdvisorInstitutionalFlow;
  recommendation: AdvisorAction;
  reasoning: string;
  risk_notes?: string | null;
  sources: AdvisorSource[];
  /** 分析資料起始日（來自 /analyze） */
  date_start?: string;
  /** 分析資料結束日（來自 /analyze） */
  date_end?: string;
  /** 多空情緒分數 -1～1（來自 /analyze） */
  sentiment_score?: number;
  /** 後端操作建議原文（與三態 badge 不同） */
  recommendation_text?: string;
  /** 三大法人逐日明細（與卡片最新一日並列） */
  institutional_rows?: AnalyzeInstitutionalRow[];
}

// ── POST /analyze (ChatRequest / ChatResponse) ──

export interface AnalyzeInstitutionalRow {
  date: string;
  foreign_net?: number;
  trust_net?: number;
  dealer_net?: number;
  total_net?: number;
}

export interface AnalyzeNewsSourceItem {
  id?: string;
  title: string;
  summary?: string;
  timestamp?: string;
  url?: string | null;
}

export interface AnalyzeRequest {
  symbols: string[];
  with_news?: boolean;
}

export interface AnalyzeResponse {
  symbol?: string;
  date_start?: string;
  date_end?: string;
  summary?: string;
  sentiment_score?: number;
  technical_highlights?: string[];
  institutional_data?: AnalyzeInstitutionalRow[];
  recommendation?: string;
  recommendation_basis?: string[];
  news_sources?: AnalyzeNewsSourceItem[];
}

/** 拆分 analyze 共用請求（勿帶 model／lookback_days） */
export interface AnalyzeSplitRequest {
  symbols: string[];
}

/** POST /analyze/raw/prices */
export interface AnalyzeRawPricesResponse {
  status: 'prices_ready';
  symbol?: string;
  date_start?: string;
  date_end?: string;
  prices?: Record<string, unknown>[];
}

/** POST /analyze/raw/indicators */
export interface AnalyzeRawIndicatorsResponse {
  status: 'indicators_ready';
  symbol?: string;
  date_start?: string;
  date_end?: string;
  indicators?: Record<string, unknown>[];
}

/** POST /analyze/raw/institutional */
export interface AnalyzeRawInstitutionalResponse {
  status: 'institutional_ready';
  symbol?: string;
  date_start?: string;
  date_end?: string;
  institutional_data?: AnalyzeInstitutionalRow[];
}

/** POST /analyze/quick-insights */
export interface AnalyzeQuickInsightsResponse {
  symbol?: string;
  date_start?: string;
  date_end?: string;
  points?: string[];
  fallback_mode?: boolean;
}

/** POST /analyze/final（無 technical_highlights、institutional_data） */
export interface AnalyzeFinalResponse {
  symbol?: string;
  date_start?: string;
  date_end?: string;
  summary?: string;
  sentiment_score?: number;
  recommendation?: string;
  recommendation_basis?: string[];
  news_sources?: AnalyzeNewsSourceItem[];
  fallback_mode?: boolean;
  raw_answer?: string;
  status?: string;
}

// ── Auth (JWT) ──

export interface UserPublic {
  id: number;
  email: string;
  display_name: string | null;
}

export interface AuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: UserPublic;
}

// ── Backend API Response Types (matching openapi.json schemas) ──

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

export interface CandlestickData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CandlestickResponse {
  symbol: string;
  start_date: string;
  end_date: string;
  total: number;
  data: CandlestickData[];
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
  moving_averages: Record<string, (number | null)[]>;
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

export type CompareChartMode = 'price' | 'index100' | 'cumulativeReturn';

export interface CompareMetricsRow {
  symbol: string;
  totalReturnPct: number | null;
  volatilityPct: number | null;
  maxDrawdownPct: number | null;
  winRatePct: number | null;
  maxDailyGainPct: number | null;
  maxDailyLossPct: number | null;
  avgVolume: number | null;
  avgAmount: number | null;
}

export interface DateRangeResponse {
  symbol: string;
  earliest_date: string;
  latest_date: string;
}

// ── News API Response Types ──

export interface News {
  news_id: number;
  title: string;
  content: string | null;
  related_stocks: string | null;
  publish_time: string | null;
  url: string | null;
  id: number;
  created_at: string;
  updated_at: string;
}

export interface PaginatedNewsResponse {
  page: number;
  page_size: number;
  total: number;
  items: News[];
}

// ── Auth Types ──

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

// ── Order Types ──

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit';
export type OrderStatus = 'pending' | 'filled' | 'cancelled';

export interface OrderRequest {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  price: number | null;
  quantity: number;
}

export interface OrderRecord {
  id: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  price: number | null;
  quantity: number;
  status: OrderStatus;
  estimatedAmount: number;
  createdAt: string;
}

// ── Simulated Order API (openapi: /simulated-orders) ──

export interface SimulatedOrderCreate {
  session_id: string;
  symbol: string;
  side: OrderSide;
  order_type: OrderType;
  quantity: number;
  /** 市價單勿送；限價時使用 */
  price?: number | string | null;
  trade_date?: string | null;
}

export interface SimulatedOrderResponse {
  id: string;
  session_id: string;
  symbol: string;
  side: OrderSide;
  order_type: OrderType;
  price: string | number | null;
  trade_date: string;
  quantity: number;
  status: OrderStatus;
  estimated_amount: number;
  created_at: string;
}

export interface SimulatedOrderListResponse {
  session_id: string;
  total: number;
  data: SimulatedOrderResponse[];
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
  session_id: string;
  total_orders: number;
  priced_orders: number;
  unpriced_orders: number;
  data?: SimulatedOrderCategoryProfitItem[];
}
