/**
 * AI 模擬下單 Demo：GET /api/simulate_trading_stream 的 SSE 事件。
 * 依據：同資料夾的 openapi2.json（端點 description 內的事件清單），
 * 以及 2026-09-28 實測（2330、2026-08-27～2026-09-02、initial_cash 1000000、confidence 5）。
 * 實測沒出現過的值（例如 buy 以外的 action）一律不列舉。
 */

/** 送出的五個查詢參數；五個都相同時後端會重放快取 */
export interface SimulateParams {
  symbol: string;
  /** YYYY-MM-DD */
  start: string;
  /** YYYY-MM-DD */
  end: string;
  initialCash: number;
  /** 整數 1（保守）～10（激進） */
  confidence: number;
}

export interface SimInitEvent {
  /** 實測：命中快取時後端送來的 init 沒有 type，解析時補上（events.ts） */
  type: 'init';
  stock_id: string;
  n_trading_days: number;
  initial_cash: number;
  confidence: number;
  /** 命中快取時才會帶 */
  cached?: boolean;
  /** spec 未列、實測回應有（例："h200"） */
  provider?: string;
  /** spec 未列、實測回應有（例："Gemma4-31B"） */
  model?: string;
  /** spec 未列、實測回應有（例："next_open"） */
  execution?: string;
}

export interface SimDayEvent {
  type: 'day';
  /** 實測為成交日：decision_date 的下一個交易日 */
  date: string;
  /** 實測只出現過 "buy"，其他值未確認 */
  action: string;
  /** 0～1 的比例（實測 0.4、0.3） */
  buy_pct: number;
  /** 0～1 的比例 */
  sell_pct: number;
  executed_shares: number;
  /** 實測買進時為含手續費的成交金額 */
  cost: number;
  /** date 當日收盤價 */
  close_price: number;
  cash_after: number;
  shares_after: number;
  /** 實測 = cash_after + shares_after × close_price */
  portfolio_value: number;
  reason: string;
  /** spec 未列、實測回應有：做決策的交易日 */
  decision_date?: string;
  /** spec 未列、實測回應有：decision_date 的收盤價 */
  decision_price?: number;
  /** spec 未列、實測回應有：後端的成交價 */
  exec_price?: number;
}

/** metrics.baseline_buy_and_hold（實測確認的 key） */
export interface SimBaselineBuyAndHold {
  shares: number | null;
  final_value: number | null;
  total_return_pct: number | null;
}

/**
 * metrics.hindsight_bounds（實測確認的 key）。
 * 只做型別、不上畫面：percentile 是 0～100 的相對位置，不是標準績效指標。
 */
export interface SimHindsightBounds {
  best_return_pct: number | null;
  best_n_trades: number | null;
  worst_return_pct: number | null;
  worst_n_trades: number | null;
  span_pct: number | null;
  percentile: number | null;
  buy_and_hold_percentile: number | null;
}

/**
 * done.metrics：spec 只寫 `{...}`，以下 key 全部來自實測。
 * 百分比欄位（*_pct）已是百分點（-1.08 代表 -1.08%）。缺漏或型別不符時為 null。
 */
export interface SimMetrics {
  n_trading_days: number | null;
  initial_cash: number | null;
  final_portfolio_value: number | null;
  total_return_pct: number | null;
  annualized_return_pct: number | null;
  /** 區間太短時年化是外推值（實測 5 日為 true） */
  annualized_is_extrapolated: boolean | null;
  /** 正數，代表跌幅 */
  max_drawdown_pct: number | null;
  trade_count: number | null;
  sell_count: number | null;
  win_count: number | null;
  /** 實測沒有賣出時為 null */
  win_rate_pct: number | null;
  realized_pnl: number | null;
  unrealized_pnl: number | null;
  total_pnl: number | null;
  hindsight_bounds: SimHindsightBounds | null;
  baseline_buy_and_hold: SimBaselineBuyAndHold | null;
  /** 後端的方法說明文字 */
  note: string | null;
}

export interface SimDoneEvent {
  type: 'done';
  metrics: SimMetrics;
}

export interface SimErrorEvent {
  type: 'error';
  message: string;
}

export type SimEvent = SimInitEvent | SimDayEvent | SimDoneEvent | SimErrorEvent;
