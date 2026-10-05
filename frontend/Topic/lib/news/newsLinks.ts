import type { News } from '../types/api';

export const UNSUPPORTED_STOCK_MARKET_MESSAGE = '此市場暫不支援個股分析';

/** Only Taiwan identifiers can address this application's stock pages. */
export function taiwanStockCode(identifier: string): string | null {
  const value = identifier.trim();
  if (/^\d{4,6}$/.test(value)) return value;
  const prefix = /^(?:TW|TWSE|TPEX|TWS|TWO):\s*(\d{4,6})$/i.exec(value);
  const suffix = /^(\d{4,6})[.-](?:TW|TWO)$/i.exec(value);
  return (prefix ?? suffix)?.[1] ?? null;
}

export function taiwanStockHref(identifier: string): string | null {
  const symbol = taiwanStockCode(identifier);
  return symbol ? `/stock/${symbol}` : null;
}

/** Preserve foreign identifiers for display; normalize local identifiers before deduplication. */
export function parseRelatedStocks(news: Pick<News, 'stock_id' | 'tags'>, onlyCodes = false): string[] {
  const seen = new Set<string>();
  for (const item of [news.stock_id ?? '', ...(news.tags ?? '').split(',')]) {
    const code = taiwanStockCode(item);
    const s = code ?? item.trim();
    if (!s) continue;
    if (onlyCodes && !code) continue;
    seen.add(s);
  }
  return [...seen];
}

export const stripHtml = (content: string) => content.replace(/<[^>]*>/g, '');

export function newsHref(articleId: string, stock?: string) {
  return `/news/${encodeURIComponent(articleId)}${stock ? `?stock=${stock}` : ''}`;
}
