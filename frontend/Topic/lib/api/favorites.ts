import apiClient from './client';
import type { FavoriteStockListResponse, FavoriteStockResponse } from '../types/api';

/** openapi: GET /favorites/（Bearer，由 client 自動帶；新到舊排序） */
export async function fetchFavorites(options?: { signal?: AbortSignal }) {
  const { data } = await apiClient.get<FavoriteStockListResponse>('/favorites/', { signal: options?.signal });
  return data;
}

/** openapi: PUT /favorites/{symbol}（Bearer；重複加入回傳同一筆，不在 stock_info 時 404） */
export async function addFavorite(symbol: string) {
  const { data } = await apiClient.put<FavoriteStockResponse>(`/favorites/${encodeURIComponent(symbol)}`);
  return data;
}

/** openapi: DELETE /favorites/{symbol}（Bearer；不存在也回 204） */
export async function removeFavorite(symbol: string): Promise<void> {
  await apiClient.delete(`/favorites/${encodeURIComponent(symbol)}`);
}
