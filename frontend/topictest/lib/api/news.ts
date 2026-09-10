import apiClient from './client';
import type { News, PaginatedNewsResponse } from '../types';
import { dedupeFetch } from '../utils/inFlight';

export interface FetchNewsParams {
  page?: number;
  page_size?: number;
  article_id?: string;
  keyword?: string;
  stock?: string;
  source?: string;
  start_time?: string;
  end_time?: string;
  sort_by?: 'pub_time' | 'created_at';
  sort_order?: 'asc' | 'desc';
}

function newsRequestKey(params?: FetchNewsParams): string {
  return `GET /news ${JSON.stringify(params ?? {})}`;
}

/** openapi: GET /news */
export async function fetchNews(params?: FetchNewsParams): Promise<PaginatedNewsResponse> {
  const key = newsRequestKey(params);
  return dedupeFetch(key, async () => {
    const { data } = await apiClient.get<PaginatedNewsResponse>('/news', { params });
    return data;
  });
}

/** openapi: GET /news/{article_id} */
export async function fetchNewsDetail(articleId: string, stock?: string): Promise<News> {
  const key = `GET /news/${articleId} ${stock ?? ''}`;
  return dedupeFetch(key, async () => {
    const { data } = await apiClient.get<News>(`/news/${encodeURIComponent(articleId)}`, {
      params: stock ? { stock } : undefined,
    });
    return data;
  });
}

