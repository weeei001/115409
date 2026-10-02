import { API_BASE } from '../apiBase';

export const DEVICE_KEY = 'topic-notification-device';
/** Capture the previous credential before auth storage is cleared or replaced. */
export function detachPushSession(accessToken: string | null): void {
  const raw = localStorage.getItem(DEVICE_KEY);
  if (!raw) return;
  localStorage.removeItem(DEVICE_KEY);
  try {
    const { token, platform } = JSON.parse(raw);
    if (accessToken) void fetch(`${API_BASE}/notifications/devices`, {
      method: 'DELETE', keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ token }),
    }).catch(() => {});
    void import('./push').then(({ revokePushToken }) => revokePushToken(platform)).catch(() => {});
  } catch { /* A malformed local record cannot be registered. */ }
}
