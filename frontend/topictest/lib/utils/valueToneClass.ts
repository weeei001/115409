/**
 * 依數值正負回傳對應的 Tailwind className（紅漲綠跌語意）。
 *
 * 用於：法人買賣超、漲跌金額、漲跌幅、損益等顯示。
 * 取代散落於多個元件的 netClass / changeClass / toneClass 實作。
 */
export function getValueToneClass(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return 'text-[var(--color-text-muted)]';
  if (v > 0) return 'text-up';
  if (v < 0) return 'text-down';
  return 'text-[var(--color-text-secondary)]';
}

export type ValueTone = 'up' | 'down' | 'neutral';

/** 將數值映射為語意 tone（不含格式化） */
export function getValueTone(v: number | null | undefined): ValueTone {
  if (v == null || !Number.isFinite(v) || v === 0) return 'neutral';
  return v > 0 ? 'up' : 'down';
}

/**
 * 依 tone 回傳 badge 樣式（外框 + 背景 + 文字色）。
 * 用於指標訊號、漲跌徽章等。
 *
 * @param options.emphasis  true 時使用 text-up-emphasis / text-down-emphasis（高對比，
 *                          適用於 muted 背景上的小字 badge）。預設 false。
 */
export function getBadgeToneClass(tone: ValueTone, options?: { emphasis?: boolean }): string {
  const emphasis = options?.emphasis ?? false;
  if (tone === 'up') {
    return `bg-up-muted ${emphasis ? 'text-up-emphasis' : 'text-up'} border-up/30`;
  }
  if (tone === 'down') {
    return `bg-down-muted ${emphasis ? 'text-down-emphasis' : 'text-down'} border-down/30`;
  }
  return 'bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] border-[var(--color-border)]';
}

/** 純文字色（無背景），給 tone 用 */
export function getToneTextClass(tone: ValueTone): string {
  if (tone === 'up') return 'text-up';
  if (tone === 'down') return 'text-down';
  return 'text-[var(--color-text-secondary)]';
}
