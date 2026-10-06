const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function fmtPrice(v: string | number | null | undefined, fallback = '--'): string {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : fallback;
}

export function fmtNum(v: number | null | undefined, fallback = '--'): string {
  return isNum(v) ? v.toLocaleString() : fallback;
}

/*
 * 股數一律顯示成「張」（1 張 = 1,000 股，四捨五入到整數張），同一欄不在股／萬股／億股之間切換（P1-21、決議 2026-10-06）。
 * API 的單位是股，這裡的函式都吃股數。不滿 1 張的非零值寫「不到 1 張」、不帶正負號，呼叫端也不上漲跌色（lotToneValue）。
 * 模擬投資的持股、委託數量仍用股，不經過這裡。
 */
const SHARES_PER_LOT = 1000;
export const LESS_THAN_ONE_LOT = '不到 1 張';

/** 股 → 張（不四捨五入；圖表的資料點用） */
export const sharesToLots = (shares: number): number => shares / SHARES_PER_LOT;

/** 不滿 1 張、但不是 0 */
export const isUnderOneLot = (shares: number | null | undefined): boolean =>
  isNum(shares) && shares !== 0 && Math.abs(shares) < SHARES_PER_LOT;

/** 上漲跌色用的值：不滿 1 張當成 0（不上色） */
export const lotToneValue = (shares: number | null | undefined): number | null | undefined =>
  isUnderOneLot(shares) ? 0 : shares;

/** 股數 → 整數張的數字字串（千分位、不帶單位、不帶號） */
export const lotsNumber = (shares: number): string =>
  Math.round(Math.abs(shares) / SHARES_PER_LOT).toLocaleString('zh-TW');

/** 成交量（股）→「1,234 張」 */
export function fmtVolume(val: number | null | undefined, fallback = '--'): string {
  if (!isNum(val)) return fallback;
  if (isUnderOneLot(val)) return LESS_THAN_ONE_LOT;
  return `${lotsNumber(val)} 張`;
}

/** 金額：億元／萬元／元 */
export function fmtAmount(val: number | null | undefined, fallback = '--'): string {
  if (!isNum(val)) return fallback;
  if (val >= 1e8) return `${(val / 1e8).toFixed(2)} 億元`;
  if (val >= 1e4) return `${(val / 1e4).toFixed(2)} 萬元`;
  return `${Math.round(val).toLocaleString('zh-TW')} 元`;
}

/** 三大法人買賣超（股）→「-1,234 張」，負號是半形 -（要 U+2212 用 signedShares）；不滿 1 張寫「不到 1 張」 */
export function fmtInstitutionalShares(val: number | null | undefined, fallback = '--'): string {
  if (!isNum(val)) return fallback;
  if (isUnderOneLot(val)) return LESS_THAN_ONE_LOT;
  const lots = lotsNumber(val);
  return `${val < 0 && lots !== '0' ? '-' : ''}${lots} 張`;
}

/** 圖表 Y 軸刻度：資料點已換成張（sharesToLots），1 萬張以上寫「1.5萬」 */
export function fmtLotsAxisLabel(lots: number): string {
  if (!Number.isFinite(lots)) return '';
  const abs = Math.abs(lots);
  const sign = lots < 0 ? '-' : '';
  if (abs >= 1e8) return `${sign}${Number((abs / 1e8).toFixed(1))}億`;
  if (abs >= 1e4) return `${sign}${Number((abs / 1e4).toFixed(1))}萬`;
  return String(Number(lots.toFixed(1)));
}

/**
 * 百分比格式化。
 * fmtPercent(3.456) → "3.46%"；fmtPercent(3.456, { sign: true }) → "+3.46%"；
 * fmtPercent(0.123, { fromRatio: true, decimals: 1 }) → "12.3%"；fmtPercent(null) → "--"
 */
export function fmtPercent(
  v: number | null | undefined,
  options?: { sign?: boolean; decimals?: number; fromRatio?: boolean; fallback?: string },
): string {
  const { sign = false, decimals = 2, fromRatio = false, fallback = '--' } = options ?? {};
  if (!isNum(v)) return fallback;
  const value = fromRatio ? v * 100 : v;
  const prefix = sign && value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(decimals)}%`;
}
