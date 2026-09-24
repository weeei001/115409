import { useCallback, useEffect, useState } from 'react';
import { AUTH_CHANGE_EVENT, getStoredUser, getToken } from '@/lib/auth/storage';

/** localStorage 鍵：未登入時的匿名模擬下單 ID；舊版曾用 simulated_order_session_id，讀到就搬過來 */
const USER_KEY = 'simulated_order_user_id';
const LEGACY_KEY = 'simulated_order_session_id';

function randomUserId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function getOrCreateAnonymousId(): string {
  let id = window.localStorage.getItem(USER_KEY);
  if (id?.trim()) return id;
  id = window.localStorage.getItem(LEGACY_KEY);
  if (id?.trim()) {
    window.localStorage.setItem(USER_KEY, id.trim());
    window.localStorage.removeItem(LEGACY_KEY);
    return id.trim();
  }
  id = randomUserId();
  window.localStorage.setItem(USER_KEY, id);
  return id;
}

/**
 * 模擬下單的 user_id：已登入（有 token 且有 email）用 email 小寫（決議 D12 維持舊版），
 * 否則用瀏覽器匿名 ID。登入狀態變更時重新判斷。
 */
export function useSimulatedIdentity() {
  const [userId, setUserId] = useState('');
  const [fromLogin, setFromLogin] = useState(false);

  useEffect(() => {
    const resolve = () => {
      const email = getStoredUser()?.email?.trim().toLowerCase();
      if (getToken() && email) {
        setUserId(email);
        setFromLogin(true);
      } else {
        setUserId(getOrCreateAnonymousId());
        setFromLogin(false);
      }
    };
    resolve();
    window.addEventListener(AUTH_CHANGE_EVENT, resolve);
    return () => window.removeEventListener(AUTH_CHANGE_EVENT, resolve);
  }, []);

  /** 只限匿名：換一組新的匿名 ID */
  const resetAnonymousId = useCallback(() => {
    const id = randomUserId();
    window.localStorage.setItem(USER_KEY, id);
    window.localStorage.removeItem(LEGACY_KEY);
    setUserId(id);
    return id;
  }, []);

  return { userId, fromLogin, resetAnonymousId };
}
