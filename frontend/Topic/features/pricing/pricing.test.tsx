import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterContext } from 'next/dist/shared/lib/router-context.shared-runtime';
import type { NextRouter } from 'next/router';
import { comparisonGroups, DESKTOP_MASCOT, PAYMENT_UNAVAILABLE, PLANS, PRICING_DEMO_NOTICE, formatTwd, planById, yearlyInMonths, yearlyPerMonth, type PlanCell } from './plans';
import { askReachedText, askUsageText, compareLimitText, favoritesLimitText, limitStatus } from './quota';
import { isBillingPeriod, isPaidPlanId, renewalDate, taipeiToday, toCurrentPlan, type AskQuota } from './currentPlan';
import type { SubscriptionStatus } from '@/lib/types/api';
import { REVENUE_SCENARIOS, payersToCover, scenarioAssumptions, simulateMonthlyRevenue, unitEconomics } from './revenue';
import { PlanCard } from './PlanCards';
import PricingPage from '../../pages/pricing';
import { CheckoutContent } from './CheckoutContent';
import CheckoutPage from '../../pages/checkout';

const router = (pathname: string, query: Record<string, string> = {}) => ({
  route: pathname,
  pathname,
  asPath: pathname,
  query,
  isReady: true,
  events: { on() {}, off() {}, emit() {} },
  push: async () => true,
  replace: async () => true,
  prefetch: async () => {},
  back() {},
  beforePopState() {},
}) as unknown as NextRouter;

const render = (node: React.ReactElement, path = '/pricing', query: Record<string, string> = {}) =>
  renderToStaticMarkup(<RouterContext.Provider value={router(path, query)}>{node}</RouterContext.Provider>);


/** 方案不是漲跌資料：不能用 up／down token（台股紅漲綠跌只給漲跌與多空） */
const UP_DOWN = /\b(?:text|bg|border)-(?:up|down)(?:-[a-z]+)?\b/;
/** 商業模式 7.1：方案頁與行銷文案不寫這些字 */
const FORBIDDEN_COPY = /投資顧問|明牌|勝率|保證獲利/;

// 價格：年繳等於 10 個月，折合每月照商業模式第 5 節
{
  assert.deepEqual(PLANS.map((plan) => yearlyInMonths(plan)), [null, 10, 10]);
  assert.equal(yearlyPerMonth(planById('plus')), 82.5);
  assert.equal(yearlyPerMonth(planById('pro')), 207.5);
  assert.equal(formatTwd(2490), 'NT$2,490');
  assert.equal(formatTwd(82.5), 'NT$82.5');
}

// 比較表的額度由 PLAN_LIMITS 產生，方案卡的重點寫的是同一組數字
{
  const quantityRows = (stockCount: number | null) => comparisonGroups(stockCount).find((group) => group.id === 'quantity')!.rows;
  const cellText = (feature: string, stockCount: number | null = 42) => {
    const row = quantityRows(stockCount).find((item) => item.feature === feature)!;
    return PLANS.map((plan) => {
      const cell: PlanCell = row.cells[plan.id];
      return cell.kind === 'quota' ? [cell.text, cell.note ?? ''].join('|') : cell.kind;
    });
  };
  assert.deepEqual(cellText('AI 對話與小燈提問次數'), ['會員每日 5 次|訪客每日 3 次，對話不保存', '每月 300 次|', '每月 1,000 次|']);
  // 收錄檔數來自 /stocks/info（管理員可新增），不是寫死的 40；還沒讀到就不寫數字
  assert.deepEqual(cellText('收藏股檔數'), ['10 檔|', '不限|目前系統涵蓋 42 檔', '不限|']);
  assert.deepEqual(cellText('收藏股檔數', null), ['10 檔|', '不限|', '不限|']);
  assert.deepEqual(cellText('多股比較同時檔數'), ['5 檔|', '30 檔|系統上限', '30 檔|']);
  const highlights = (id: 'free' | 'plus' | 'pro') => planById(id).highlights.map((item) => item.text).join('；');
  assert.match(highlights('free'), /會員每日 5 次、訪客每日 3 次/);
  assert.match(highlights('free'), /收藏股 10 檔、多股比較 5 檔/);
  assert.match(highlights('plus'), /每月 300 次/);
  assert.match(highlights('plus'), /多股比較 30 檔/);
  assert.match(highlights('pro'), /每月 1,000 次/);
}

// GET /subscription 的回應轉成畫面用的形狀；用到上限（含剛好等於）才算用完
{
  const response: SubscriptionStatus = {
    plan: 'plus', signed_in: true,
    subscription: { plan: 'plus', billing: 'yearly', started_on: '2026-10-11', renews_on: '2027-10-11' },
    ask: { per: 'month', limit: 300, used: 300, remaining: 0, resets_at: '2026-10-31T16:00:00Z', guest: false },
    limits: { favorites: null, compare: 30, history_days: null, push: true },
    favorites_used: 12,
  };
  const plan = toCurrentPlan('user:7', response);
  assert.equal(plan.planId, 'plus');
  assert.equal(plan.ready, true);
  assert.deepEqual(plan.subscription, { plan: 'plus', billing: 'yearly', startedOn: '2026-10-11', renewsOn: '2027-10-11' });
  assert.equal(plan.ask?.reached, true);
  assert.equal(plan.ask?.resetsAt, '2026-10-31T16:00:00Z');
  assert.deepEqual(plan.limits, { favorites: null, compare: 30, historyDays: null, push: true });
  const guest = toCurrentPlan('guest', { ...response, plan: 'free', signed_in: false, subscription: null,
    ask: { per: 'day', limit: 3, used: 2, remaining: 1, resets_at: '2026-10-11T16:00:00Z', guest: true },
    limits: { favorites: 10, compare: 5, history_days: 30, push: false }, favorites_used: null });
  assert.equal(guest.signedIn, false);
  assert.equal(guest.subscription, null);
  assert.equal(guest.ask?.reached, false);
  assert.equal(guest.limits?.historyDays, 30);
}

// 額度提示：訪客 3 次、會員 5 次（每日），付費版每月；用完時說明何時恢復與升級後的額度
{
  const quota = (per: AskQuota['per'], limit: number, used: number, guest = false): AskQuota =>
    ({ per, limit, used, remaining: Math.max(0, limit - used), resetsAt: '', guest, reached: used >= limit });
  assert.equal(askReachedText(quota('day', 3, 3, true), 'free'),
    '已用完訪客每日 3 次的 AI 提問額度，明天（台北時間）恢復；登入後每日可問 5 次。個股頁的 AI 投資分析不受額度限制。');
  assert.match(askReachedText(quota('day', 5, 5), 'free'), /^已用完免費版每日 5 次.*；進階版每月可問 300 次。/);
  assert.equal(askUsageText(quota('day', 5, 2)), '今天已問 2／5 次');
  assert.equal(askUsageText(quota('month', 300, 301)), '本月已問 301 次（額度每月 300 次）');
  assert.match(askReachedText(quota('month', 300, 300), 'plus'), /^已用完進階版每月 300 次.*下個月 1 日恢復；專業版每月可問 1,000 次。/);
  assert.doesNotMatch(askReachedText(quota('month', 1000, 1000), 'pro'), /可問/);
  assert.equal(limitStatus(99, null).reached, false, 'unlimited never reaches');
  assert.equal(favoritesLimitText(10, 10, 'free'), '免費版最多收藏 10 檔，已經收藏 10 檔，要加入新的請先移除其他收藏；進階版起收藏不限檔數。');
  assert.match(favoritesLimitText(11, 10, 'free'), /^目前 11 檔，超過免費版的 10 檔上限：已收藏的會保留/);
  assert.equal(compareLimitText(7, 5, 'free'), '免費版一次比較 5 檔，目前選了 7 檔，請先移除 2 檔再開始比較；進階版起可以比到 30 檔。');
  // 進階版、專業版已經是系統上限：不寫「進階版起…」，不然選到 31 檔時提示會自相矛盾
  assert.doesNotMatch(compareLimitText(31, 30, 'plus'), /進階版起/);
  assert.equal(compareLimitText(31, 30, 'pro'), '專業版一次比較 30 檔，目前選了 31 檔，請先移除 1 檔再開始比較。');
}

// 結帳頁的續訂日預覽和後端同一個算法；網址參數的方案與繳費週期要驗證
{
  assert.equal(taipeiToday(new Date('2026-10-11T16:30:00Z')), '2026-10-12', 'UTC 16:30 is already the next day in Taipei');
  assert.equal(renewalDate('2026-10-11', 'monthly'), '2026-11-11');
  assert.equal(renewalDate('2026-10-11', 'yearly'), '2027-10-11');
  assert.equal(renewalDate('2026-01-31', 'monthly'), '2026-02-28');
  assert.ok(isPaidPlanId('pro') && !isPaidPlanId('free') && !isPaidPlanId('enterprise'));
  assert.ok(isBillingPeriod('yearly') && !isBillingPeriod('weekly'));
}

// 營收試算重現商業模式第 6.3 節的表
{
  const expected = {
    conservative: [2580, 133, 818, 356, 297, 750, 225],
    base: [38700, 1991, 8101, 5345, 4454, 750, 18057],
    optimistic: [322500, 16595, 39672, 44544, 37120, 750, 183819],
  };
  for (const scenario of REVENUE_SCENARIOS) {
    const r = simulateMonthlyRevenue(scenarioAssumptions(scenario));
    assert.deepEqual([r.revenue, r.fees, r.aiFree, r.aiPlus, r.aiPro, r.fixedLlm, r.contribution].map(Math.round), expected[scenario.id], scenario.id);
  }
  const base = simulateMonthlyRevenue(scenarioAssumptions(REVENUE_SCENARIOS[1]));
  assert.deepEqual([base.paid, base.plus, base.pro], [300, 240, 60]);
  assert.equal(base.netPerPayer.toFixed(1), '62.7');
  assert.equal(payersToCover(base.fixedLlm, base.netPerPayer), 12);
  assert.equal(payersToCover(50_000 + base.fixedLlm, base.netPerPayer), 810);
  const round = (value: number, digits: number) => Number(value.toFixed(digits));
  assert.deepEqual(unitEconomics(scenarioAssumptions(REVENUE_SCENARIOS[1])).map((u) => [u.planId, round(u.fee, 2), round(u.llmCost, 1), round(u.contribution, 1), round(u.fullQuotaContribution, 1)]), [
    ['plus', 6.25, 22.3, 70.5, 37.1],
    ['pro', 8.19, 74.2, 166.6, 55.2],
  ]);
}

// 方案卡：升級鈕帶到結帳示意頁（不接金流），目前方案標出來
{
  const cards = (current: 'free' | 'plus', billing: 'monthly' | 'yearly') =>
    render(<>{PLANS.map((plan) => <PlanCard key={plan.id} plan={plan} billing={billing} currentPlanId={current} />)}</>);
  const free = cards('free', 'yearly');
  assert.match(free, /href="\/checkout\?plan=plus&amp;billing=yearly"[^>]*>升級到進階版</);
  assert.match(free, /href="\/checkout\?plan=pro&amp;billing=yearly"[^>]*>升級到專業版</);
  assert.ok(free.includes('目前方案'));
  const plus = cards('plus', 'monthly');
  assert.ok(plus.includes('目前方案（展示）'));
  assert.match(plus, /href="\/checkout\?plan=pro&amp;billing=monthly"[^>]*>升級到專業版</);
  assert.ok(plus.includes('恢復免費版'));
  assert.doesNotMatch(free + plus, UP_DOWN);
}

// 方案頁：伺服器端先當成訪客的免費版；預設年繳，有專題展示聲明，不用漲跌色
{
  const html = render(<PricingPage />);
  assert.ok(html.includes(PRICING_DEMO_NOTICE));
  assert.match(html, /aria-label="計費週期"/);
  assert.match(html, /NT\$990<\/span>/);
  assert.ok(!html.includes('NT$99</span>'), 'yearly prices by default');
  assert.equal(html.match(/<h1[\s>]/g)?.length, 1);
  assert.doesNotMatch(html, UP_DOWN);
  assert.doesNotMatch(html, FORBIDDEN_COPY);
  // 商業模式第 8 節 #14：/pricing#desktop 的桌面小燈介紹，標規劃中與進階版起
  const desktop = /<section[^>]*id="desktop"[^>]*>([\s\S]*?)<\/section>/.exec(html)?.[1] ?? '';
  assert.match(desktop, /桌面小燈/);
  assert.match(desktop, /規劃中/);
  assert.match(desktop, /進階版起/);
  assert.ok(desktop.includes(DESKTOP_MASCOT.summary));
  assert.ok(html.indexOf('id="desktop"') > html.indexOf('pricing-compare-heading'), 'after the comparison table');
}

// 結帳示意頁：伺服器端一律先畫「讀取中」（不讀查詢字串），hydration 才不會和瀏覽器端不一致
{
  const queries: Array<Record<string, string>> = [{}, { plan: 'pro', billing: 'monthly' }];
  for (const query of queries) {
    const html = render(<CheckoutPage />, '/checkout', query);
    assert.ok(html.includes('讀取方案中…'));
    assert.ok(!html.includes('找不到要結帳的方案') && !html.includes('NT$249'));
  }
}

// 結帳內容：金額、金流尚未串接的說明；沒登入要先登入，不明的方案回方案頁
{
  const html = render(<CheckoutContent planId="pro" billing="monthly" />, '/checkout', { plan: 'pro', billing: 'monthly' });
  assert.match(html, /NT\$249<\/span>/);
  assert.ok(html.includes(PAYMENT_UNAVAILABLE));
  assert.ok(html.includes('登入後繼續'));
  assert.match(html, /href="\/login\?returnUrl=%2Fcheckout"/);
  assert.ok(!html.includes('模擬開通（不付款）</button>'), 'guests cannot activate');
  assert.doesNotMatch(html, UP_DOWN);
  assert.doesNotMatch(html, FORBIDDEN_COPY);
  assert.ok(render(<CheckoutContent planId={null} billing="yearly" />, '/checkout').includes('找不到要結帳的方案'));
}

console.log('Pricing passed: prices, derived quotas, subscription response mapping, quota hints, renewal preview, revenue model vs business-model §6.3, plan cards, pricing and checkout pages.');
