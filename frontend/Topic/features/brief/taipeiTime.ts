import { formatDateTime, parseNewsDate } from '@/lib/utils/date';

/**
 * 後端時間戳（例如 2026-10-02T05:01:14.372701+00:00）→「台北時間 2026/10/02 13:01」。
 * 固定用 Asia/Taipei 時區，所以「台北時間」這幾個字在任何地區的瀏覽器都成立；
 * 解析不了時退回 formatDateTime（原字串）。
 */
export function taipeiDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const d = parseNewsDate(value);
  if (Number.isNaN(d.getTime())) return formatDateTime(value);
  const text = d.toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `台北時間 ${text}`;
}
