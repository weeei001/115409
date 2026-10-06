const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function fmtPrice(v: string | number | null | undefined, fallback = '--'): string {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : fallback;
}

export function fmtNum(v: number | null | undefined, fallback = '--'): string {
  return isNum(v) ? v.toLocaleString('zh-TW') : fallback;
}

/*
 * 正負號（DESIGN.md 第 7 節、05 用語表）：正值補「+」，負號一律 U+2212（和數字等寬），0 不帶號。
 */
const MINUS = '−';

/** 已格式化的數字字串：把開頭的半形 - 換成 U+2212（fmtPercent、fmtAmount、toFixed 這類輸出用） */
export const uMinus = (text: string): string => text.replace(/^-/, MINUS);

/** 依 value 的正負替已格式化的絕對值加上正負號；value 是 0 就不帶號 */
export const withSign = (value: number, abs: string): string =>
  value > 0 ? `+${abs}` : value < 0 ? `${MINUS}${abs}` : abs;

/*
 * 股數一律顯示成「張」（1 張 = 1,000 股，四捨五入到整數張），同一欄不在股／萬股／億股之間切換（P1-21、決議 2026-10-06）。
 * API 的單位是股，這裡的函式都吃股數。不滿 1 張的非零值寫「不到 1 張」、不帶正負號，呼叫端也不上漲跌色（lotToneValue）。
 * 模擬投資的持股、委託數量仍用股，不經過這裡。
 */
const SHARES_PER_LOT = 1000;
export const LESS_THAN_ONE_LOT = '不到 1 張';

/** 股 → 張（不四捨五入；圖表的資料點用） */
export const sharesToLots = (shares: number): number => shares / SHARES_PER_LOT;

/** 張 → 股（後端已換成張的欄位，例如 AI 文字簡報的 *_lots，要套用這裡的張數格式時用） */
export const lotsToShares = (lotCount: number): number => lotCount * SHARES_PER_LOT;

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

/** 金額：億元／萬元／元；負值依絕對值縮放，前面加半形 -（要 U+2212 由呼叫端套 uMinus） */
export function fmtAmount(val: number | null | undefined, fallback = '--'): string {
  if (!isNum(val)) return fallback;
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(2)} 億元`;
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(2)} 萬元`;
  return `${sign}${Math.round(abs).toLocaleString('zh-TW')} 元`;
}

/** 三大法人買賣超（股）→「−1,234 張」：負號 U+2212、正值不補「+」（要帶「+」用 signedShares）；不滿 1 張寫「不到 1 張」 */
export function fmtInstitutionalShares(val: number | null | undefined, fallback = '--'): string {
  if (!isNum(val)) return fallback;
  if (isUnderOneLot(val)) return LESS_THAN_ONE_LOT;
  return `${val < 0 ? MINUS : ''}${lotsNumber(val)} 張`;
}

/**
 * 法人買賣超（股數）→ 張：一律帶正負號（負號 U+2212，0 不帶號），跟 signedText 同一套寫法（DESIGN.md 第 7 節）。
 * 不滿 1 張的非零值寫「不到 1 張」、不帶號；呼叫端用 lotToneValue 上色，這種值不上漲跌色（P1-21）。
 */
export function signedShares(value: number | null | undefined, fallback = '--'): string {
  const text = signedLots(value, fallback);
  return !isNum(value) || isUnderOneLot(value) ? text : `${text} 張`;
}

/** 表格用：固定以張為單位（整數、千分位、帶正負號），欄位標頭寫「張」 */
export function signedLots(value: number | null | undefined, fallback = '--'): string {
  if (!isNum(value)) return fallback;
  if (isUnderOneLot(value)) return LESS_THAN_ONE_LOT;
  return withSign(value, lotsNumber(value));
}

/** 買進／賣出量（不上漲跌色、不帶號），固定以張為單位 */
export function lots(value: number | null | undefined, fallback = '--'): string {
  if (!isNum(value)) return fallback;
  return isUnderOneLot(value) ? LESS_THAN_ONE_LOT : lotsNumber(value);
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
  const text = value.toFixed(decimals);
  // 先四捨五入再決定正負號：顯示成 0 的值不寫「-0.00%」也不寫「+0.00%」
  if (Number(text) === 0) return `${(0).toFixed(decimals)}%`;
  const prefix = sign && value > 0 ? '+' : '';
  return `${prefix}${text}%`;
}
