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
export const paperMoney = (value: number | null | undefined) => value == null ? '等待行情' : value.toLocaleString('zh-TW', { maximumFractionDigits: 2 });
export const paperStatus = (status: PaperOrder['status']) => ({ pending: '待成交', filled: '已成交', cancelled: '已取消' })[status];
export const paperDateTime = (value: string | null | undefined) => formatTaipei(value, { hour12: false }, '尚未更新');
export function paperDiscussion(symbol: string, orderId?: string) {
  return { pathname: '/ai', query: { prompt: orderId
    ? `請回顧我的模擬交易 ${orderId}（${symbol}），比較原始理由、觀察重點與最新證據，說明損益與同期大盤的比較限制。請先讀取我的模擬投資帳戶。`
    : `請讀取我的模擬投資帳戶，分析 ${symbol} 持股現況，對照當初買進理由與最新資料，說明哪些理由仍成立。` } };
}
