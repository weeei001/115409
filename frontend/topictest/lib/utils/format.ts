export function fmt(val: string | number | null | undefined, fallback = '--'): string {
  if (val == null || val === '') return fallback;
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return n.toLocaleString();
}

export function fmtPrice(v: string | number | null | undefined, fallback = '--'): string {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return n.toFixed(2);
}

export function fmtNum(v: number | null | undefined, fallback = '--'): string {
  if (v == null) return fallback;
  return v.toLocaleString();
}

export function fmtVolume(val: number | null | undefined, fallback = '--'): string {
  if (val == null || Number.isNaN(val)) return fallback;
  if (val >= 1e8) return `${(val / 1e8).toFixed(2)} 億股`;
  if (val >= 1e4) return `${(val / 1e4).toFixed(2)} 萬股`;
  return `${Math.round(val).toLocaleString('zh-TW')} 股`;
}

export function fmtAmount(val: number | null | undefined, fallback = '--'): string {
  if (val == null || Number.isNaN(val)) return fallback;
  if (val >= 1e8) return `${(val / 1e8).toFixed(2)} 億元`;
  if (val >= 1e4) return `${(val / 1e4).toFixed(2)} 萬元`;
  return `${Math.round(val).toLocaleString('zh-TW')} 元`;
}

export function formatVolumeShares(val: number | null | undefined, fallback = '無資料'): string {
  if (val == null || Number.isNaN(val)) return fallback;
  if (val >= 1e8) return `${(val / 1e8).toFixed(2)} 億股`;
  if (val >= 1e4) return `${(val / 1e4).toFixed(2)} 萬股`;
  return `${Math.round(val).toLocaleString('zh-TW')} 股`;
}

export function fmtVolumeShort(val: number): string {
  if (!Number.isFinite(val)) return '--';
  if (val >= 1e8) return `${(val / 1e8).toFixed(1)}億`;
  if (val >= 1e4) return `${(val / 1e4).toFixed(0)}萬`;
  return Math.round(val).toLocaleString('zh-TW');
}

/** 三大法人買賣超（股）— 完整顯示用 */
export function fmtInstitutionalShares(val: number | null | undefined, fallback = '--'): string {
  if (val == null || !Number.isFinite(val)) return fallback;
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(2)} 億股`;
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(2)} 萬股`;
  return `${sign}${Math.round(abs).toLocaleString('zh-TW')} 股`;
}

/** ECharts Y 軸刻度（法人股數） */
export function fmtInstitutionalAxisLabel(val: number): string {
  if (!Number.isFinite(val)) return '';
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(1)}億`;
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(0)}萬`;
  return String(Math.round(val));
}

/**
 * 統一的百分比格式化。取代散落於 PriceChangePanel / CompareMetricsTable /
 * CompareMethodologyPanel / lib/utils/compare.ts 的多個自實作 fmtPct 版本。
 *
 * @example
 *   fmtPercent(3.456)                       // "3.46%"
 *   fmtPercent(3.456, { sign: true })       // "+3.46%"
 *   fmtPercent(-1.2, { sign: true })        // "-1.20%"
 *   fmtPercent(0.123, { fromRatio: true, decimals: 1 }) // "12.3%"
 *   fmtPercent(null)                        // "--"
 */
export function fmtPercent(
  v: number | null | undefined,
  options?: { sign?: boolean; decimals?: number; fromRatio?: boolean; fallback?: string },
): string {
  const { sign = false, decimals = 2, fromRatio = false, fallback = '--' } = options ?? {};
  if (v == null || !Number.isFinite(v)) return fallback;
  const value = fromRatio ? v * 100 : v;
  const prefix = sign && value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(decimals)}%`;
}
