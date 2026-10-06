import apiClient from './client';
import type { News, NewsIndustriesResponse, NewsIndustry, PaginatedNewsResponse } from '../types/api';
import { dedupeFetch } from '../utils/inFlight';

export interface FetchNewsParams {
  page?: number;
  page_size?: number;
  keyword?: string;
  stock?: string;
  scope?: 'market' | 'industry' | 'company';
  industry?: string;
  topic?: string;
  direction?: 'positive' | 'negative' | 'neutral' | 'mixed' | 'uncertain';
  importance?: 'high' | 'medium' | 'low';
  relation?: 'direct' | 'market_context' | 'industry_context';
  source?: string;
  start_time?: string;
  end_time?: string;
  sort_by?: 'pub_time' | 'created_at' | 'importance';
  sort_order?: 'asc' | 'desc';
}

export interface FetchRelatedNewsParams extends Omit<FetchNewsParams, 'stock' | 'page_size' | 'source'> {
  symbol: string;
  relation?: 'direct' | 'market_context' | 'industry_context';
  lookback_days?: number;
  limit?: number;
  as_of?: string;
}

function newsRequestKey(params?: FetchNewsParams): string {
  return `GET /news ${JSON.stringify(params ?? {})}`;
}
/** openapi: GET /news */
export async function fetchNews(params?: FetchNewsParams): Promise<PaginatedNewsResponse> {
  return dedupeFetch(newsRequestKey(params), async () => {
    const { data } = await apiClient.get<PaginatedNewsResponse>('/news', { params });
    return data;
  });
}

export async function fetchRelatedNews(params: FetchRelatedNewsParams): Promise<PaginatedNewsResponse> {
  const key = `GET /api/retrieval/news ${JSON.stringify(params)}`;
  return dedupeFetch(key, async () => {
    const { data } = await apiClient.get<PaginatedNewsResponse>('/api/retrieval/news', { params });
    return data;
  });
}

/**
 * openapi: GET /news/industries（回應 schema 是空的，形狀見 `NewsIndustriesResponse`，決議 D5）。
 * 清單只在後端更新公司資料時才會變，快取 10 分鐘；形狀不對的項目直接略過。
 */
export async function fetchNewsIndustries(): Promise<NewsIndustry[]> {
  return dedupeFetch('GET /news/industries', async () => {
    const { data } = await apiClient.get<NewsIndustriesResponse>('/news/industries');
    const items: unknown[] = data && Array.isArray(data.items) ? data.items : [];
    return items.filter((item): item is NewsIndustry => Boolean(item) && typeof item === 'object'
      && typeof (item as NewsIndustry).id === 'string' && typeof (item as NewsIndustry).name === 'string');
  }, 10 * 60_000);
}

/** openapi: GET /news/{article_id} */
export async function fetchNewsDetail(articleId: string, stock?: string, revisionId?: string): Promise<News> {
  const params = { ...(stock ? { stock } : {}), ...(revisionId ? { revision_id: revisionId } : {}) };
  return dedupeFetch(`GET /news/${articleId} ${JSON.stringify(params)}`, async () => {
    const { data } = await apiClient.get<News>(`/news/${encodeURIComponent(articleId)}`, {
      params,
    });
    return data;
  });
}
