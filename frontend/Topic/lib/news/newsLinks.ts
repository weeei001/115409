import type { News } from '../types/api';

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
