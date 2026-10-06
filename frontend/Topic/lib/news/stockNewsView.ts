import type { NewsListFilters } from '../hooks/useNewsList';
import { safeReturnUrl } from '../utils/returnUrl';
import { validateNewsTimeRange } from '../utils/newsFilters';

export interface StockNewsView {
  version: 1;
  symbol: string;
  relation: 'direct' | 'industry_context' | 'market_context';
  page: number;
  filters: NewsListFilters;
}

export const STOCK_NEWS_VIEW_PARAM = 'newsView';
const POSITION_KEY = 'stockbeacon-stock-news-position';
const choices = {
  scope: ['market', 'industry', 'company'],
  direction: ['positive', 'negative', 'neutral', 'mixed', 'uncertain'],
  importance: ['high', 'medium', 'low'],
  relation: ['direct', 'industry_context', 'market_context'],
} as const;

/**
 * 網址裡已套用的篩選（個股相關新聞、首頁新聞共用）：只收公開的篩選欄位，任何一欄不合法就整份不用。
 * `withRelation`：關聯類型是不是篩選的一部分（首頁）；個股抽屜的關聯另外存，不在 filters 裡。
 */
export function parseNewsViewFilters(raw: unknown, base: NewsListFilters, withRelation = false): NewsListFilters | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const filters: NewsListFilters = { ...base };
  for (const key of ['keyword', 'industry', 'topic', 'start_time', 'end_time'] as const) {
    const item = source[key];
    if (item === undefined) continue;
    if (typeof item !== 'string' || item.length > 200 || /[\u0000-\u001F\u007F]/.test(item)) return null;
    if (item.trim()) filters[key] = item;
  }
  const choiceKeys = withRelation ? (['scope', 'direction', 'importance', 'relation'] as const) : (['scope', 'direction', 'importance'] as const);
  for (const key of choiceKeys) {
    const item = source[key];
    if (item === undefined || item === '') continue;
    if (!(choices[key] as readonly unknown[]).includes(item)) return null;
    Object.assign(filters, { [key]: item });
  }
  if (validateNewsTimeRange(filters.start_time, filters.end_time)) return null;
  return filters;
}

export function parseStockNewsView(raw: unknown, symbol: string): StockNewsView | null {
  if (typeof raw !== 'string' || raw.length > 4000) return null;
  try {
    const value = JSON.parse(raw);
    if (value?.version !== 1 || value.symbol !== symbol ||
        !(choices.relation as readonly unknown[]).includes(value.relation) ||
        !Number.isSafeInteger(value.page) || value.page < 1 || value.page > 100000) return null;
    const filters = parseNewsViewFilters(value.filters, { stock: symbol, relation: value.relation });
    if (!filters) return null;
    return { version: 1, symbol, relation: value.relation, page: value.page, filters };
  } catch {
    return null;
  }
}

export function stockNewsViewHref(asPath: string, view: StockNewsView | null): string {
  const url = new URL(asPath, 'http://stock-news.local');
  if (view) {
    // The parser also removes unknown fields; route state contains only applied public filters.
    const clean = parseStockNewsView(JSON.stringify(view), view.symbol);
    if (clean) url.searchParams.set(STOCK_NEWS_VIEW_PARAM, JSON.stringify(clean));
    else url.searchParams.delete(STOCK_NEWS_VIEW_PARAM);
  } else url.searchParams.delete(STOCK_NEWS_VIEW_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** An article can offer a return link only to the same stock's saved news view. */
export function stockNewsReturnHref(raw: unknown, symbol: string): string | null {
  const path = safeReturnUrl(raw);
  if (!path || path.length > 12000) return null;
  const url = new URL(path, 'http://stock-news.local');
  if (url.pathname !== `/stock/${symbol}` || !parseStockNewsView(url.searchParams.get(STOCK_NEWS_VIEW_PARAM), symbol)) return null;
  return path;
}

export function saveStockNewsPosition(route: string, articleId: string, scrollTop: number) {
  try {
    sessionStorage.setItem(POSITION_KEY, JSON.stringify({ route, articleId, scrollTop }));
  } catch { /* Navigation still works when session storage is unavailable. */ }
}

export function loadStockNewsPosition(route: string): { articleId: string; scrollTop: number } | null {
  try {
    const raw = sessionStorage.getItem(POSITION_KEY);
    if (!raw || raw.length > 14000) return null;
    const value = JSON.parse(raw);
    return value.route === route && typeof value.articleId === 'string' && value.articleId.length <= 200 &&
      Number.isFinite(value.scrollTop) && value.scrollTop >= 0
      ? { articleId: value.articleId, scrollTop: value.scrollTop } : null;
  } catch { return null; }
}
