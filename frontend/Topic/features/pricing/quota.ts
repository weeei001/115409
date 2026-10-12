import type { AskQuota } from './currentPlan';
import { ASK_PERIOD_LABEL, PLAN_LIMITS, formatCount, planById, type PlanId } from './plans';

/**
 * 額度的提示文字。次數、上限與是否用完都以後端 GET /subscription 為準（currentPlan.ts），
 * 後端也會擋：AI 提問用完回 429、收藏超過上限回 403。
 */

export interface LimitStatus {
  used: number;
  /** null＝不限 */
  limit: number | null;
  /** 已用到上限（含剛好等於） */
  reached: boolean;
}

export const limitStatus = (used: number, limit: number | null): LimitStatus => ({ used, limit, reached: limit != null && used >= limit });

/** 「今天已問 2／5 次」；後端擋住之前送出的提問可能讓次數略超過額度，這時寫實際次數與額度，不寫成 7／5 */
export function askUsageText(quota: AskQuota): string {
  const when = quota.per === 'day' ? '今天' : '本月';
  return quota.used > quota.limit
    ? `${when}已問 ${formatCount(quota.used)} 次（額度${ASK_PERIOD_LABEL[quota.per]} ${formatCount(quota.limit)} 次）`
    : `${when}已問 ${formatCount(quota.used)}／${formatCount(quota.limit)} 次`;
}

/** 用完額度時的說明（輸入框會停用） */
export function askReachedText(quota: AskQuota, planId: PlanId): string {
  const who = quota.guest ? '訪客' : planById(planId).name;
  const reset = quota.per === 'day' ? '明天（台北時間）恢復' : '下個月 1 日恢復';
  const upgrade = quota.guest
    ? `；登入後每日可問 ${formatCount(PLAN_LIMITS.free.ask.member)} 次`
    : planId === 'free'
      ? `；${planById('plus').name}每月可問 ${formatCount(PLAN_LIMITS.plus.ask.member)} 次`
      : planId === 'plus'
        ? `；${planById('pro').name}每月可問 ${formatCount(PLAN_LIMITS.pro.ask.member)} 次`
        : '';
  return `已用完${who}${ASK_PERIOD_LABEL[quota.per]} ${formatCount(quota.limit)} 次的 AI 提問額度，${reset}${upgrade}。個股頁的 AI 投資分析不受額度限制。`;
}

const upgradeTarget = (): string => `${planById('plus').name}起`;

/** 收藏股達到上限：不能再加入；降回免費版前加入的收藏會保留 */
export function favoritesLimitText(used: number, limit: number, planId: PlanId): string {
  const name = planById(planId).name;
  const state = used > limit
    ? `目前 ${formatCount(used)} 檔，超過${name}的 ${formatCount(limit)} 檔上限：已收藏的會保留，但不能再加入新的`
    : `${name}最多收藏 ${formatCount(limit)} 檔，已經收藏 ${formatCount(used)} 檔，要加入新的請先移除其他收藏`;
  return `${state}；${upgradeTarget()}收藏不限檔數。`;
}

/** 多股比較選的檔數超過方案上限：要先移除才能開始比較；已經比進階版的檔數少不了時，不再寫「進階版起…」 */
export function compareLimitText(selected: number, limit: number, planId: PlanId): string {
  const upgrade = limit < PLAN_LIMITS.plus.compare ? `；${upgradeTarget()}可以比到 ${formatCount(PLAN_LIMITS.plus.compare)} 檔` : '';
  return `${planById(planId).name}一次比較 ${formatCount(limit)} 檔，目前選了 ${formatCount(selected)} 檔，請先移除 ${formatCount(selected - limit)} 檔再開始比較${upgrade}。`;
}
