import { LESS_THAN_ONE_LOT, isUnderOneLot, lotsNumber } from '@/lib/utils/format';

/**
 * 法人買賣超（股數）→ 張：一律帶正負號（負號 U+2212，0 不帶號），跟 signedText 同一套寫法（DESIGN.md 第 7 節）。
 * 不滿 1 張的非零值寫「不到 1 張」、不帶號；呼叫端用 lotToneValue 上色，這種值不上漲跌色（P1-21）。
 */
export function signedShares(value: number | null | undefined, fallback = '--'): string {
  return withUnit(signedLots(value, fallback), value);
}

/** 表格用：固定以張為單位（整數、千分位、帶正負號），欄位標頭寫「張」 */
export function signedLots(value: number | null | undefined, fallback = '--'): string {
  if (value == null || !Number.isFinite(value)) return fallback;
  if (isUnderOneLot(value)) return LESS_THAN_ONE_LOT;
  const lots = lotsNumber(value);
  if (lots === '0') return lots;
  return value > 0 ? `+${lots}` : `−${lots}`;
}

/** 買進／賣出量（不上漲跌色、不帶號），固定以張為單位 */
export function lots(value: number | null | undefined, fallback = '--'): string {
  if (value == null || !Number.isFinite(value)) return fallback;
  return isUnderOneLot(value) ? LESS_THAN_ONE_LOT : lotsNumber(value);
}

const withUnit = (text: string, value: number | null | undefined) =>
  value == null || !Number.isFinite(value) || isUnderOneLot(value) ? text : `${text} 張`;
