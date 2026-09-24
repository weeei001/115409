/**
 * 畫面用的資料形狀：由 lib/mappers 把 API 回應轉好（數字已轉成 number、日期已排序）。
 * 欄位名稱一律沿用 openapi 原名（決議 c50），不另外改名。
 */

export interface DailyQuote {
  date: string;
  symbol: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  change: number | null;
  volume_shares: number | null;
  amount: number | null;
  trades: number | null;
}

export interface PriceStats {
  start_date: string;
  end_date: string;
  highest_price: number | null;
  lowest_price: number | null;
  average_close: number | null;
  total_volume: number | null;
  total_amount: number | null;
  trading_days: number;
}

export interface InstitutionalDay {
  date: string;
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

export interface TechnicalDay {
  date: string;
  close: number | null;
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  ma60: number | null;
  ma120: number | null;
  ma240: number | null;
  rsi5: number | null;
  rsi10: number | null;
  rsv9: number | null;
  kd_k9: number | null;
  kd_d9: number | null;
  kd_j9: number | null;
  ema12: number | null;
  ema26: number | null;
  macd_dif: number | null;
  macd_dea: number | null;
  macd_signal: number | null;
  macd_hist: number | null;
  boll_mid20: number | null;
  boll_upper20: number | null;
  boll_lower20: number | null;
  volume_ma5: number | null;
}

export interface ChartCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface ChartPoint {
  time: string;
  value: number | null;
}

export const MA_KEYS = ['MA5', 'MA10', 'MA20', 'MA60'] as const;
export type MaKey = (typeof MA_KEYS)[number];

export interface PriceChartData {
  candles: ChartCandle[];
  volume: Array<{ time: string; value: number }>;
  overlays: Record<MaKey, ChartPoint[]>;
}
