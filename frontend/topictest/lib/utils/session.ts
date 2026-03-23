export const SIMULATED_ORDER_SESSION_KEY = 'simulated_order_session_id';

export function getOrCreateSimulatedSessionId(): string {
  if (typeof window === 'undefined') return '';
  let id = window.localStorage.getItem(SIMULATED_ORDER_SESSION_KEY);
  if (!id || id.trim().length === 0) {
    id = crypto.randomUUID();
    window.localStorage.setItem(SIMULATED_ORDER_SESSION_KEY, id);
  }
  return id;
}

export function resetSimulatedSessionId(): string {
  if (typeof window === 'undefined') return '';
  const id = crypto.randomUUID();
  window.localStorage.setItem(SIMULATED_ORDER_SESSION_KEY, id);
  return id;
}

/** 本地時區的 YYYY-MM-DD（用於 date input max / trade_date） */
export function getLocalDateString(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
