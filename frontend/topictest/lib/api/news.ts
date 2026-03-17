import apiClient from './client';
import type { News, PaginatedNewsResponse } from '../types';

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

export async function fetchNews(params?: FetchNewsParams): Promise<PaginatedNewsResponse> {
  const { data } = await apiClient.get<PaginatedNewsResponse>('/news', { params });
  return data;
}

export async function fetchNewsById(id: number): Promise<News> {
  const { data } = await apiClient.get<News>(`/news/${id}`);
  return data;
}

export async function fetchNewsByNewsId(newsId: number): Promise<News> {
  const { data } = await apiClient.get<News>(`/news/by-news-id/${newsId}`);
  return data;
}

export interface FetchNewsCountParams {
  news_id?: number;
  id?: number;
  keyword?: string;
  stock?: string;
  start_time?: string;
  end_time?: string;
}

export async function fetchNewsCount(params?: FetchNewsCountParams): Promise<number> {
  const { data } = await apiClient.get<{ count: number }>('/news/stats/count', { params });
  return data.count;
}
