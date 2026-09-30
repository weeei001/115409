import apiClient from './client';
import type { News, PaginatedNewsResponse } from '../types/api';
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
export async function fetchNewsIndustries(): Promise<{ items: { id: string; name: string }[] }> {
  return dedupeFetch('GET /news/industries', async () => {
    const { data } = await apiClient.get<{ items: { id: string; name: string }[] }>('/news/industries');
    return data;
  });
}
