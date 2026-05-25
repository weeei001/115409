/** 個股儀表板視圖模型（可由 advisor overview 映射，待 OpenAPI 補齊 REST 後可改資料源） */

export interface InstitutionalDayRow {
  date: string;
  foreign_buy: number | null;
  foreign_sell: number | null;
  foreign_excl_dealer_net: number | null;
  investment_trust_buy: number | null;
  investment_trust_sell: number | null;
  investment_trust_net: number | null;
  dealer_buy: number | null;
  dealer_sell: number | null;
  dealer_net_total: number | null;
  total_institutional_buy: number | null;
  total_institutional_sell: number | null;
  total_net: number | null;
}

export interface InstitutionalTradeListResponse {
  symbol: string;
  start_date?: string;
  end_date?: string;
  data: InstitutionalDayRow[];
}

export interface InstitutionalTradeResponse {
  symbol: string;
  date: string;
  stock_name?: string | null;
  foreign_buy: number | null;
  foreign_sell: number | null;
  foreign_excl_dealer_net: number | null;
  investment_trust_buy: number | null;
  investment_trust_sell: number | null;
  investment_trust_net: number | null;
  dealer_buy: number | null;
  dealer_sell: number | null;
  dealer_net_total: number | null;
  total_institutional_buy: number | null;
  total_institutional_sell: number | null;
  total_net: number | null;
}

export interface TechnicalIndicatorDayRow {
  date: string;
  ma5?: number | null;
  ma10?: number | null;
  ma20?: number | null;
  ma60?: number | null;
  ma120?: number | null;
  ma240?: number | null;
  rsi5?: number | null;
  rsi10?: number | null;
  rsv9?: number | null;
  kd_k9?: number | null;
  kd_d9?: number | null;
  kd_j9?: number | null;
  ema12?: number | null;
  ema26?: number | null;
  macd_dif?: number | null;
  macd_dea?: number | null;
  macd_signal?: number | null;
  macd_hist?: number | null;
  boll_mid20?: number | null;
  boll_upper20?: number | null;
  boll_lower20?: number | null;
  volume_ma5?: number | null;
}

export interface TechnicalIndicatorListResponse {
  symbol: string;
  start_date?: string;
  end_date?: string;
  data: TechnicalIndicatorDayRow[];
}

export interface TechnicalIndicatorResponse {
  symbol: string;
  date: string;
  rsi5?: number | null;
  rsi10?: number | null;
  macd_hist?: number | null;
}
