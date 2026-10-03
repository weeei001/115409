import { AUTH_CHANGE_EVENT, getStoredUser, getToken } from '../auth/storage';

export function notificationAccountSnapshot(): string {
  const token = getToken();
  return token ? JSON.stringify([token, getStoredUser()?.id ?? null]) : '';
}

export function subscribeNotificationAccount(onChange: () => void): () => void {
  window.addEventListener(AUTH_CHANGE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(AUTH_CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}
