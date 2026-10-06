import type { News } from '../types/api';
import { DomUtils, parseDocument } from 'htmlparser2';
import { breadcrumbsTrail, type BreadcrumbItem } from '../nav';
import { formatStockLabel } from '../utils/symbolNames';
import { isTaiwanStockCode } from '../utils/stockValidation';

export const UNSUPPORTED_STOCK_MARKET_MESSAGE = '此市場暫不支援個股分析';

/** Only Taiwan identifiers can address this application's stock pages. */
export function taiwanStockCode(identifier: string): string | null {
  const value = identifier.trim();
  if (isTaiwanStockCode(value)) return value;
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

/** Extract display text; callers render it as escaped React text, never as HTML. */
export const stripHtml = (content: string) => DomUtils.innerText(parseDocument(content).children);

export function newsHref(articleId: string, stock?: string) {
  return `/news/${encodeURIComponent(articleId)}${stock ? `?stock=${stock}` : ''}`;
}

/**
 * 新聞頁的麵包屑：只有從個股頁進來（網址帶 stock）才把那檔股票當上一層，連回原本的相關新聞列表；
 * 從首頁進來時不要拿第一檔關聯股充當上一層（04-N2）。
 */
export function newsDetailBreadcrumbs(stockParam: string, newsReturn: string | null): BreadcrumbItem[] {
  return isTaiwanStockCode(stockParam)
    ? breadcrumbsTrail({ label: formatStockLabel(stockParam), href: newsReturn ?? `/stock/${stockParam}` }, '新聞內容與事件影響')
    : breadcrumbsTrail('新聞內容與事件影響');
}
