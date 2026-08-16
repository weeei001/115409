import type { ForwardViewKey, VerificationKey } from '../../../lib/demo/textBriefTypes';

/** 下拉選單裡的股票；`name` 供「新聞有沒有提到本檔」的字面比對使用 */
export const SYMBOLS: { value: string; name: string }[] = [
  { value: '2330', name: '台積電' },
  { value: '2317', name: '鴻海' },
  { value: '2454', name: '聯發科' },
  { value: '2881', name: '富邦金' },
  { value: '2408', name: '南亞科' },
  { value: '2615', name: '萬海' },
];

export const SYM_NAME: Record<string, string> = Object.fromEntries(
  SYMBOLS.map((s) => [s.value, s.name]),
);

export const STANCE: Record<string, string> = {
  bullish: '偏多',
  mildly_bullish: '偏多（溫和）',
  mixed: '多空交雜',
  neutral: '中性整理',
  mildly_bearish: '偏空（溫和）',
  bearish: '偏空',
  uncertain: '資料不足',
};

export const STANCE_TONE: Record<string, string> = {
  bullish: 'ok',
  mildly_bullish: 'ok',
  mixed: 'warn',
  neutral: 'plain',
  mildly_bearish: 'bad',
  bearish: 'bad',
  uncertain: 'plain',
};

export const CONF: Record<string, string> = { low: '低', medium: '中', high: '高' };

export const STATUS: Record<string, [string, string]> = {
  verified: ['ok', '全部通過檢查'],
  limited: ['warn', '有幾項被系統修正過'],
  unavailable: ['bad', '這次沒有產出結果'],
};

export const STATUS_TONE: Record<string, string> = {
  verified: 'ok',
  limited: 'warn',
  unavailable: 'bad',
  unknown: 'plain',
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

/** 系統檢查結果的十個項目：全部為空才是 `verified` */
export const VERIFY: [VerificationKey, string][] = [
  ['filtered_evidence_ids', '引用了不存在的資料，已刪掉'],
  ['removed_item_ids', '違反法規限制，整項拿掉'],
  ['compliance_violations', '寫出不能講的話'],
  ['soft_compliance_hits', '用字太接近不能講的話'],
  ['unverified_numbers', '數字跟原始資料對不起來'],
  ['future_dated_items', '日期比分析日還晚，已剔除'],
  ['undercount_sections', '寫得比預期少'],
  ['truncated_sections', '寫太多，超過的已截掉'],
  ['simplified_chars', '出現簡體字'],
  ['jargon_hits', '出現難懂的術語'],
];

export const FORWARD_VIEWS: [ForwardViewKey, string][] = [
  ['short_1_5', '短線　1–5 交易日'],
  ['swing_6_20', '波段　6–20 交易日'],
  ['medium_21_40', '中期　21–40 交易日'],
];

/** 進度提示的四個階段；依實測耗時推估，不是後端即時回報 */
export const STAGES = ['找新聞', '整理資料', 'AI 撰寫', '系統檢查'];

/** 固定的模型配色；依「本次載入到的模型名稱排序後的位置」指派，同一批資料每次都一樣 */
export const MODEL_COLORS = [
  '#1d4ed8',
  '#0f7b4f',
  '#b3261e',
  '#8a5300',
  '#7c3aed',
  '#0e7490',
  '#be185d',
  '#4d7c0f',
];

export const UNKNOWN_MODEL = '未知';
