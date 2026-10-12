import assert from 'node:assert/strict';
import type { DividendResultResponse, FinancialStatementRowResponse, MonthlyRevenueResponse, StockValuationResponse } from '../types/api';
import {
  buildBalanceQuarters,
  buildCashflowQuarters,
  buildDividendEvents,
  buildQuarterProfits,
  buildRevenueMonths,
  buildValuations,
  dividendYears,
  growthPercent,
  quarterLabel,
  ytdLabel,
} from './stockFundamentals';

const close = (actual: number | null | undefined, expected: number) => assert.ok(actual != null && Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

// 成長率：基期不是正數不算
assert.equal(growthPercent(10, 0), null);
assert.equal(growthPercent(10, -5), null);
assert.equal(growthPercent(null, 5), null);
close(growthPercent(12, 10), 20);

// 月營收：依年月排序、月增率與年增率、同月重複取公布日較晚的
const revenue = (period: string, value: number | null, created: string | null = null): MonthlyRevenueResponse => ({
  date: `${period}-01`, symbol: '2330', country: null, revenue: value,
  revenue_year: Number(period.slice(0, 4)), revenue_month: Number(period.slice(5, 7)), create_time: created,
});
const months = buildRevenueMonths([
  revenue('2026-09', 130, '2026-10-09'),
  revenue('2025-09', 100),
  revenue('2026-08', 120, '2026-09-08'),
  revenue('2026-08', 125, '2026-09-10'),
  revenue('2026-07', null),
]);
assert.deepEqual(months.map((m) => m.period), ['2025-09', '2026-08', '2026-09']);
assert.equal(months[1].revenue, 125, '同月份取公布日較晚的那筆');
close(months[2].yoy, 30);
close(months[2].mom, 4);
assert.equal(months[1].mom, null, '缺上個月不算月增率');
// 跨年的上個月
close(buildRevenueMonths([revenue('2025-12', 100), revenue('2026-01', 110)])[1].mom, 10);

// 單季獲利：只認後端的單季科目名稱；重複的不取
const income = (date: string, item_type: string, origin_name: string, value: string | null): FinancialStatementRowResponse => ({
  date, symbol: '2330', statement: 'income', item_type, origin_name, value,
});
const quarters = buildQuarterProfits([
  income('2026-06-30', 'Revenue', '營業收入', '1000'),
  income('2026-06-30', 'GrossProfit', '營業毛利（毛損）', '600'),
  income('2026-06-30', 'OperatingIncome', '營業利益(損失)', '400'),
  income('2026-06-30', 'EPS', '基本每股盈餘', '12.5'),
  income('2025-06-30', 'EPS', '基本每股盈餘', '10'),
  income('2025-06-30', 'Revenue', '營業收入', '800'),
  income('2025-06-30', 'Revenue', '營業收入', '801'),
  income('2026-06-30', 'MOPS_YTD_PER_SHARE_92026140b760143d_CONSOLIDATED_1', '基本每股盈餘', '49'),
  income('2026-05-31', 'EPS', '基本每股盈餘', '1'),
]);
assert.deepEqual(quarters.map((q) => q.label), ['2025 Q2', '2026 Q2']);
const q2 = quarters[1];
assert.equal(q2.revenue, 1000);
close(q2.grossMargin, 60);
close(q2.operatingMargin, 40);
assert.equal(q2.eps, 12.5, '單季 EPS 不和年初累計混用');
close(q2.epsYoy, 25);
assert.equal(quarters[0].revenue, null, '同季同科目出現兩次就不取');
assert.equal(quarters[0].grossMargin, null);
assert.equal(quarterLabel('2026-12-31'), '2026 Q4');
assert.equal(ytdLabel('2026-09-30'), '2026 年初累計至 Q3');

// 資產負債表：合併優先、金融業的「資產總計」、同名科目第二次出現視為無法判斷
const balanceRow = (date: string, name: string, value: string, basis = 'CONSOLIDATED', occurrence = 1, hash = '0123456789abcdef'): FinancialStatementRowResponse => ({
  date, symbol: '2330', statement: 'balance', item_type: `MOPS_ASOF_${hash}_${basis}_${occurrence}`, origin_name: name, value,
});
const balance = buildBalanceQuarters([
  balanceRow('2026-06-30', '資產總額', '1000'),
  balanceRow('2026-06-30', '負債總額', '300'),
  balanceRow('2026-06-30', '權益總額', '700'),
  balanceRow('2026-06-30', '流動資產合計', '500'),
  balanceRow('2026-06-30', '流動負債合計', '250'),
  balanceRow('2026-06-30', '現金及約當現金', '200'),
  balanceRow('2026-06-30', '現金及約當現金', '999', 'CONSOLIDATED', 2),
  balanceRow('2026-06-30', '資產總額', '5', 'SEPARATE'),
  balanceRow('2026-03-31', '資產總計', '2000', 'SEPARATE'),
  balanceRow('2026-03-31', '負債總計', '1800', 'SEPARATE'),
  { ...balanceRow('2026-03-31', '資產總額', '1'), item_type: 'TotalAssets' },
]);
assert.deepEqual(balance.map((b) => [b.label, b.basis]), [['2026 Q1', 'SEPARATE'], ['2026 Q2', 'CONSOLIDATED']]);
assert.equal(balance[1].totalAssets, 1000, '有合併報表就不用個別報表');
close(balance[1].debtRatio, 30);
close(balance[1].currentRatio, 200);
assert.equal(balance[1].cash, null, '同名科目出現第二次就不取');
close(balance[0].debtRatio, 90);
assert.equal(balance[0].currentRatio, null, '金融業沒有流動資產');

const cashflow = buildCashflowQuarters([
  { date: '2026-06-30', symbol: '2330', statement: 'cashflow', item_type: 'MOPS_YTD_e19614e7e7161b33_CONSOLIDATED_1', origin_name: '營業活動之淨現金流入（流出）', value: '1482' },
  { date: '2026-06-30', symbol: '2330', statement: 'cashflow', item_type: 'MOPS_YTD_1444b68a6c2471aa_CONSOLIDATED_1', origin_name: '投資活動之淨現金流入(流出)', value: '-849' },
]);
assert.deepEqual([cashflow[0].operating, cashflow[0].investing, cashflow[0].financing], [1482, -849, null]);

// 估值：三個值都沒有的日子不列
const valuation = (date: string, per: string | null, pbr: string | null = null, dividend_yield: string | null = null): StockValuationResponse => ({ date, symbol: '2330', per, pbr, dividend_yield });
assert.deepEqual(buildValuations([valuation('2026-10-02', '20.1', '6.2', '1.5'), valuation('2026-10-01', null), valuation('2026-09-30', '19.8')]).map((v) => v.date), ['2026-09-30', '2026-10-02']);

// 除權息：由新到舊、年度合計
const dividend = (date: string, value: string | null, kind = '息'): DividendResultResponse => ({
  date, symbol: '2330', before_price: '600', after_price: null, stock_and_cash_dividend: value, stock_or_cash_dividend: kind,
  max_price: null, min_price: null, open_price: null, reference_price: '597',
});
const events = buildDividendEvents([dividend('2025-03-17', '4.5'), dividend('2026-03-16', '5'), dividend('2026-06-16', '5.5'), dividend('2026-09-16', null)]);
assert.deepEqual(events.map((e) => e.date), ['2026-09-16', '2026-06-16', '2026-03-16', '2025-03-17']);
assert.deepEqual(dividendYears(events), [{ year: '2026', total: 10.5, count: 2 }, { year: '2025', total: 4.5, count: 1 }]);

console.log('Stock fundamentals checks passed: revenue growth, single-quarter metrics, statement basis and aliases, valuations, dividends.');
