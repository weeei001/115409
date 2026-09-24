import apiClient from './client';
import type { News, PaginatedNewsResponse } from '../types/api';
import { dedupeFetch } from '../utils/inFlight';

export interface FetchNewsParams {
  page?: number;
  page_size?: number;
  keyword?: string;
  stock?: string;
  start_time?: string;
  end_time?: string;
  sort_by?: 'pub_time' | 'created_at';
  sort_order?: 'asc' | 'desc';
}

/** openapi: GET /news */
export async function fetchNews(params?: FetchNewsParams): Promise<PaginatedNewsResponse> {
  return dedupeFetch(`GET /news ${JSON.stringify(params ?? {})}`, async () => {
    const { data } = await apiClient.get<PaginatedNewsResponse>('/news', { params });
    return data;
  });
}

/** openapi: GET /news/{article_id} */
export async function fetchNewsDetail(articleId: string, stock?: string): Promise<News> {
  return dedupeFetch(`GET /news/${articleId} ${stock ?? ''}`, async () => {
    const { data } = await apiClient.get<News>(`/news/${encodeURIComponent(articleId)}`, {
      params: stock ? { stock } : undefined,
    });
    return data;
  });
}
