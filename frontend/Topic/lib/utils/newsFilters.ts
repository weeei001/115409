import type { NewsListFilters } from '../hooks/useNewsList';

export const NEWS_ADVANCED_FIELDS = [
  { key: 'scope', label: '影響範圍', options: [['', '全部'], ['market', '大盤'], ['industry', '產業'], ['company', '公司']] },
  { key: 'direction', label: '影響方向', options: [['', '全部'], ['positive', '正向'], ['negative', '負向'], ['neutral', '中性'], ['mixed', '正負並存'], ['uncertain', '方向未明']] },
  { key: 'importance', label: '重要性', options: [['', '全部'], ['high', '高'], ['medium', '中'], ['low', '低']] },
  { key: 'relation', label: '關聯類型', options: [['', '全部'], ['direct', '直接'], ['industry_context', '產業脈絡'], ['market_context', '市場脈絡']] },
] as const;

/** Describe the conditions used for results, excluding the stock and keyword controls. */
export function summarizeNewsFilters(applied: NewsListFilters, fixedRelation = false): string[] {
  const summary: string[] = [];
  if (applied.start_time?.trim()) summary.push(`發布時間起：${applied.start_time.trim().replace('T', ' ')}`);
  if (applied.end_time?.trim()) summary.push(`發布時間迄：${applied.end_time.trim().replace('T', ' ')}`);
  for (const field of NEWS_ADVANCED_FIELDS) {
    if (fixedRelation && field.key === 'relation') continue;
    const value = applied[field.key];
    const label = field.options.find(([key]) => key === value)?.[1];
    if (value && label) summary.push(`${field.label}：${label}`);
  }
  if (applied.industry?.trim()) summary.push(`產業代碼：${applied.industry.trim()}`);
  if (applied.topic?.trim()) summary.push(`主題：${applied.topic.trim()}`);
  return summary;
}

/** datetime-local value → openapi `YYYY-MM-DDTHH:MM:SS` */
export function formatNewsDateTimeParam(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
    return `${trimmed}:00`;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  return trimmed;
}

export function validateNewsTimeRange(start?: string, end?: string): string | null {
  if (!start || !end) return null;
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (Number.isNaN(s) || Number.isNaN(e)) return '時間格式無效';
  if (s > e) return '開始時間不可晚於結束時間';
  return null;
}
