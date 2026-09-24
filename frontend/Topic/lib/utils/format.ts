const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function fmt(val: string | number | null | undefined, fallback = '--'): string {
  if (val == null || val === '') return fallback;
  const n = Number(val);
  return Number.isFinite(n) ? n.toLocaleString() : fallback;
}

export function fmtPrice(v: string | number | null | undefined, fallback = '--'): string {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : fallback;
}

export function fmtNum(v: number | null | undefined, fallback = '--'): string {
  return isNum(v) ? v.toLocaleString() : fallback;
}

/** 股數：億股／萬股／股 */
export function fmtVolume(val: number | null | undefined, fallback = '--'): string {
  if (!isNum(val)) return fallback;
  if (val >= 1e8) return `${(val / 1e8).toFixed(2)} 億股`;
  if (val >= 1e4) return `${(val / 1e4).toFixed(2)} 萬股`;
  return `${Math.round(val).toLocaleString('zh-TW')} 股`;
}

/** 金額：億元／萬元／元 */
export function fmtAmount(val: number | null | undefined, fallback = '--'): string {
  if (!isNum(val)) return fallback;
  if (val >= 1e8) return `${(val / 1e8).toFixed(2)} 億元`;
  if (val >= 1e4) return `${(val / 1e4).toFixed(2)} 萬元`;
  return `${Math.round(val).toLocaleString('zh-TW')} 元`;
}

/** 三大法人買賣超（股），保留正負號 */
export function fmtInstitutionalShares(val: number | null | undefined, fallback = '--'): string {
  if (!isNum(val)) return fallback;
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(2)} 億股`;
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(2)} 萬股`;
  return `${sign}${Math.round(abs).toLocaleString('zh-TW')} 股`;
}

/** 圖表 Y 軸刻度（法人股數） */
export function fmtInstitutionalAxisLabel(val: number): string {
  if (!Number.isFinite(val)) return '';
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(1)}億`;
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(0)}萬`;
  return String(Math.round(val));
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

/** 帶正負號的數值（漲跌、損益） */
export function fmtSigned(v: number | null | undefined, decimals = 2, fallback = '--'): string {
  if (!isNum(v)) return fallback;
  return `${v > 0 ? '+' : ''}${v.toFixed(decimals)}`;
}
