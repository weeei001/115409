import type { ForwardViewKey } from '../types/textBrief';

/**
 * text-brief 回應裡列舉值 → 中文標籤。
 * DEMO 頁與個股頁的 AI 分析抽屜共用，避免同一組列舉在兩邊各翻一次。
 */

export const STANCE: Record<string, string> = {
  bullish: '偏多',
  mildly_bullish: '偏多（溫和）',
  mixed: '多空交雜',
  neutral: '中性整理',
  mildly_bearish: '偏空（溫和）',
  bearish: '偏空',
  uncertain: '資料不足',
};

/** 語意色調；各頁再自行對應到自己的樣式（DEMO 用 CSS module，個股頁用 Tailwind token） */
export type BriefTone = 'ok' | 'warn' | 'bad' | 'info' | 'plain';

export const STANCE_TONE: Record<string, BriefTone> = {
  bullish: 'ok',
  mildly_bullish: 'ok',
  mixed: 'warn',
  neutral: 'plain',
  mildly_bearish: 'bad',
  bearish: 'bad',
  uncertain: 'plain',
};

export const CONF: Record<string, string> = { low: '低', medium: '中', high: '高' };

export const STATUS: Record<string, [BriefTone, string]> = {
  verified: ['ok', '全部通過檢查'],
  limited: ['warn', '有幾項被系統修正過'],
  unavailable: ['bad', '這次沒有產出結果'],
};

export const FIELD: Record<string, string> = {
  daily_timeline: '交易日',
  high_1y: '近一年最高',
  low_1y: '近一年最低',
  close_pos_in_1y_pct: '在近一年區間的位置',
  vs_ma60_pct: '相對季線',
  vs_ma240_pct: '相對年線',
  eps: '每股盈餘',
  gross_margin_pct: '毛利率',
  operating_margin_pct: '營業利益率',
  revenue_monthly: '單月營收',
  revenue_yoy_positive_streak: '月營收年增連續月數',
  per: '本益比',
  pbr: '股價淨值比',
  dividend_yield: '現金殖利率',
  news: '新聞',
};

/** 證據目錄的分組，依 id 前綴 */
export const GROUP: [string, (id: string) => boolean][] = [
  ['交易日資料', (id) => id.startsWith('d_')],
  ['長期位置', (id) => id.startsWith('lt_')],
  ['基本面', (id) => id.startsWith('fd_')],
  ['新聞', (id) => id.startsWith('nw_')],
];

export const FORWARD_VIEWS: [ForwardViewKey, string][] = [
  ['short_1_5', '短線　1–5 交易日'],
  ['swing_6_20', '波段　6–20 交易日'],
  ['medium_21_40', '中期　21–40 交易日'],
];
