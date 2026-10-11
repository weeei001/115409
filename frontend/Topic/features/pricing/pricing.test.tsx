import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterContext } from 'next/dist/shared/lib/router-context.shared-runtime';
import type { NextRouter } from 'next/router';
import { COMPARISON_GROUPS, PAYMENT_UNAVAILABLE, PLANS, PRICING_DEMO_NOTICE, formatTwd, planById, yearlyInMonths, yearlyPerMonth, type PlanCell } from './plans';
import { askQuota, askReachedText, askUsageText, compareLimitText, favoritesLimitText, limitStatus, msUntilTaipeiMidnight, readAskUsage, recordAskUsage } from './quota';
import { demoRenewalDate, parseCurrentPlan, readDemoSubscription, taipeiToday, writeDemoSubscription, type DemoSubscription } from './demoPlan';
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

const memoryStorage = () => {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
};
const blocked = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('QuotaExceededError'); } };

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
  const quantity = COMPARISON_GROUPS.find((group) => group.id === 'quantity')!;
  const cellText = (feature: string) => {
    const row = quantity.rows.find((item) => item.feature === feature)!;
    return PLANS.map((plan) => {
      const cell: PlanCell = row.cells[plan.id];
      return cell.kind === 'quota' ? [cell.text, cell.note ?? ''].join('|') : cell.kind;
    });
  };
  assert.deepEqual(cellText('AI 對話與小燈提問次數'), ['會員每日 5 次|訪客每日 3 次，對話不保存', '每月 300 次|', '每月 1,000 次|']);
  assert.deepEqual(cellText('收藏股檔數'), ['10 檔|', '不限|目前系統涵蓋 40 檔', '不限|']);
  assert.deepEqual(cellText('多股比較同時檔數'), ['5 檔|', '30 檔|系統上限', '30 檔|']);
  const highlights = (id: 'free' | 'plus' | 'pro') => planById(id).highlights.map((item) => item.text).join('；');
  assert.match(highlights('free'), /會員每日 5 次、訪客每日 3 次/);
  assert.match(highlights('free'), /收藏股 10 檔、多股比較 5 檔/);
  assert.match(highlights('plus'), /每月 300 次/);
  assert.match(highlights('plus'), /多股比較 30 檔/);
  assert.match(highlights('pro'), /每月 1,000 次/);
}

// AI 提問次數：依身分分開，台北時間跨日、跨月歸零；儲存空間不能用時不丟錯
{
  const storage = memoryStorage();
  const day1 = new Date('2026-10-11T03:00:00Z');
  recordAskUsage(storage, 'user:7', day1);
  assert.deepEqual(recordAskUsage(storage, 'user:7', day1), { today: 2, thisMonth: 2 });
  assert.deepEqual(readAskUsage(storage, 'guest', day1), { today: 0, thisMonth: 0 }, 'guests are counted separately');
  // UTC 10/11 16:30 是台北 10/12 00:30：已經是隔天
  const day2 = new Date('2026-10-11T16:30:00Z');
  assert.equal(taipeiToday(day2), '2026-10-12');
  assert.deepEqual(readAskUsage(storage, 'user:7', day2), { today: 0, thisMonth: 2 });
  assert.deepEqual(recordAskUsage(storage, 'user:7', day2), { today: 1, thisMonth: 3 });
  assert.deepEqual(readAskUsage(storage, 'user:7', new Date('2026-11-01T01:00:00Z')), { today: 0, thisMonth: 0 });
  storage.values.set('tei:ai-ask-usage:v1', '{bad json');
  assert.deepEqual(readAskUsage(storage, 'user:7', day1), { today: 0, thisMonth: 0 });
  assert.doesNotThrow(() => recordAskUsage(blocked, 'user:7', day1));
  assert.deepEqual(readAskUsage(blocked, 'user:7', day1), { today: 0, thisMonth: 0 });
}

// 額度判斷：訪客 3 次、會員 5 次（每日），付費版每月；用完只提示
{
  const guest = askQuota('free', false, { today: 3, thisMonth: 9 });
  assert.equal(guest.limit, 3);
  assert.equal(guest.reached, true);
  assert.match(askReachedText(guest, 'free'), /^已用完訪客每日 3 次的 AI 提問額度。登入後每日 5 次；展示期間不限制/);
  const member = askQuota('free', true, { today: 2, thisMonth: 40 });
  assert.equal(askUsageText(member), '今天已問 2／5 次');
  assert.equal(member.reached, false);
  const plus = askQuota('plus', true, { today: 50, thisMonth: 301 });
  assert.equal(askUsageText(plus), '本月已問 301 次（額度每月 300 次）');
  assert.match(askReachedText(plus, 'plus'), /^已用完進階版每月 300 次/);
  assert.equal(limitStatus(99, null).reached, false, 'unlimited never reaches');
  assert.match(favoritesLimitText(10, 10, 'free'), /^已達到免費版的 10 檔收藏上限（目前 10 檔）。展示期間不限制/);
  assert.match(favoritesLimitText(11, 10, 'free'), /^已超過/);
  assert.match(compareLimitText(7, 5, 'free'), /免費版一次比較 5 檔，目前選了 7 檔。.*進階版起可以比到 30 檔/);
}

// 展示方案：依帳號分開記，訪客不能開通，壞掉的資料當成免費版
{
  const storage = memoryStorage();
  const sub: DemoSubscription = { plan: 'plus', billing: 'yearly', startedOn: '2026-10-11' };
  assert.equal(writeDemoSubscription(storage, 'guest', sub), false);
  assert.equal(writeDemoSubscription(storage, 'user:7', sub), true);
  assert.deepEqual(readDemoSubscription(storage, 'user:7'), sub);
  assert.equal(readDemoSubscription(storage, 'user:8'), null);
  assert.equal(readDemoSubscription(storage, 'guest'), null);
  assert.equal(writeDemoSubscription(storage, 'user:7', null), true);
  assert.equal(readDemoSubscription(storage, 'user:7'), null);
  storage.values.set('tei:demo-plan:v1', JSON.stringify({ 'user:7': { plan: 'enterprise', billing: 'yearly', startedOn: '2026-10-11' } }));
  assert.equal(readDemoSubscription(storage, 'user:7'), null);
  assert.equal(writeDemoSubscription(blocked, 'user:7', sub), false);
  assert.equal(demoRenewalDate({ ...sub, billing: 'monthly' }), '2026-11-11');
  assert.equal(demoRenewalDate(sub), '2027-10-11');
  assert.equal(demoRenewalDate({ plan: 'pro', billing: 'monthly', startedOn: '2026-01-31' }), '2026-02-28');
  assert.deepEqual(parseCurrentPlan(''), { owner: 'guest', signedIn: false, planId: 'free', subscription: null, ready: false });
  assert.equal(parseCurrentPlan(JSON.stringify(['user:7', sub])).planId, 'plus');
  assert.equal(parseCurrentPlan(JSON.stringify(['user:7', null])).planId, 'free');
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

// 頁面開著跨過台北午夜時重讀次數：倒數到下一個台北 00:00
{
  assert.equal(msUntilTaipeiMidnight(Date.parse('2026-10-11T15:59:00Z')), 60_000, 'Taipei 23:59 → 1 minute');
  assert.equal(msUntilTaipeiMidnight(Date.parse('2026-10-11T16:00:00Z')), 24 * 60 * 60 * 1000, 'Taipei 00:00 → next midnight');
  assert.equal(msUntilTaipeiMidnight(Date.parse('2026-10-11T04:00:00Z')), 12 * 60 * 60 * 1000, 'Taipei noon → 12 hours');
}

console.log('Pricing passed: prices, derived quotas, local ask usage, quota hints, demo plan store, revenue model vs business-model §6.3, plan cards, pricing and checkout pages.');
