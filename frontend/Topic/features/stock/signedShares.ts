import { fmtInstitutionalShares } from '@/lib/utils/format';

/**
 * 法人買賣超（股數）：沿用 fmtInstitutionalShares 的萬股／億股換算，
 * 但一律帶正負號（負號 U+2212，0 不帶號），跟 signedText 同一套寫法（DESIGN.md 第 7 節）。
 */
export function signedShares(value: number | null | undefined, fallback = '--'): string {
  if (value == null || !Number.isFinite(value)) return fallback;
  const abs = fmtInstitutionalShares(Math.abs(value), fallback);
  if (value > 0) return `+${abs}`;
  if (value < 0) return `−${abs}`;
  return abs;
}

/** 表格用：固定以萬股為單位（兩位小數、帶正負號），欄位標頭寫「萬股」 */
export function signedWanShares(value: number | null | undefined, fallback = '--'): string {
  if (value == null || !Number.isFinite(value)) return fallback;
  const abs = (Math.abs(value) / 1e4).toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (value > 0) return `+${abs}`;
  if (value < 0) return `−${abs}`;
  return abs;
}

/** 買進／賣出量（不上漲跌色、不帶號），固定以萬股為單位 */
export function wanShares(value: number | null | undefined, fallback = '--'): string {
  if (value == null || !Number.isFinite(value)) return fallback;
  return (value / 1e4).toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
