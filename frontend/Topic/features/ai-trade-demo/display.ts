import type { TradeSide } from './derive';

/** 只翻譯實測確認過的 action；其他值照後端原字串顯示，不猜意思 */
const ACTION_LABELS: Record<string, string> = { buy: '買進' };

export const actionLabel = (action: string) => ACTION_LABELS[action] ?? action;

/** next_open 的說明取自 done.metrics.note 的原文 */
const EXECUTION_LABELS: Record<string, string> = { next_open: '決策日收盤後判斷、次一交易日開盤成交' };

export const executionLabel = (execution: string) => EXECUTION_LABELS[execution];

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 元，四捨五入到整數、加千分位 */
export function fmtMoney(v: number | null | undefined, fallback = '--'): string {
  return isNum(v) ? v.toLocaleString('zh-TW', { maximumFractionDigits: 0 }) : fallback;
}

/** 股數，加千分位 */
export function fmtShares(v: number | null | undefined, fallback = '--'): string {
  return isNum(v) ? Math.round(v).toLocaleString('zh-TW') : fallback;
}

/** 0～1 的比例 → 百分比，最多一位小數（0.4 → 40%） */
export function fmtRatioPct(v: number | null | undefined, fallback = '--'): string {
  return isNum(v) ? `${Number((v * 100).toFixed(1))}%` : fallback;
}

/** 依數值正負上色（台股紅漲綠跌）；0 與缺值中性 */
export function signToneClass(v: number | null | undefined): string {
  if (!isNum(v) || v === 0) return 'text-foreground';
  return v > 0 ? 'text-up' : 'text-down';
}

/** 買點 up、賣點 down */
export function sideToneClass(side: TradeSide | null): string {
  if (side === 'buy') return 'border-up/40 bg-up-muted text-up';
  if (side === 'sell') return 'border-down/40 bg-down-muted text-down';
  return 'border-border bg-muted text-subtle';
}

/** tooltip 用的理由摘要 */
export function excerpt(text: string, max = 60): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 放進 ECharts tooltip（HTML 字串）前先跳脫；reason 是 LLM 產生的文字 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}
