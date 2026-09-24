/**
 * 台股紅漲綠跌的語意色調。只用在價格方向、買賣超與多空立場；
 * 錯誤／成功／警告請用 danger／success／warning，不要借用漲跌色。
 */
export type ValueTone = 'up' | 'down' | 'neutral';

/** 數值正負 → tone；0 與缺值都是中性（決議 c7） */
export function getValueTone(v: number | null | undefined): ValueTone {
  if (v == null || !Number.isFinite(v) || v === 0) return 'neutral';
  return v > 0 ? 'up' : 'down';
}

const TEXT: Record<ValueTone, string> = {
  up: 'text-up',
  down: 'text-down',
  neutral: 'text-subtle',
};

/** 依數值正負回傳文字色 class；缺值用 muted */
export function valueToneText(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return 'text-muted-foreground';
  return TEXT[getValueTone(v)];
}

export function toneText(tone: ValueTone): string {
  return TEXT[tone];
}

/** 徽章（外框＋底色＋文字）；emphasis 用在淡底上的小字，對比較高 */
export function toneBadge(tone: ValueTone, options?: { emphasis?: boolean }): string {
  const emphasis = options?.emphasis ?? false;
  if (tone === 'up') return `bg-up-muted ${emphasis ? 'text-up-emphasis' : 'text-up'} border-up/30`;
  if (tone === 'down') return `bg-down-muted ${emphasis ? 'text-down-emphasis' : 'text-down'} border-down/30`;
  return 'bg-muted text-subtle border-border';
}
