import type { ClaimType, ForwardView, ForwardViewKey } from '../types/textBrief';

/**
 * text-brief 回應裡列舉值 → 中文標籤。
 * 摘要卡與完整分析共用，避免同一組列舉在兩邊各翻一次。
 */

export const STANCE: Record<string, string> = {
  bullish: '偏多',
  mildly_bullish: '溫和偏多',
  mixed: '多空交雜',
  neutral: '中性整理',
  mildly_bearish: '溫和偏空',
  bearish: '偏空',
  uncertain: '資料不足',
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

export const CONF_HINT = '模型自評經資料與內容限制調整，未經預測校準；不代表事實已證實或投資勝率。';

/** 只在「沒有產出簡報」時用來補一句原因；verified 一定帶簡報，不會走到這裡。 */
export const STATUS: Record<string, [BriefTone, string]> = {
  limited: ['warn', '資料或內容檢查有限制'],
  unavailable: ['bad', '這次沒有產出結果'],
};

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
