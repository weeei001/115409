import apiClient from './client';
import { getToken } from '../auth/storage';
import { formatTaipei } from '../utils/date';

export interface PaperDraft {
  symbol: string;
  side: 'buy' | 'sell';
  budget?: number | null;
  quantity?: number | null;
  reason: string;
  observation: string;
  review_after_days: number;
  conversation_id?: string | null;
}
/** 以下回應型別 openapi 未列（/paper-portfolio 沒有 response_model），依後端 paper_portfolio/service.py 的 snapshot／_order（決議 F2） */
export interface PaperOrder extends PaperDraft {
  id: string;
  client_request_id: string;
  status: 'pending' | 'filled' | 'cancelled';
  filled_quantity: number | null;
  fill_price: number | null;
  fee: number | null;
  tax: number | null;
  created_at: string;
  trade_date: string | null;
  review_due_date?: string | null;
  review_elapsed_days?: number | null;
  review_remaining_days?: number | null;
  pending_reason?: string | null;
}
export interface PaperPosition {
  symbol: string;
  quantity: number;
  reserved_quantity: number;
  average_cost: number;
  market_price: number | null;
  market_date: string | null;
  market_value: number | null;
  unrealized_pnl: number | null;
}
export interface PaperReview {
  id: string;
  order_id: string;
  symbol: string;
  status: 'due' | 'reviewed';
  reason: string;
  observation: string;
  opened_date: string;
  due_date: string;
  review_after_days: number;
  entry_price?: number | null;
  closing_price?: number | null;
  price_return_pct?: number | null;
  benchmark_return_pct?: number | null;
  comparison_note?: string;
}
export interface PaperPortfolio {
  initialized: boolean;
  total_deposits: number;
  total_withdrawals: number;
  net_contributions: number;
  total_pnl: number | null;
  fund_movements: PaperFundMovement[];
  initial_cash: number;
  cash: number;
  available_cash: number;
  reserved_cash: number;
  equity: number | null;
  realized_pnl: number;
  unrealized_pnl: number | null;
  as_of: string | null;
  positions: PaperPosition[];
  orders: PaperOrder[];
  reviews: PaperReview[];
  accounting_note?: string;
}
export interface PaperFundMovement {
  id: string;
  kind: 'initial' | 'deposit' | 'withdrawal';
  amount: number;
  created_at: string;
}
export async function changePaperFunds(kind: PaperFundMovement['kind'], amount: number, clientRequestId: string) {
  const owner = getToken() ?? '';
  const result = (await apiClient.post<PaperPortfolio>('/paper-portfolio/funds', { kind, amount, client_request_id: clientRequestId })).data;
  inFlight.delete(owner);
  return result;
}
const inFlight = new Map<string, Promise<PaperPortfolio>>();
export async function fetchPaperPortfolio(signal?: AbortSignal) {
  const owner = getToken() ?? '';
  let request = inFlight.get(owner);
  if (!request) {
    request = apiClient.get<PaperPortfolio>('/paper-portfolio').then((response) => response.data);
    inFlight.set(owner, request);
    void request.finally(() => { if (inFlight.get(owner) === request) inFlight.delete(owner); }).catch(() => undefined);
  }
  const data = await request;
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return data;
}
export async function createPaperOrder(draft: PaperDraft, clientRequestId: string) {
  const owner = getToken() ?? '';
  const result = (await apiClient.post<PaperOrder>('/paper-portfolio/orders', { ...draft, client_request_id: clientRequestId })).data;
  inFlight.delete(owner);
  return result;
}
export async function cancelPaperOrder(id: string) {
  const owner = getToken() ?? '';
  const result = (await apiClient.post<PaperOrder>(`/paper-portfolio/orders/${encodeURIComponent(id)}/cancel`)).data;
  inFlight.delete(owner);
  return result;
}
export async function acknowledgePaperReview(id: string) {
  const owner = getToken() ?? '';
  const result = (await apiClient.post(`/paper-portfolio/reviews/${encodeURIComponent(id)}/acknowledge`)).data;
  inFlight.delete(owner);
  return result;
}
/**
 * 模擬下單的估算（P1-30）：和後端成交規則同一組費率與算法（backend paper_portfolio/service.py：
 * 手續費 0.1425%、證券交易稅 0.3% 只在賣出時收、金額計算到分；買進股數＝預算扣掉手續費後買得起的整數股）。
 * 只用最近收盤價估算，實際依下一交易日收盤價成交，所以畫面上一律寫「約」。
 */
export const PAPER_FEE_RATE = 0.001425;
export const PAPER_TAX_RATE = 0.003;
const cents = (value: number) => Math.round(value * 100) / 100;

export function estimatePaperBuy(budget: number, price: number): { quantity: number; fee: number; cost: number } | null {
  if (!(budget > 0) || !(price > 0) || !Number.isFinite(budget) || !Number.isFinite(price)) return null;
  const total = (qty: number) => price * qty + cents(price * qty * PAPER_FEE_RATE);
  let quantity = Math.floor(budget / (price * (1 + PAPER_FEE_RATE)));
  if (total(quantity + 1) <= budget) quantity += 1;
  while (quantity > 0 && total(quantity) > budget) quantity -= 1;
  const fee = cents(price * quantity * PAPER_FEE_RATE);
  return { quantity, fee, cost: cents(price * quantity + fee) };
}

export function estimatePaperSell(quantity: number, price: number): { fee: number; tax: number; proceeds: number } | null {
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || !(price > 0) || !Number.isFinite(price)) return null;
  const fee = cents(price * quantity * PAPER_FEE_RATE);
  const tax = cents(price * quantity * PAPER_TAX_RATE);
  return { fee, tax, proceeds: cents(price * quantity - fee - tax) };
}

/**
 * 「與 AI 討論」的預設問題（P1-32）：AI 只做研究整理、不給買賣建議（2026-10-06 決定），
 * 所以請它整理現況與資料，不請它「討論下一步投資安排」。
 */
export const PAPER_PORTFOLIO_PROMPT = '請整理我的模擬投資現況（可用資金、持股、收藏股）和相關資料。';

/** 持股報酬率（%）：未實現損益 ÷ 持股成本（平均成本 × 股數）；缺行情或成本為 0 時是 null（P2-119） */
export function positionReturnPct(position: Pick<PaperPosition, 'quantity' | 'average_cost' | 'unrealized_pnl'>): number | null {
  const basis = position.average_cost * position.quantity;
  if (position.unrealized_pnl == null || !Number.isFinite(position.unrealized_pnl) || !(basis > 0)) return null;
  return (position.unrealized_pnl / basis) * 100;
}

/** 金額欄位：有數字才接「元」，缺值只寫「等待行情」（P2-124） */
export const paperMoneyWithUnit = (value: number | null | undefined) => (value == null ? '等待行情' : `${paperMoney(value)} 元`);

export const paperMoney = (value: number | null | undefined) => value == null ? '等待行情' : value.toLocaleString('zh-TW', { maximumFractionDigits: 2 });
export const paperStatus = (status: PaperOrder['status']) => ({ pending: '待成交', filled: '已成交', cancelled: '已取消' })[status];
export const paperDateTime = (value: string | null | undefined) => formatTaipei(value, { hour12: false }, '尚未更新');
export function paperDiscussion(symbol: string, orderId?: string) {
  return { pathname: '/ai', query: { prompt: orderId
    ? `請回顧我的模擬交易 ${orderId}（${symbol}），比較原始理由、觀察重點與最新證據，說明損益與同期大盤的比較限制。請先讀取我的模擬投資帳戶。`
    : `請讀取我的模擬投資帳戶，分析 ${symbol} 持股現況，對照當初買進理由與最新資料，說明哪些理由仍成立。` } };
}
