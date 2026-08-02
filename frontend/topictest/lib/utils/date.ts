function toYmdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getDefaultDateRange(monthsBack = 3) {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - monthsBack);
  return {
    start: toYmdLocal(start),
    end: toYmdLocal(end),
  };
}

/**
 * news_articles.pub_time 是字串欄位，格式可能是 '2025-10-18T22:03:55+08:00'
 * 或 '2025-10-18 22:03:55'，後者不是合法 ISO，部分瀏覽器會解析失敗。
 */
export function parseNewsDate(value: string): Date {
  return new Date(value.includes('T') ? value : value.replace(' ', 'T'));
}

export function formatTime(iso: string | null): string {
  if (!iso) return '';
  const d = parseNewsDate(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '剛剛';
  if (diffMin < 60) return `${diffMin} 分鐘前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小時前`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay} 天前`;
  return d.toLocaleDateString('zh-TW', { month: 'short', day: 'numeric', year: 'numeric' });
}
