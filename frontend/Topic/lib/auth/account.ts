import { useSyncExternalStore } from 'react';
import { AUTH_CHANGE_EVENT, getStoredUser, getToken } from './storage';

/**
 * 目前登入身分的快照：沒登入是空字串；換帳號或重新登入（token 變了）都會變。
 * 只改顯示名稱（updateStoredUser）不會變，畫面不必整個重來。
 */
export function authAccountSnapshot(): string {
  const token = getToken();
  return token ? JSON.stringify([token, getStoredUser()?.id ?? null]) : '';
}

/** 本分頁的登入事件，加上其他分頁改 localStorage 時的 storage 事件（02-F1：只聽前者，別的分頁登出就看不到） */
export function subscribeAuthAccount(onChange: () => void): () => void {
  window.addEventListener(AUTH_CHANGE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(AUTH_CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** 共用的登入狀態：任何分頁登入、登出、換帳號都會重新渲染。伺服器端與 hydration 時是空字串（未登入） */
export function useAuthAccount(): string {
  return useSyncExternalStore(subscribeAuthAccount, authAccountSnapshot, () => '');
}

const accountUserId = (snapshot: string): unknown => {
  try {
    return (JSON.parse(snapshot) as [string, unknown])[1];
  } catch {
    return null;
  }
};

export type AuthAccountChange = 'same' | 'logout' | 'switch';

/**
 * 畫面正在顯示 shown 這個身分的資料，登入狀態變成 next 時要怎麼做：
 * - logout：已經登出（可能是別的分頁），畫面上的帳號資料要清掉
 * - switch：換成另一個使用者，要重新載入
 * - same：同一個人（含同一人重新登入換了 token），或畫面還沒顯示任何身分
 */
export function authAccountChange(shown: string, next: string): AuthAccountChange {
  if (!shown || shown === next) return 'same';
  if (!next) return 'logout';
  return accountUserId(shown) === accountUserId(next) ? 'same' : 'switch';
}
