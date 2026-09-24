/** 本地時區的 YYYY-MM-DD */
export function toYmdLocal(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 今天往前 N 個月（本地日期） */
export function getDefaultDateRange(monthsBack = 3) {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - monthsBack);
  return { start: toYmdLocal(start), end: toYmdLocal(end) };
}

/** 以 YYYY-MM-DD 字串為基準往前推 N 個月，回傳 YYYY-MM-DD（不受時區影響） */
export function shiftYmdMonths(ymd: string, months: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

/**
 * pub_time 是字串，可能是 '2025-10-18T22:03:55+08:00' 或 '2025-10-18 22:03:55'，
 * 後者不是合法 ISO，部分瀏覽器會解析失敗。
 */
export function parseNewsDate(value: string): Date {
  return new Date(value.includes('T') ? value : value.replace(' ', 'T'));
}

/** 相對時間：剛剛／N 分鐘前／N 小時前／N 天前／日期 */
export function formatTime(iso: string | null): string {
  if (!iso) return '';
  const d = parseNewsDate(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return '剛剛';
  if (diffMin < 60) return `${diffMin} 分鐘前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小時前`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay} 天前`;
  return d.toLocaleDateString('zh-TW', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const d = parseNewsDate(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  const d = parseNewsDate(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
}
