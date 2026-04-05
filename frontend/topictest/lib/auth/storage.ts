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
  window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
}

/** 保留 access token，僅更新快取的使用者資料（例如 GET /auth/me 成功後） */
export function updateStoredUser(user: UserPublic): void {
  if (typeof window === 'undefined') return;
  if (!localStorage.getItem(TOKEN_KEY)) return;
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
}
