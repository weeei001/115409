/** JWT 存於 localStorage；若網站遭 XSS 可能外洩，正式環境宜評估 httpOnly cookie。 */
import type { UserPublic } from '../types';

const TOKEN_KEY = 'topictest_access_token';
const USER_KEY = 'topictest_user';

export const AUTH_CHANGE_EVENT = 'topictest-auth-change';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): UserPublic | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UserPublic;
  } catch {
    return null;
  }
}

export function setAuth(token: string, user: UserPublic): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
}

export function clearAuth(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  window.dispatchEvent(new CustomEvent(AUTH_CHANGE_EVENT, { detail: { logout: true } }));
}

/** 保留 access token，僅更新快取的使用者資料（例如 GET /auth/me 成功後） */
export function updateStoredUser(user: UserPublic): void {
  if (typeof window === 'undefined') return;
  if (!localStorage.getItem(TOKEN_KEY)) return;
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
}

/** Detect account boundaries even if several cross-tab storage events queue up. */
export function isAuthSessionBoundary(event: Pick<StorageEvent, 'key' | 'oldValue' | 'newValue'>): boolean {
  if (event.key === null || (event.key === TOKEN_KEY && !event.newValue)) return true;
  if (event.key !== USER_KEY) return false;
  const id = (raw: string | null) => { try { return raw ? (JSON.parse(raw) as UserPublic)?.id : null; } catch { return null; } };
  return id(event.oldValue) !== id(event.newValue);
}
