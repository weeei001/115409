/** localStorage 鍵：模擬下單使用者識別 */
export const SIMULATED_ORDER_USER_KEY = 'simulated_order_user_id';

const LEGACY_SIMULATED_ORDER_SESSION_KEY = 'simulated_order_session_id';

function randomUserId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function getOrCreateSimulatedUserId(): string {
  if (typeof window === 'undefined') return '';
  let id = window.localStorage.getItem(SIMULATED_ORDER_USER_KEY);
  if (!id || id.trim().length === 0) {
    id = window.localStorage.getItem(LEGACY_SIMULATED_ORDER_SESSION_KEY);
    if (id && id.trim().length > 0) {
      window.localStorage.setItem(SIMULATED_ORDER_USER_KEY, id.trim());
      window.localStorage.removeItem(LEGACY_SIMULATED_ORDER_SESSION_KEY);
    } else {
      id = randomUserId();
      window.localStorage.setItem(SIMULATED_ORDER_USER_KEY, id);
    }
  }
  return id;
}

export function resetSimulatedUserId(): string {
  if (typeof window === 'undefined') return '';
  const id = randomUserId();
  window.localStorage.setItem(SIMULATED_ORDER_USER_KEY, id);
  window.localStorage.removeItem(LEGACY_SIMULATED_ORDER_SESSION_KEY);
  return id;
}

/** 本地時區的 YYYY-MM-DD（用於 date input max / trade_date） */
export function getLocalDateString(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
