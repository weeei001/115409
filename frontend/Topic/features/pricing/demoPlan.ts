import { useMemo, useSyncExternalStore } from 'react';
import { AUTH_CHANGE_EVENT, getStoredUser, getToken } from '@/lib/auth/storage';
import { browserStorage } from '@/lib/riskNotice';
import { shiftYmdMonths } from '@/lib/utils/date';
import type { BillingPeriod, PlanId } from './plans';

/**
 * 展示用的「目前方案」。後端沒有方案或訂閱資料（商業模式 F34、F35），
 * 結帳示意頁的「模擬開通」把付費方案記在這個瀏覽器、依登入帳號分開；訪客一律是免費版。
 * 不付款、不呼叫 API，畫面上一律標「展示」。
 */
export const DEMO_PLAN_KEY = 'tei:demo-plan:v1';
/** 本分頁改了方案時發出；其他分頁靠 storage 事件 */
export const DEMO_PLAN_EVENT = 'tei:demo-plan-change';

export type PaidPlanId = Exclude<PlanId, 'free'>;

export interface DemoSubscription {
  plan: PaidPlanId;
  billing: BillingPeriod;
  /** 模擬開通日（台北時間 YYYY-MM-DD） */
  startedOn: string;
}

type DemoStorage = Pick<Storage, 'getItem' | 'setItem'>;

const TAIPEI_YMD = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' });

/** 台北時間的今天（YYYY-MM-DD） */
export const taipeiToday = (now = new Date()): string => TAIPEI_YMD.format(now);

export const isPaidPlanId = (value: unknown): value is PaidPlanId => value === 'plus' || value === 'pro';
export const isBillingPeriod = (value: unknown): value is BillingPeriod => value === 'monthly' || value === 'yearly';

function isDemoSubscription(value: unknown): value is DemoSubscription {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<DemoSubscription>;
  return isPaidPlanId(item.plan) && isBillingPeriod(item.billing) && typeof item.startedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.startedOn);
}

/** 'guest'，或登入帳號的 'user:<id>'（和 AI 對話的對話歸屬同一種寫法）；讀不到使用者 id 時當成訪客 */
export function accountOwner(): string {
  try {
    if (!getToken()) return 'guest';
    const id = getStoredUser()?.id;
    return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? `user:${id}` : 'guest';
  } catch {
    return 'guest';
  }
}

function readAll(storage: Pick<Storage, 'getItem'> | null | undefined): Record<string, DemoSubscription> {
  try {
    const data: unknown = JSON.parse(storage?.getItem(DEMO_PLAN_KEY) ?? 'null');
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    return Object.fromEntries(Object.entries(data).filter((entry): entry is [string, DemoSubscription] => isDemoSubscription(entry[1])));
  } catch {
    return {};
  }
}

export function readDemoSubscription(storage: Pick<Storage, 'getItem'> | null | undefined, owner: string): DemoSubscription | null {
  return owner.startsWith('user:') ? readAll(storage)[owner] ?? null : null;
}

/** 訪客不能開通；寫不進去（無痕、封鎖網站資料）回傳 false，不丟錯 */
export function writeDemoSubscription(storage: DemoStorage | null | undefined, owner: string, subscription: DemoSubscription | null): boolean {
  if (!storage || !owner.startsWith('user:')) return false;
  try {
    const all = readAll(storage);
    if (subscription) all[owner] = subscription;
    else delete all[owner];
    storage.setItem(DEMO_PLAN_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

function changeDemoPlan(subscription: DemoSubscription | null): boolean {
  const ok = writeDemoSubscription(browserStorage(), accountOwner(), subscription);
  if (ok) window.dispatchEvent(new Event(DEMO_PLAN_EVENT));
  return ok;
}

/** 結帳示意頁的「模擬開通」：不付款，只切換這個帳號在這台瀏覽器顯示的方案 */
export const startDemoSubscription = (plan: PaidPlanId, billing: BillingPeriod, now = new Date()): boolean =>
  changeDemoPlan({ plan, billing, startedOn: taipeiToday(now) });

/** 個人中心的「恢復免費版」 */
export const endDemoSubscription = (): boolean => changeDemoPlan(null);

/** 下次續訂日（展示）：月繳加 1 個月、年繳加 12 個月，目標月沒有那一天時取月底 */
export const demoRenewalDate = (subscription: DemoSubscription): string =>
  shiftYmdMonths(subscription.startedOn, subscription.billing === 'yearly' ? 12 : 1);

function subscribe(onChange: () => void): () => void {
  window.addEventListener(DEMO_PLAN_EVENT, onChange);
  window.addEventListener(AUTH_CHANGE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(DEMO_PLAN_EVENT, onChange);
    window.removeEventListener(AUTH_CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

const snapshot = (): string => {
  const owner = accountOwner();
  return JSON.stringify([owner, readDemoSubscription(browserStorage(), owner)]);
};

export interface CurrentPlan {
  owner: string;
  signedIn: boolean;
  planId: PlanId;
  /** 模擬開通的付費方案；免費版是 null */
  subscription: DemoSubscription | null;
  /** 已在瀏覽器讀過登入狀態（伺服器端與 hydration 時是 false，先當成訪客的免費版） */
  ready: boolean;
}

export function parseCurrentPlan(value: string): CurrentPlan {
  try {
    const [owner, subscription] = JSON.parse(value) as [string, DemoSubscription | null];
    return { owner, signedIn: owner !== 'guest', planId: subscription?.plan ?? 'free', subscription, ready: true };
  } catch {
    return { owner: 'guest', signedIn: false, planId: 'free', subscription: null, ready: false };
  }
}

/** 目前帳號在這台瀏覽器的展示方案；登入、登出、換帳號、其他分頁開通或恢復都會更新 */
export function useCurrentPlan(): CurrentPlan {
  const value = useSyncExternalStore(subscribe, snapshot, () => '');
  return useMemo(() => parseCurrentPlan(value), [value]);
}
