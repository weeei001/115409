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
  /** RAG 串流：後端 `type: "status"` 的即時狀態列（思考／搜尋中等） */
  streamStatus?: string;
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

export interface ScoreWeights {
  technical: number;
  institutional: number;
  news: number;
  momentum: number;
}

export interface ScoreExplanations {
  technical: string;
  institutional: string;
  news: string;
  momentum: string;
}

export interface ScoreBreakdown {
  technical_score: number;
  institutional_score: number;
  news_score: number;
  momentum_score: number;
  weighted_score: number;
  weights: ScoreWeights;
  explanations: ScoreExplanations;
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
  /** 後端加權模型分數明細 */
  score_breakdown?: ScoreBreakdown;
  /** 三大法人逐日明細（與卡片最新一日並列） */
  institutional_rows?: AnalyzeInstitutionalRow[];
}

export type AdvisorStepKey = 'institutional' | 'news' | 'cross_check' | 'final';
export type AdvisorStepStatus = 'pending' | 'running' | 'done' | 'error';

export interface AdvisorStepUpdate {
  request_id: string;
  step_key: AdvisorStepKey;
  step_label?: string;
  status: AdvisorStepStatus;
  message?: string;
}

export type AdvisorPartialDataset =
  | 'institutional'
  | 'prices'
  | 'indicators'
  | 'quick_insights'
  | 'news';

export interface AdvisorPartialDataEvent {
  request_id: string;
  step_key: AdvisorStepKey;
  dataset: AdvisorPartialDataset;
  summary?: Record<string, unknown>;
  preview?: Record<string, unknown>[];
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
  score_breakdown?: ScoreBreakdown;
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
  score_breakdown?: ScoreBreakdown;
  news_sources?: AnalyzeNewsSourceItem[];
  fallback_mode?: boolean;
  raw_answer?: string;
  status?: string;
}

/** POST /analyze/report */
export interface AnalyzeReportResponse extends AnalyzeFinalResponse {
  quick_points?: string[];
  quick_fallback_mode?: boolean;
  institutional_data?: AnalyzeInstitutionalRow[];
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

export interface MessageResponse {
  message: string;
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

export interface BulkSelectResult {
  added: string[];
  duplicates: string[];
  invalid: string[];
  overflow: string[];
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

export interface CompareInsightCard {
  id: 'bestReturn' | 'minDrawdown' | 'minVolatility' | 'lowestCorrelationPair';
  title: string;
  symbol: string;
  value: string;
  reason: string;
}

export interface CompareAnalysisRange {
  startDate: string;
  endDate: string;
}

export interface CompareQualityMeta {
  analysisRange: CompareAnalysisRange;
  alignedDays: number;
  samplesBySymbol: Record<string, number>;
  missingRatioBySymbol: Record<string, number>;
  generatedAt: string;
  qualityWarnings: string[];
}

export interface CompareViewModel {
  metricsRows: CompareMetricsRow[];
  correlationMatrix: Record<string, Record<string, number | null>>;
  insights: CompareInsightCard[];
  qualityMeta: CompareQualityMeta;
  symbolColors: Record<string, string>;
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
export type OrderStatus = 'pending' | 'filled' | 'cancelled';

export interface OrderRequest {
  symbol: string;
  side: OrderSide;
  quantity: number;
}

export interface OrderRecord {
  id: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  status: OrderStatus;
  estimatedAmount: number;
  createdAt: string;
}

// ── Simulated Order API (openapi: /simulated-orders) ──

export type SimulatedSellPlan = 'long_term' | 'by_date';

export interface SimulatedOrderCreate {
  user_id: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  trade_date?: string | null;
  /** 預設長期持有；指定賣出日時需帶 planned_sell_date */
  sell_plan?: SimulatedSellPlan;
  planned_sell_date?: string | null;
}

export interface SimulatedOrderResponse {
  id: string;
  user_id: string;
  symbol: string;
  side: OrderSide;
  trade_date: string;
  quantity: number;
  /** 買進才有；賣出為 null */
  sell_plan: SimulatedSellPlan | null;
  planned_sell_date: string | null;
  status: OrderStatus;
  estimated_amount: number;
  /** 試算依據：latest=最新收盤；planned_sell=預計賣出日收盤；fifo_realized=賣出實現損益（FIFO 配對買進） */
  markup_basis?: 'latest' | 'planned_sell' | 'fifo_realized' | null;
  reference_date?: string | null;
  reference_close?: number | null;
  /** 試算損益（元） */
  markup_amount?: number | null;
  /** 試算收益率（%） */
  markup_rate?: number | null;
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
