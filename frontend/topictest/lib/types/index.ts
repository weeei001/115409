// ── AI Analysis (kept from original) ──

import type {
  StockBehaviorAiProjection,
  StockBehaviorDataInventory,
} from './stockBehavior';

export type {
  ProjectionDirection,
  StockBehaviorAiProjection,
  StockBehaviorAiProjectionPoint,
  StockBehaviorDataInventory,
  StockBehaviorInventoryItem,
} from './stockBehavior';

export interface RAGSource {
  id: string;
  title: string;
  date: string;
  url?: string;
}

export interface AITrendAnalysis {
  conclusion: string;
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

export interface AdvisorReport {
  symbol: string;
  generated_at: string;
  summary: string;
  technical_signals: AdvisorTechnicalSignal[];
  recommendation: AdvisorAction;
  reasoning: string;
  risk_notes?: string | null;
  sources: AdvisorSource[];
  date_start?: string;
  date_end?: string;
  /** 後端操作建議原文（與三態 badge 不同） */
  recommendation_text?: string;
  /** 後端原始 N 日情境推演（D+1..D+N），由 mapper 透傳，供 UI 渲染 ProjectionTimeline */
  projection?: StockBehaviorAiProjection;
  /** 後端 AI 頂層 summary 原文，供 AISummaryCard 直接顯示 */
  ai_summary?: string;
  /** 後端 data_inventory 原文，供 EvidenceInventoryPanel 渲染證據卡 */
  data_inventory?: StockBehaviorDataInventory;
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

// ── Analyze news source (shared with stockBehavior) ──

export interface AnalyzeNewsSourceItem {
  id?: string;
  title?: string;
  summary?: string;
  timestamp?: string;
  url?: string | null;
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
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume_shares: number | null;
  amount: number | null;
  change: number | null;
  trades: number | null;
}

export interface HistoricalPriceList {
  symbol: string;
  start_date: string;
  end_date: string;
  total: number;
  data: DailyPriceResponse[];
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
  highest_price: number | null;
  lowest_price: number | null;
  average_close: number | null;
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

/** openapi: GET /stocks/{symbol}/date-range */
export interface DateRangeResponse {
  symbol: string;
  min_date: string;
  max_date: string;
}

/** openapi: InstitutionalTradeResponse */
export interface InstitutionalTradeApiRow {
  date: string;
  symbol: string;
  foreign_buy?: number | null;
  foreign_sell?: number | null;
  foreign_net?: number | null;
  investment_trust_buy?: number | null;
  investment_trust_sell?: number | null;
  investment_trust_net?: number | null;
  dealer_buy?: number | null;
  dealer_sell?: number | null;
  dealer_net?: number | null;
  total_institutional_buy?: number | null;
  total_institutional_sell?: number | null;
  total_institutional_net?: number | null;
}

/** openapi: InstitutionalTradeListResponse */
export interface InstitutionalTradeListApiResponse {
  symbol: string;
  start_date: string;
  end_date: string;
  total: number;
  data: InstitutionalTradeApiRow[];
}

/** openapi: TechnicalIndicatorResponse */
export interface TechnicalIndicatorApiRow {
  date: string;
  symbol: string;
  close?: string | null;
  ma5?: string | null;
  ma10?: string | null;
  ma20?: string | null;
  ma60?: string | null;
  ma120?: string | null;
  ma240?: string | null;
  rsi5?: string | null;
  rsi10?: string | null;
  rsv9?: string | null;
  kd_k9?: string | null;
  kd_d9?: string | null;
  kd_j9?: string | null;
  ema12?: string | null;
  ema26?: string | null;
  macd_dif?: string | null;
  macd_dea?: string | null;
  macd_signal?: string | null;
  macd_hist?: string | null;
  boll_mid20?: string | null;
  boll_upper20?: string | null;
  boll_lower20?: string | null;
  volume_ma5?: string | null;
}

/** openapi: ChipsVolumeChartResponse row */
export interface ChipsVolumeChartRow {
  date: string;
  close?: number | null;
  volume?: number | null;
  foreign_net?: number | null;
  investment_trust_net?: number | null;
  dealer_net?: number | null;
  total_institutional_net?: number | null;
}

export interface ChipsVolumeChartResponse {
  symbol: string;
  start_date: string;
  end_date: string;
  data: ChipsVolumeChartRow[];
}

/** openapi: TechnicalIndicatorListResponse */
export interface TechnicalIndicatorListApiResponse {
  symbol: string;
  start_date: string;
  end_date: string;
  total: number;
  data: TechnicalIndicatorApiRow[];
}

// ── News API Response Types ──

export interface News {
  article_id: string;
  source: string | null;
  source_group: string | null;
  stock_id: string | null;
  title: string | null;
  content: string | null;
  pub_time: string | null;
  url: string | null;
  tags: string | null;
  created_at: string | null;
}

export interface PaginatedNewsResponse {
  page: number;
  page_size: number;
  total: number;
  items: News[];
}

// ── Order Types ──

export type OrderSide = 'buy' | 'sell';
export type OrderStatus = 'pending' | 'filled' | 'cancelled';

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

export type {
  InstitutionalDayRow,
  InstitutionalTradeListResponse,
  InstitutionalTradeResponse,
  TechnicalIndicatorDayRow,
  TechnicalIndicatorListResponse,
  TechnicalIndicatorResponse,
} from './stockDashboard';

