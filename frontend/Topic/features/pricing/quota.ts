import { useMemo, useSyncExternalStore } from 'react';
import { browserStorage } from '@/lib/riskNotice';
import { taipeiToday } from './demoPlan';
import { ASK_PERIOD_LABEL, PLAN_LIMITS, QUOTA_NOT_ENFORCED, formatCount, planById, type PlanId, type PlanLimits } from './plans';

/**
 * 額度提示用的計數與判斷。展示期間只提示、不擋（方案頁已說明「系統目前沒有額度限制」）。
 * AI 提問次數是這台瀏覽器實際送出的次數（後端沒有用量 API），依身分（訪客／帳號）分開，跨日、跨月自動歸零。
 */
export const AI_ASK_USAGE_KEY = 'tei:ai-ask-usage:v1';
/** 本分頁記了一次提問時發出；其他分頁靠 storage 事件 */
export const AI_ASK_USAGE_EVENT = 'tei:ai-ask-usage';

interface AskUsageRecord {
  day: string;
  dayCount: number;
  month: string;
  monthCount: number;
}

export interface AskUsage {
  today: number;
  thisMonth: number;
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function readAll(storage: Pick<Storage, 'getItem'> | null | undefined): Record<string, AskUsageRecord> {
  try {
    const data: unknown = JSON.parse(storage?.getItem(AI_ASK_USAGE_KEY) ?? 'null');
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    return Object.fromEntries(Object.entries(data).filter((entry): entry is [string, AskUsageRecord] => {
      const item = entry[1] as Partial<AskUsageRecord> | null;
      return Boolean(item) && typeof item?.day === 'string' && typeof item.month === 'string' && isCount(item.dayCount) && isCount(item.monthCount);
    }));
  } catch {
    return {};
  }
}

/** 某個身分在 now 這一天、這個月（台北時間）的提問次數 */
export function readAskUsage(storage: Pick<Storage, 'getItem'> | null | undefined, owner: string, now = new Date()): AskUsage {
  const record = readAll(storage)[owner];
  const day = taipeiToday(now);
  return {
    today: record?.day === day ? record.dayCount : 0,
    thisMonth: record?.month === day.slice(0, 7) ? record.monthCount : 0,
  };
}

/** 記一次提問；寫不進去時不丟錯，回傳記錄後的次數 */
export function recordAskUsage(storage: Pick<Storage, 'getItem' | 'setItem'> | null | undefined, owner: string, now = new Date()): AskUsage {
  const current = readAskUsage(storage, owner, now);
  const next = { today: current.today + 1, thisMonth: current.thisMonth + 1 };
  const day = taipeiToday(now);
  try {
    const all = readAll(storage);
    all[owner] = { day, dayCount: next.today, month: day.slice(0, 7), monthCount: next.thisMonth };
    storage?.setItem(AI_ASK_USAGE_KEY, JSON.stringify(all));
  } catch {
    // 儲存空間不可用：這次不計
  }
  return next;
}

/** AI 對話與小燈送出提問時呼叫（useChat） */
export function recordAiAsk(owner: string): void {
  recordAskUsage(browserStorage(), owner);
  window.dispatchEvent(new Event(AI_ASK_USAGE_EVENT));
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** 台北是 UTC+8，沒有日光節約 */
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 到下一個台北午夜還有幾毫秒 */
export const msUntilTaipeiMidnight = (now = Date.now()): number => DAY_MS - ((now + TAIPEI_OFFSET_MS) % DAY_MS);

function subscribe(onChange: () => void): () => void {
  window.addEventListener(AI_ASK_USAGE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  // 頁面開著跨過台北午夜（換日、換月）時重讀一次，「今天」「本月」的次數才會歸零
  let timer = 0;
  const schedule = () => {
    timer = window.setTimeout(() => {
      onChange();
      schedule();
    }, msUntilTaipeiMidnight() + 1000);
  };
  schedule();
  return () => {
    window.clearTimeout(timer);
    window.removeEventListener(AI_ASK_USAGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** 快照帶台北日期：資料沒變但換日時快照也會不同 */
const usageSnapshot = (): string => {
  let raw = '';
  try {
    raw = browserStorage()?.getItem(AI_ASK_USAGE_KEY) ?? '';
  } catch {
    // 儲存空間不可用：當成沒有紀錄
  }
  return `${taipeiToday()}\n${raw}`;
};

export function useAskUsage(owner: string): AskUsage {
  const snapshot = useSyncExternalStore(subscribe, usageSnapshot, () => '');
  return useMemo(() => {
    const raw = snapshot.slice(snapshot.indexOf('\n') + 1);
    return readAskUsage({ getItem: () => raw || null }, owner);
  }, [snapshot, owner]);
}

export interface LimitStatus {
  used: number;
  /** null＝不限 */
  limit: number | null;
  /** 已用到上限（含剛好等於） */
  reached: boolean;
}

export const limitStatus = (used: number, limit: number | null): LimitStatus => ({ used, limit, reached: limit != null && used >= limit });

export interface AskQuota extends LimitStatus {
  limit: number;
  per: PlanLimits['ask']['per'];
  guest: boolean;
}

/** 目前方案的 AI 提問額度：免費版訪客用訪客額度，其餘用會員額度 */
export function askQuota(planId: PlanId, signedIn: boolean, usage: AskUsage): AskQuota {
  const { per, member, guest } = PLAN_LIMITS[planId].ask;
  const limit = !signedIn && guest != null ? guest : member;
  const used = per === 'day' ? usage.today : usage.thisMonth;
  return { ...limitStatus(used, limit), limit, per, guest: !signedIn && guest != null };
}

/** 「今天已問 2／5 次」；超過時寫實際次數與額度，不寫成 7／5 */
export function askUsageText(quota: AskQuota): string {
  const when = quota.per === 'day' ? '今天' : '本月';
  return quota.used > quota.limit
    ? `${when}已問 ${formatCount(quota.used)} 次（額度${ASK_PERIOD_LABEL[quota.per]} ${formatCount(quota.limit)} 次）`
    : `${when}已問 ${formatCount(quota.used)}／${formatCount(quota.limit)} 次`;
}

/** 用完額度時的說明（只提示、不擋） */
export function askReachedText(quota: AskQuota, planId: PlanId): string {
  const who = quota.guest ? '訪客' : planById(planId).name;
  const period = ASK_PERIOD_LABEL[quota.per];
  const login = quota.guest ? `登入後${period} ${formatCount(PLAN_LIMITS.free.ask.member)} 次；` : '';
  return `已用完${who}${period} ${formatCount(quota.limit)} 次的 AI 提問額度。${login}${QUOTA_NOT_ENFORCED}，仍可繼續提問；個股頁的 AI 投資分析不受額度限制。`;
}

const upgradeTarget = (): string => `${planById('plus').name}起`;

/** 收藏股達到上限時的說明（只提示、不擋） */
export function favoritesLimitText(used: number, limit: number, planId: PlanId): string {
  return `${used > limit ? '已超過' : '已達到'}${planById(planId).name}的 ${formatCount(limit)} 檔收藏上限（目前 ${formatCount(used)} 檔）。${QUOTA_NOT_ENFORCED}，仍可繼續加入；${upgradeTarget()}收藏不限檔數。`;
}

/** 多股比較超過同時檔數時的說明（只提示、不擋）；已經比進階版的檔數少不了時，不再寫「進階版起…」 */
export function compareLimitText(selected: number, limit: number, planId: PlanId): string {
  const upgrade = limit < PLAN_LIMITS.plus.compare ? `；${upgradeTarget()}可以比到 ${formatCount(PLAN_LIMITS.plus.compare)} 檔` : '';
  return `${planById(planId).name}一次比較 ${formatCount(limit)} 檔，目前選了 ${formatCount(selected)} 檔。${QUOTA_NOT_ENFORCED}，仍可照常比較${upgrade}。`;
}
