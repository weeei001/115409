import type { News } from '../types/api';

/** 新聞情緒標籤：正面用漲色、負面用跌色，其餘中性（決議 D8） */
export const SENTIMENT_META: Record<string, { label: string; description: string; badge: string }> = {
  positive: {
    label: '正面',
    description: '新聞內容對該公司營運、營收或展望呈現正向效益。',
    badge: 'border-up/30 bg-up-muted text-up-emphasis',
  },
  negative: {
    label: '負面',
    description: '新聞內容提及利空、虧損、賣壓或不利營運之因素。',
    badge: 'border-down/30 bg-down-muted text-down-emphasis',
  },
  neutral: {
    label: '中性',
    description: '新聞為一般市場客觀事實或例行公告，無明顯多空偏向。',
    badge: 'border-border bg-muted text-subtle',
  },
  mixed: {
    label: '正負混合',
    description: '新聞同時包含正面與負面訊息，兩者均具實質影響。',
    badge: 'border-border bg-muted text-subtle',
  },
  insufficient: {
    label: '資訊不足',
    description: '僅提及公司名稱或代號，未提供實質營運關聯或具體數據。',
    badge: 'border-border bg-muted text-muted-foreground',
  },
};

export const UNKNOWN_SENTIMENT_BADGE = 'border-border bg-muted text-muted-foreground';

export function sentimentMeta(label: string) {
  return SENTIMENT_META[label] ?? { label, description: '', badge: UNKNOWN_SENTIMENT_BADGE };
}

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
