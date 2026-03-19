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
