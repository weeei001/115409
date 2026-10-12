import apiClient from './client';
import type { ActivateSubscriptionRequest, SubscriptionStatus } from '../types/api';

/** openapi: GET /subscription（Bearer 可省略；未登入回傳訪客的免費版額度） */
export async function fetchSubscription(options?: { signal?: AbortSignal }) {
  const { data } = await apiClient.get<SubscriptionStatus>('/subscription', { signal: options?.signal });
  return data;
}

/** openapi: PUT /subscription（Bearer；模擬開通，不經金流） */
export async function activateSubscription(body: ActivateSubscriptionRequest) {
  const { data } = await apiClient.put<SubscriptionStatus>('/subscription', body);
  return data;
}

/** openapi: DELETE /subscription（Bearer；恢復免費版） */
export async function cancelSubscription() {
  const { data } = await apiClient.delete<SubscriptionStatus>('/subscription');
  return data;
}
