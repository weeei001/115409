/**
 * 將後端可能以字串序列化的數值（FastAPI Decimal serialization）轉成 number | null。
 * 不可解析的值（NaN / Infinity / 空字串 / null / undefined）一律回 null。
 */
export function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
