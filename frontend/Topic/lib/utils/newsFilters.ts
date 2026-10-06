import type { NewsListFilters } from '../hooks/useNewsList';
import type { NewsIndustry } from '../types/api';
import { parseNewsTime } from './date';

export const NEWS_ADVANCED_FIELDS = [
  { key: 'scope', label: '影響範圍', options: [['', '全部'], ['market', '大盤'], ['industry', '產業'], ['company', '個股']] },
  { key: 'direction', label: '影響方向', options: [['', '全部'], ['positive', '正向'], ['negative', '負向'], ['neutral', '中性'], ['mixed', '正負並存'], ['uncertain', '方向未明']] },
  { key: 'importance', label: '重要性', options: [['', '全部'], ['high', '高'], ['medium', '中'], ['low', '低']] },
  { key: 'relation', label: '關聯類型', options: [['', '全部'], ['direct', '直接關聯'], ['industry_context', '產業脈絡'], ['market_context', '市場脈絡']] },
] as const;

const INDUSTRY_MARKETS = [['TWSE:', '上市'], ['TPEx:', '上櫃']] as const;

/** 產業選項：依代碼前綴分成上市、上櫃；後端名稱帶的「上市 · 」前綴拿掉，市場改用分組標示 */
export interface NewsIndustryOption {
  id: string;
  name: string;
  market: string | null;
}

export function newsIndustryOption(item: NewsIndustry): NewsIndustryOption {
  const market = INDUSTRY_MARKETS.find(([prefix]) => item.id.startsWith(prefix))?.[1] ?? null;
  const prefix = market ? `${market} · ` : '';
  const name = prefix && item.name.startsWith(prefix) ? item.name.slice(prefix.length).trim() : item.name.trim();
  return { id: item.id, name: name || item.id, market };
}

/** 下拉選單的分組：上市在前、上櫃在後，其餘放「其他」；組內維持後端順序 */
export function groupNewsIndustries(items: NewsIndustry[]): { market: string; options: NewsIndustryOption[] }[] {
  const order = [...INDUSTRY_MARKETS.map(([, market]) => market), '其他'];
  const groups = new Map<string, NewsIndustryOption[]>(order.map((market) => [market, []]));
  for (const item of items) {
    const option = newsIndustryOption(item);
    groups.get(option.market ?? '其他')!.push(option);
  }
  return order.map((market) => ({ market, options: groups.get(market)! })).filter((group) => group.options.length > 0);
}

/** 已套用條件裡的產業：查得到就寫「半導體業（上市）」，清單還沒載入或查不到才顯示代碼 */
export function newsIndustryText(id: string, industries: NewsIndustry[] = []): string {
  const item = industries.find((industry) => industry.id === id);
  if (!item) return id;
  const option = newsIndustryOption(item);
  return option.market ? `${option.name}（${option.market}）` : option.name;
}

/** Describe the conditions used for results, excluding the stock and keyword controls. */
export function summarizeNewsFilters(applied: NewsListFilters, fixedRelation = false, industries: NewsIndustry[] = []): string[] {
  const summary: string[] = [];
  if (applied.start_time?.trim()) summary.push(`發布時間起：${applied.start_time.trim().replace('T', ' ')}`);
  if (applied.end_time?.trim()) summary.push(`發布時間迄：${applied.end_time.trim().replace('T', ' ')}`);
  for (const field of NEWS_ADVANCED_FIELDS) {
    if (fixedRelation && field.key === 'relation') continue;
    const value = applied[field.key];
    const label = field.options.find(([key]) => key === value)?.[1];
    if (value && label) summary.push(`${field.label}：${label}`);
  }
  if (applied.industry?.trim()) summary.push(`產業：${newsIndustryText(applied.industry.trim(), industries)}`);
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

// 不帶時區的時間當成台灣時間；實作和新聞時間的顯示共用（utils/date）
export { parseNewsTime };

/**
 * 後端的結束時間是 min(迄, 現在)（`retrieval/service.py`），所以開始時間晚於現在也會被拒：
 * 只填「起」、或起訖都在未來，都要在前端先擋下。`now` 給測試注入。
 */
export function validateNewsTimeRange(start?: string, end?: string, now: Date = new Date()): string | null {
  const s = start ? parseNewsTime(start) : null;
  const e = end ? parseNewsTime(end) : null;
  if (Number.isNaN(s) || Number.isNaN(e)) return '時間格式不正確，請重新選擇。';
  if (s === null) return null;
  if (e !== null && s > e) return '開始時間不能晚於結束時間，請重新選擇。';
  if (s > now.getTime()) return '開始時間不能晚於現在，請重新選擇。';
  return null;
}
