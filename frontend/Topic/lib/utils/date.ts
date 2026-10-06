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

/**
 * 後端時間戳 → 台北時間字串。固定 Asia/Taipei，任何地區的瀏覽器都顯示同一個時間；
 * options 是 toLocaleString 的顯示格式（各處沿用原本的格式），解析不了時回傳 fallback。
 */
export function formatTaipei(
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions = { hour12: false },
  fallback = '',
): string {
  if (!value) return fallback;
  const d = parseNewsDate(value);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toLocaleString('zh-TW', { ...options, timeZone: 'Asia/Taipei' }).replace(/\s+/g, ' ');
}

const MINUTE_FORMAT: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };

/** 新聞的時間（發布、擷取、分析）：年月日時分、24 小時制（台北時間），例如 2026/10/05 22:30；解析不了時顯示原字串 */
export function formatDateTime(value: string | null | undefined): string {
  return formatTaipei(value, { ...MINUTE_FORMAT, hourCycle: 'h23' }, value ?? '');
}

/**
 * 同上加「台北時間」字樣（例如 2026-10-02T05:01:14+00:00 →「台北時間 2026/10/02 13:01」），
 * 用在畫面上沒有其他地方交代時區的位置；解析不了時顯示原字串。
 */
export function taipeiDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const text = formatTaipei(value, { ...MINUTE_FORMAT, hour12: false });
  return text ? `台北時間 ${text}` : value;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  const d = parseNewsDate(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
}
