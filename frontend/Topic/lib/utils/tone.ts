/**
 * 台股紅漲綠跌的語意色調。只用在價格方向、買賣超與多空立場；
 * 錯誤／成功／警告請用 danger／success／warning，不要借用漲跌色。
 */
export type ValueTone = 'up' | 'down' | 'neutral';

/**
 * 數值正負 → tone；0 與缺值都是中性。
 * decimals：畫面上的位數（和 signedText 同一個值）；先四捨五入再判斷，寫成「0.00」的值不上漲跌色。
 */
export function getValueTone(v: number | null | undefined, decimals?: number): ValueTone {
  if (v == null || !Number.isFinite(v)) return 'neutral';
  const shown = decimals == null ? v : Number(v.toFixed(decimals));
  if (shown === 0) return 'neutral';
  return shown > 0 ? 'up' : 'down';
}

const TEXT: Record<ValueTone, string> = {
  up: 'text-up',
  down: 'text-down',
  neutral: 'text-subtle',
};

/** 依數值正負回傳文字色 class；缺值用 muted。decimals 同 getValueTone */
export function valueToneText(v: number | null | undefined, decimals?: number): string {
  if (v == null || !Number.isFinite(v)) return 'text-muted-foreground';
  return TEXT[getValueTone(v, decimals)];
}

export function toneText(tone: ValueTone): string {
  return TEXT[tone];
}

/** 徽章色調：漲跌（依數值正負）、狀態（警告／錯誤／成功）、資訊，以及只有外框的 outline */
export type BadgeTone = ValueTone | 'warning' | 'danger' | 'success' | 'info' | 'outline';

/** 徽章（外框＋底色＋文字），全站徽章的配色只來自這裡；emphasis 用在淡底上的小字，對比較高 */
export function toneBadge(tone: BadgeTone, options?: { emphasis?: boolean }): string {
  const emphasis = options?.emphasis ?? false;
  switch (tone) {
    case 'up':
      return `bg-up-muted ${emphasis ? 'text-up-emphasis' : 'text-up'} border-up/30`;
    case 'down':
      return `bg-down-muted ${emphasis ? 'text-down-emphasis' : 'text-down'} border-down/30`;
    case 'warning':
      return 'bg-warning-muted text-warning border-warning-border';
    case 'danger':
      return 'bg-danger-muted text-danger border-danger-border';
    case 'success':
      return 'bg-success-muted text-success border-success-border';
    case 'info':
      return 'bg-accent text-accent-foreground border-input';
    case 'outline':
      return 'bg-transparent text-subtle border-border';
    default:
      return 'bg-muted text-subtle border-border';
  }
}
