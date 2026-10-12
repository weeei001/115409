import apiClient from './client';
import { ApiRequestError } from './client';
import { API_BASE } from '../apiBase';
import { pickDetailMessage } from './errorDetail';

export interface NotificationPreferences {
  daily_summary: boolean;
  price_alert: boolean;
  major_news: boolean;
  price_threshold: number;
  quiet_start: number;
  quiet_end: number;
}
export interface InboxNotification {
  id: number;
  kind: string;
  title: string;
  body: string;
  url: string;
  created_at: string;
}
export const fetchNotificationPreferences = async () =>
  (await apiClient.get<NotificationPreferences>('/notifications/preferences')).data;
export const saveNotificationPreferences = async (preferences: NotificationPreferences) =>
  (await apiClient.put<NotificationPreferences>('/notifications/preferences', preferences)).data;
export const fetchNotificationInbox = async () =>
  (await apiClient.get<{ items: InboxNotification[] }>('/notifications/inbox')).data.items;
async function updateDevice(method: string, data: object, accessToken: string) {
  const response = await fetch(`${API_BASE}/notifications/devices`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(data), signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    // 403：方案不含推播，後端的說明直接給使用者看
    let message = '無法更新推播裝置，請稍後重試。';
    if (response.status === 403) {
      try { message = pickDetailMessage(await response.json(), response.status); } catch { /* 用預設訊息 */ }
    }
    throw new ApiRequestError(message, response.status);
  }
}
export async function registerNotificationDevice(token: string, platform: 'web' | 'android', accessToken: string) {
  await updateDevice('POST', { token, platform }, accessToken);
}
export async function unregisterNotificationDevice(token: string, accessToken?: string) {
  if (accessToken) await updateDevice('DELETE', { token }, accessToken);
  else await apiClient.delete('/notifications/devices', { data: { token } });
}
