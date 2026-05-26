import apiClient from './client';
import type { PaginatedNewsResponse } from '../types';
import { dedupeFetch } from '../utils/inFlight';

export interface FetchNewsParams {
  page?: number;
  page_size?: number;
  news_id?: number;
  id?: number;
  keyword?: string;
  stock?: string;
  start_time?: string;
  end_time?: string;
  sort_by?: 'publish_time' | 'created_at' | 'updated_at';
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
