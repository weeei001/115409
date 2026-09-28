import type {
  SimBaselineBuyAndHold,
  SimDayEvent,
  SimEvent,
  SimHindsightBounds,
  SimInitEvent,
  SimMetrics,
} from './types';

/** 認得 type、但欄位缺漏或型別不符的事件；畫面會提示略過幾筆 */
export interface SimInvalidEvent {
  type: 'invalid';
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const num = (v: unknown) => (isNum(v) ? v : null);
const optStr = (v: unknown) => (isStr(v) ? v : undefined);
const optNum = (v: unknown) => (isNum(v) ? v : undefined);

const DAY_NUMBER_KEYS = [
  'buy_pct',
  'sell_pct',
  'executed_shares',
  'cost',
  'close_price',
  'cash_after',
  'shares_after',
  'portfolio_value',
] as const;

function parseInit(o: Obj): SimInitEvent | SimInvalidEvent {
  if (!isStr(o.stock_id) || !isNum(o.n_trading_days) || !isNum(o.initial_cash) || !isNum(o.confidence)) {
    return { type: 'invalid' };
  }
  return {
    type: 'init',
    stock_id: o.stock_id,
    n_trading_days: o.n_trading_days,
    initial_cash: o.initial_cash,
    confidence: o.confidence,
    cached: typeof o.cached === 'boolean' ? o.cached : undefined,
    provider: optStr(o.provider),
    model: optStr(o.model),
    execution: optStr(o.execution),
  };
}

function parseDay(o: Obj): SimDayEvent | SimInvalidEvent {
  if (!isStr(o.date) || !isStr(o.action) || !isStr(o.reason)) return { type: 'invalid' };
  if (!DAY_NUMBER_KEYS.every((key) => isNum(o[key]))) return { type: 'invalid' };
  const n = o as Record<(typeof DAY_NUMBER_KEYS)[number], number>;
  return {
    type: 'day',
    date: o.date,
    action: o.action,
    buy_pct: n.buy_pct,
    sell_pct: n.sell_pct,
    executed_shares: n.executed_shares,
    cost: n.cost,
    close_price: n.close_price,
    cash_after: n.cash_after,
    shares_after: n.shares_after,
    portfolio_value: n.portfolio_value,
    reason: o.reason,
    decision_date: optStr(o.decision_date),
    decision_price: optNum(o.decision_price),
    exec_price: optNum(o.exec_price),
  };
}

function parseBaseline(v: unknown): SimBaselineBuyAndHold | null {
  if (!isObj(v)) return null;
  return { shares: num(v.shares), final_value: num(v.final_value), total_return_pct: num(v.total_return_pct) };
}

function parseHindsight(v: unknown): SimHindsightBounds | null {
  if (!isObj(v)) return null;
  return {
    best_return_pct: num(v.best_return_pct),
    best_n_trades: num(v.best_n_trades),
    worst_return_pct: num(v.worst_return_pct),
    worst_n_trades: num(v.worst_n_trades),
    span_pct: num(v.span_pct),
    percentile: num(v.percentile),
    buy_and_hold_percentile: num(v.buy_and_hold_percentile),
  };
}

/** 只讀實測確認過的 key，其餘忽略 */
export function parseMetrics(v: unknown): SimMetrics {
  const o = isObj(v) ? v : {};
  return {
    n_trading_days: num(o.n_trading_days),
    initial_cash: num(o.initial_cash),
    final_portfolio_value: num(o.final_portfolio_value),
    total_return_pct: num(o.total_return_pct),
    annualized_return_pct: num(o.annualized_return_pct),
    annualized_is_extrapolated: typeof o.annualized_is_extrapolated === 'boolean' ? o.annualized_is_extrapolated : null,
    max_drawdown_pct: num(o.max_drawdown_pct),
    trade_count: num(o.trade_count),
    sell_count: num(o.sell_count),
    win_count: num(o.win_count),
    win_rate_pct: num(o.win_rate_pct),
    realized_pnl: num(o.realized_pnl),
    unrealized_pnl: num(o.unrealized_pnl),
    total_pnl: num(o.total_pnl),
    hindsight_bounds: parseHindsight(o.hindsight_bounds),
    baseline_buy_and_hold: parseBaseline(o.baseline_buy_and_hold),
    note: isStr(o.note) && o.note.trim() ? o.note : null,
  };
}

/**
 * 一個 SSE 事件的 data（JSON 字串）→ 事件。
 * 不是 JSON 物件算 invalid；type 不認得回傳 null（直接忽略）。
 */
export function parseSimEvent(data: string): SimEvent | SimInvalidEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return { type: 'invalid' };
  }
  if (!isObj(raw)) return { type: 'invalid' };
  // 實測：命中快取時 init 事件沒有 type 欄位（其餘事件都有），靠 init 專屬欄位辨認
  if (raw.type === undefined && 'stock_id' in raw && 'n_trading_days' in raw) return parseInit(raw);
  switch (raw.type) {
    case 'init':
      return parseInit(raw);
    case 'day':
      return parseDay(raw);
    case 'done':
      return { type: 'done', metrics: parseMetrics(raw.metrics) };
    case 'error':
      return {
        type: 'error',
        message: isStr(raw.message) && raw.message.trim() ? raw.message.trim() : '後端回報錯誤，但沒有附上訊息。',
      };
    default:
      return null;
  }
}
