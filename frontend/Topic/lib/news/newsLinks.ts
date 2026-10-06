import type { News } from '../types/api';
import { breadcrumbsTrail, type BreadcrumbItem } from '../nav';
import { formatStockLabel } from '../utils/symbolNames';

/** 主要關聯股票放 stock_id，其餘放 tags（逗號分隔）；去掉 .TW 後去重 */
export function parseRelatedStocks(news: Pick<News, 'stock_id' | 'tags'>, onlyCodes = false): string[] {
  const seen = new Set<string>();
  for (const item of [news.stock_id ?? '', ...(news.tags ?? '').split(',')]) {
    const s = item.trim().replace(/\.TW$/i, '');
    if (!s) continue;
    if (onlyCodes && !/^\d{4,6}$/.test(s)) continue;
    seen.add(s);
  }
  return [...seen];
}

export const stripHtml = (content: string) => content.replace(/<[^>]*>/g, '');

export function newsHref(articleId: string, stock?: string) {
  return `/news/${encodeURIComponent(articleId)}${stock ? `?stock=${stock}` : ''}`;
}

/**
 * 新聞頁的麵包屑：只有從個股頁進來（網址帶 stock）才把那檔股票當上一層，連回原本的相關新聞列表；
 * 從首頁進來時不要拿第一檔關聯股充當上一層（04-N2）。
 */
export function newsDetailBreadcrumbs(stockParam: string, newsReturn: string | null): BreadcrumbItem[] {
  return /^\d{4,6}$/.test(stockParam)
    ? breadcrumbsTrail({ label: formatStockLabel(stockParam), href: newsReturn ?? `/stock/${stockParam}` }, '新聞內容與事件影響')
    : breadcrumbsTrail('新聞內容與事件影響');
}
