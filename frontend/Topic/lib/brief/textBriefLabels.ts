import type { ClaimType, ForwardView, ForwardViewKey } from '../types/textBrief';

/**
 * text-brief 回應裡列舉值 → 中文標籤。
 * 摘要卡與完整分析共用，避免同一組列舉在兩邊各翻一次。
 */

/**
 * 後端自動檢查結果（status）的說明。只有 limited 需要提示：verified 照常顯示，
 * unavailable 時沒有 brief，由各元件的空狀態處理。原因列在「分析限制」（limitations）。
 */
export function briefStatusNote(status: string | undefined): string | null {
  return status === 'limited' ? '部分內容沒有通過系統檢查或缺少資料，已移除或留空' : null;
}

export const STANCE: Record<string, string> = {
  bullish: '偏多',
  mildly_bullish: '溫和偏多',
  mixed: '多空交雜',
  neutral: '中性整理',
  mildly_bearish: '溫和偏空',
  bearish: '偏空',
  uncertain: '資料不足',
};

/**
 * 各立場的判定方式（P2-018），照後端分析提示詞的定義寫成白話（backend analysis/prompts.py「四、方向與期間」）。
 * 立場是 AI 的方向判讀，不是評級，也不是買賣建議。
 */
export const STANCE_HINT: Record<string, string> = {
  bullish: '方向證據明確、互相支持，主要反證已交代。',
  mildly_bullish: '證據偏向上漲一側，但仍有具體限制。',
  mixed: '有會影響結論的相反證據，多空並存。',
  neutral: '現有資料支持盤整，不是資料不足。',
  mildly_bearish: '證據偏向下跌一側，但仍有具體限制。',
  bearish: '方向證據明確、互相支持，主要反證已交代。',
  uncertain: '缺少可以判斷方向的有效依據。',
};

export const STANCE_NOTE = 'AI 依行情、籌碼、營運與新聞推論的方向，不是評級，也不是買賣建議。';

/** 單一結論的方向（Claim.direction）；畫面上另外配＋／－ 符號（BriefAtoms 的 DirectionMark），不只靠顏色 */
export const DIRECTION: Record<string, string> = {
  positive: '正面',
  negative: '負面',
  mixed: '多空交雜',
  neutral: '中性',
  not_applicable: '不適用',
};

export function forwardViewLabel(view: ForwardView): string {
  return view.validation_status === 'rejected'
    ? '內容未通過檢查'
    : (STANCE[view.stance] ?? view.stance);
}

/** 語意色調；各頁再自行對應到自己的樣式 */
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

/**
 * `confidence` 是「模型對自己這份判斷的信心」，不是資料完整度。
 * 兩者語意不同，畫面上不可混用；資料完整度要另有欄位才顯示。
 */
export const CONF: Record<string, string> = { low: '低', medium: '中', high: '高' };

export const CONF_HINT = 'AI 自評的信心，資料或內容有缺漏時會調降；不是勝率，也不代表內容已證實。';

/**
 * 結論性質 → 標籤。observation 是有證據的觀察，不加標籤；
 * 其餘三種一定要標出來，讓推論與客觀事實分得開。
 */
export const CLAIM_TYPE: Partial<Record<ClaimType, { label: string; tone: BriefTone; hint: string }>> = {
  inference: {
    label: 'AI 推論',
    tone: 'info',
    hint: '這句話是 AI 從下列資料推出來的判斷，不是資料本身寫的。',
  },
  conflict: {
    label: '資料矛盾',
    tone: 'warn',
    hint: '不同來源的資料互相牴觸，AI 沒有硬選一邊。',
  },
  limitation: {
    label: '資料限制',
    tone: 'plain',
    hint: '這一項說明的是資料本身看不到的部分。',
  },
};

export function claimTypeMeta(claimType?: ClaimType | string) {
  return CLAIM_TYPE[claimType as ClaimType];
}

export const FORWARD_VIEWS: [ForwardViewKey, string][] = [
  ['short_1_5', '短線 1–5 日'],
  ['swing_6_20', '波段 6–20 日'],
  ['medium_21_40', '中期 21–40 日'],
];
