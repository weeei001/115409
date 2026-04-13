export function fmt(val: string | number | null | undefined, fallback = '--'): string {
  if (val == null || val === '') return fallback;
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return n.toLocaleString();
}

export function fmtPrice(v: string | null | undefined, fallback = '--'): string {
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
  if (val == null) return fallback;
  if (val >= 1e8) return `${(val / 1e8).toFixed(2)} 億`;
  if (val >= 1e4) return `${(val / 1e4).toFixed(1)} 萬`;
  return val.toLocaleString();
}

export function fmtVolumeShort(val: number): string {
  if (val >= 1e8) return `${(val / 1e8).toFixed(1)}億`;
  if (val >= 1e4) return `${(val / 1e4).toFixed(0)}萬`;
  return val.toLocaleString();
}
