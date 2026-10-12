import { useEffect, useSyncExternalStore } from 'react';
import { userFacingMessage } from '@/lib/api/errorDetail';
import { activateSubscription, cancelSubscription, fetchSubscription } from '@/lib/api/subscription';
import { AUTH_CHANGE_EVENT, getStoredUser, getToken, isAuthSessionBoundary } from '@/lib/auth/storage';
import type { SubscriptionStatus } from '@/lib/types/api';
import { shiftYmdMonths } from '@/lib/utils/date';
import type { BillingPeriod, PlanId } from './plans';

/**
 * 目前方案與 AI 提問額度，來源是後端 GET /subscription（未登入時是訪客的免費版額度）。
 * 全站共用一份：登入、登出、換帳號、其他分頁開通或恢復、AI 提問送出後都會重新讀取。
 * 付費方案只能「模擬開通」（PUT /subscription，不經金流），畫面上標「展示」。
 */

export type PaidPlanId = Exclude<PlanId, 'free'>;

export const isPaidPlanId = (value: unknown): value is PaidPlanId => value === 'plus' || value === 'pro';
export const isBillingPeriod = (value: unknown): value is BillingPeriod => value === 'monthly' || value === 'yearly';

export interface PlanSubscription {
  plan: PaidPlanId;
  billing: BillingPeriod;
  /** 開通日（台北時間 YYYY-MM-DD） */
  startedOn: string;
  /** 下次續訂日（YYYY-MM-DD） */
  renewsOn: string;
}

export interface AskQuota {
  per: 'day' | 'month';
  limit: number;
  used: number;
  remaining: number;
  /** 下次歸零的時間（ISO） */
  resetsAt: string;
  /** 未登入，用訪客額度 */
  guest: boolean;
  /** 已用到上限（含剛好等於） */
  reached: boolean;
}

export interface PlanLimitsView {
  /** null＝不限 */
  favorites: number | null;
  compare: number;
  /** null＝不限 */
  historyDays: number | null;
  push: boolean;
}

export interface CurrentPlan {
  /** 'guest'，或登入帳號的 'user:<id>' */
  owner: string;
  signedIn: boolean;
  planId: PlanId;
  /** 模擬開通的付費方案；免費版是 null */
  subscription: PlanSubscription | null;
  /** 還沒讀到是 null */
  ask: AskQuota | null;
  /** 還沒讀到是 null；呼叫端不要用靜態數字代替，付費帳號讀到之前會被誤擋 */
  limits: PlanLimitsView | null;
  /** 已從後端讀到這個身分的方案 */
  ready: boolean;
  /** 最近一次讀取失敗的訊息 */
  error: string | null;
}

/** 本分頁開通或恢復時寫入，其他分頁靠 storage 事件重新讀取 */
const PLAN_SYNC_KEY = 'tei:plan-sync';
/** 視窗重新取得焦點時，距離上次讀取超過這個時間才再讀（其他裝置的提問也會計入額度） */
const FOCUS_REFRESH_MS = 60_000;

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

const TAIPEI_YMD = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' });

/** 台北時間的今天（YYYY-MM-DD） */
export const taipeiToday = (now = new Date()): string => TAIPEI_YMD.format(now);

/** 下次續訂日：月繳加 1 個月、年繳加 12 個月，目標月沒有那一天時取月底（和後端同一個算法，結帳頁預覽用） */
export const renewalDate = (startedOn: string, billing: BillingPeriod): string =>
  shiftYmdMonths(startedOn, billing === 'yearly' ? 12 : 1);

const emptyPlan = (owner: string): CurrentPlan => ({
  owner, signedIn: owner !== 'guest', planId: 'free', subscription: null, ask: null, limits: null, ready: false, error: null,
});

/** 後端回應轉成畫面用的形狀 */
export function toCurrentPlan(owner: string, data: SubscriptionStatus): CurrentPlan {
  const { ask, limits, subscription } = data;
  return {
    owner,
    signedIn: data.signed_in,
    planId: data.plan,
    subscription: subscription
      ? { plan: subscription.plan, billing: subscription.billing, startedOn: subscription.started_on, renewsOn: subscription.renews_on }
      : null,
    ask: {
      per: ask.per, limit: ask.limit, used: ask.used, remaining: ask.remaining, resetsAt: ask.resets_at, guest: ask.guest,
      reached: ask.used >= ask.limit,
    },
    limits: { favorites: limits.favorites, compare: limits.compare, historyDays: limits.history_days, push: limits.push },
    ready: true,
    error: null,
  };
}

const SERVER_SNAPSHOT = emptyPlan('guest');
let state: CurrentPlan = SERVER_SNAPSHOT;
let generation = 0;
let inflightOwner: string | null = null;
let loadedAt = 0;
const listeners = new Set<() => void>();

function emit(next: CurrentPlan): void {
  state = next;
  listeners.forEach((listener) => listener());
}

/** 重新讀取目前帳號的方案與用量；換了帳號時先清掉舊帳號的資料 */
export function refreshPlan(): Promise<void> {
  const owner = accountOwner();
  const request = ++generation;
  if (state.owner !== owner) emit(emptyPlan(owner));
  inflightOwner = owner;
  return fetchSubscription()
    .then((data) => {
      if (request !== generation || accountOwner() !== owner) return;
      loadedAt = Date.now();
      emit(toCurrentPlan(owner, data));
    })
    .catch((error) => {
      if (request !== generation || accountOwner() !== owner) return;
      emit({ ...state, error: userFacingMessage(error, '暫時無法讀取方案資料，請稍後再試。') });
    })
    .finally(() => {
      if (request === generation) inflightOwner = null;
    });
}

function ensureLoaded(): void {
  const owner = accountOwner();
  if (owner === state.owner && (state.ready || inflightOwner === owner)) return;
  void refreshPlan();
}

function apply(owner: string, data: SubscriptionStatus): CurrentPlan {
  generation += 1;
  inflightOwner = null;
  loadedAt = Date.now();
  const next = toCurrentPlan(owner, data);
  emit(next);
  try {
    window.localStorage.setItem(PLAN_SYNC_KEY, String(Date.now()));
  } catch {
    // 儲存空間不可用：其他分頁下次取得焦點時才會更新
  }
  return next;
}

/** 結帳頁的「模擬開通」：不付款；失敗時丟出 ApiRequestError */
export async function activatePlan(plan: PaidPlanId, billing: BillingPeriod): Promise<CurrentPlan> {
  const owner = accountOwner();
  return apply(owner, await activateSubscription({ plan, billing }));
}

/** 個人中心的「恢復免費版」 */
export async function cancelPlan(): Promise<CurrentPlan> {
  const owner = accountOwner();
  return apply(owner, await cancelSubscription());
}

const onAuthChange = () => void refreshPlan();
const onStorage = (event: StorageEvent) => {
  if (event.storageArea !== window.localStorage) return;
  if (event.key === PLAN_SYNC_KEY || isAuthSessionBoundary(event) || accountOwner() !== state.owner) void refreshPlan();
};
const onFocus = () => {
  if (Date.now() - loadedAt > FOCUS_REFRESH_MS) void refreshPlan();
};

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    window.addEventListener(AUTH_CHANGE_EVENT, onAuthChange);
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onFocus);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener(AUTH_CHANGE_EVENT, onAuthChange);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onFocus);
    }
  };
}

/** 目前帳號的方案；伺服器端與第一次讀到之前是 ready: false 的免費版 */
export function useCurrentPlan(): CurrentPlan {
  const plan = useSyncExternalStore(subscribe, () => state, () => SERVER_SNAPSHOT);
  useEffect(() => {
    ensureLoaded();
  }, []);
  return plan;
}
