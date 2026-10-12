import assert from 'node:assert/strict';
import type { ForeignShareholdingResponse, HoldingShareLevelResponse, MarginTradeResponse } from '../types/api';
import { buildForeignHoldingDays, buildHoldingWeeks, buildMarginDays, holdingLevelMin } from './holdings';

// 融資融券：餘額增減、券資比；日期由舊到新
const margin = (date: string, today: number | null, yesterday: number | null, shortToday: number | null): MarginTradeResponse => ({
  date, symbol: '2330',
  margin_purchase_buy: 378, margin_purchase_cash_repayment: 14, margin_purchase_limit: 6483092, margin_purchase_sell: 687,
  margin_purchase_today_balance: today, margin_purchase_yesterday_balance: yesterday, note: null, offset_loan_and_short: 0,
  short_sale_buy: 1, short_sale_cash_repayment: 0, short_sale_limit: 6483092, short_sale_sell: 13,
  short_sale_today_balance: shortToday, short_sale_yesterday_balance: 29,
});
const days = buildMarginDays([margin('2026-09-02', 28476, 27740, 25), margin('2026-09-01', 27740, 28063, 41), margin('2026-09-03', 0, null, 26)]);
assert.deepEqual(days.map((d) => d.date), ['2026-09-01', '2026-09-02', '2026-09-03']);
assert.equal(days[0].marginChange, -323);
assert.equal(days[1].marginChange, 736);
assert.equal(days[0].shortChange, 12);
assert.ok(Math.abs(days[1].shortMarginRatio! - (25 / 28476) * 100) < 1e-12);
assert.equal(days[2].marginChange, null, '缺前日餘額不算增減');
assert.equal(days[2].shortMarginRatio, null, '融資餘額 0 不算券資比');

// 外資持股：比例是百分比字串
const foreign = (date: string, ratio: string | null, shares: number | null): ForeignShareholdingResponse => ({
  date, symbol: '2330', stock_name: '台積電', international_code: null, foreign_investment_remaining_shares: null,
  foreign_investment_shares: shares, foreign_investment_remain_ratio: '30.76', foreign_investment_shares_ratio: ratio,
  foreign_investment_upper_limit_ratio: '100.0000', chinese_investment_upper_limit_ratio: null, number_of_shares_issued: 25932370067,
  recently_declare_date: null, note: null,
});
const foreignDays = buildForeignHoldingDays([foreign('2026-09-02', '69.1800', 17941316956), foreign('2026-09-01', '69.2300', 17953125952), foreign('2026-09-03', null, null)]);
assert.deepEqual(foreignDays.map((d) => [d.date, d.ratio]), [['2026-09-01', 69.23], ['2026-09-02', 69.18]]);

// 集保股權分散：級距依股數排序、合計另列、差異數調整不列；最大級距是超過 1,000 張
assert.equal(holdingLevelMin('1-999'), 1);
assert.equal(holdingLevelMin('1,000-5,000'), 1000);
assert.equal(holdingLevelMin('1,000,001以上'), 1000001);
assert.equal(holdingLevelMin('合計'), null);
assert.equal(holdingLevelMin('差異數調整'), null);
const level = (date: string, holding_shares_level: string, people: number, percent: string, unit: number): HoldingShareLevelResponse => ({
  date, symbol: '2330', holding_shares_level, people, percent, unit,
});
const weeks = buildHoldingWeeks([
  level('2026-10-08', '1,000,001以上', 1482, '84.7800', 21987181886),
  level('2026-10-08', '1-999', 2459344, '1.1000', 287438824),
  level('2026-10-08', '10,001-15,000', 17394, '0.8200', 213343773),
  level('2026-10-08', '5,001-10,000', 52515, '1.4400', 375784810),
  level('2026-10-08', '合計', 3007088, '100.0000', 25932370067),
  level('2026-10-08', '差異數調整', 1, '0.0000', -6000),
  level('2026-10-02', '1,000,001以上', 1480, '84.7000', 21900000000),
]);
assert.deepEqual(weeks.map((w) => w.date), ['2026-10-02', '2026-10-08']);
const latest = weeks[1];
assert.deepEqual(latest.levels.map((l) => l.label), ['1–999 股', '5,001–10,000 股', '10,001–15,000 股', '1,000,001 股以上']);
assert.equal(latest.top?.percent, 84.78);
assert.equal(latest.total?.people, 3007088);
assert.equal(weeks[0].total, null);

console.log('Holdings checks passed: margin changes and short/margin ratio, foreign ratio, TDCC level parsing and ordering.');
