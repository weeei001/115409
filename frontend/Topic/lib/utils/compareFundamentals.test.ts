import assert from 'node:assert/strict';
import type { CompareFundamentalsData, FinancialStatementRow, MonthlyRevenueRow, ValuationRow } from '../api/compareFundamentals';
import { fetchCompareFundamentals } from '../api/compareFundamentals';
import apiClient from '../api/client';
import { buildFundamentalsComparison, epsPeriodLabel } from './compareFundamentals';

const cutoff = '2026-09-25';
const revenue = (symbol: string, period: string, value: number | null, publication: string | null = null): MonthlyRevenueRow => ({
  symbol, date: `${period}-01`, revenue: value, revenue_year: Number(period.slice(0, 4)), revenue_month: Number(period.slice(5, 7)), create_time: publication,
});
const valuation = (symbol: string, date: string, per: string | null = '20.50'): ValuationRow => ({ symbol, date, per, pbr: '3.2', dividend_yield: null });
const eps = (symbol: string, date: string, value: string | null, basis = 'CONSOLIDATED', occurrence = 1): FinancialStatementRow => ({
  symbol, date, statement: 'income', value, origin_name: '基本每股盈餘',
  item_type: basis === 'legacy' ? 'EPS' : `MOPS_YTD_PER_SHARE_abcdef1234567890_${basis}_${occurrence}`,
});
const empty = (): CompareFundamentalsData => ({ revenues: [], valuations: [], statements: [], warnings: [] });
const a = { ...empty(), revenues: [revenue('A', '2026-08', 120), revenue('A', '2026-07', 110), revenue('A', '2025-07', 100)],
  valuations: [valuation('A', '2026-09-24'), valuation('A', '2026-09-23')],
  statements: [eps('A', '2026-06-30', '12'), eps('A', '2025-06-30', '10'), eps('A', '2026-06-30', '30', 'SEPARATE')] };
const b = { ...empty(), revenues: [revenue('B', '2026-07', 200), revenue('B', '2025-07', 100)],
  valuations: [valuation('B', '2026-09-23')], statements: [eps('B', '2026-06-30', '15'), eps('B', '2025-06-30', '5')] };
const common = buildFundamentalsComparison(['A', 'B'], { A: a, B: b }, cutoff);
assert.deepEqual(common.aligned, { revenue: true, valuation: true, eps: true });
assert.deepEqual(common.rows.map((row) => row.revenue?.period), ['2026-07', '2026-07']);
assert.deepEqual(common.rows.map((row) => row.valuation?.period), ['2026-09-23', '2026-09-23']);
assert.ok(Math.abs(common.rows[0].revenueYoy! - 10) < 1e-9);
assert.ok(Math.abs(common.rows[0].epsYoy! - 20) < 1e-9);
assert.equal(common.rows[0].eps?.value, 12);
assert.equal(epsPeriodLabel(common.rows[0].eps!), '2026 年初累計至 Q2（合併）');

const missing = buildFundamentalsComparison(['A', 'B', 'C'], { A: a, B: b, C: null }, cutoff);
assert.deepEqual(missing.aligned, { revenue: false, valuation: false, eps: false });
assert.equal(missing.rows.length, 3);
assert.equal(missing.rows[0].revenue?.period, '2026-08');
assert.equal(missing.rows[2].revenue, null);
assert.equal(missing.rows[2].revenueYoy, null);
assert.match(missing.warnings.join(), /C 基本面未提供/);

for (const prior of [0, -10]) {
  const item = { ...empty(), revenues: [revenue('A', '2026-08', 100), revenue('A', '2025-08', prior)],
    statements: [eps('A', '2026-06-30', '3'), eps('A', '2025-06-30', String(prior))] };
  const row = buildFundamentalsComparison(['A'], { A: item }, cutoff).rows[0];
  assert.equal(row.revenueYoy, null);
  assert.equal(row.epsYoy, null);
}

const different = buildFundamentalsComparison(['A', 'B'], { A: a, B: { ...b, statements: [eps('B', '2026-06-30', '4', 'legacy')] } }, cutoff);
assert.equal(different.aligned.eps, false);
assert.equal(epsPeriodLabel(different.rows[1].eps!), '2026 Q2 單季（合併／個別未提供）');
const noMixedGrowth = buildFundamentalsComparison(['A'], { A: { ...empty(), statements: [eps('A', '2026-06-30', '12'), eps('A', '2025-06-30', '5', 'legacy')] } }, cutoff);
assert.equal(noMixedGrowth.rows[0].epsYoy, null);
const legacy = buildFundamentalsComparison(['A', 'B'], {
  A: { ...empty(), statements: [eps('A', '2026-06-30', '12', 'legacy'), eps('A', '2025-06-30', '5', 'legacy')] },
  B: { ...empty(), statements: [eps('B', '2026-06-30', '10', 'legacy'), eps('B', '2025-06-30', '2', 'legacy')] },
}, cutoff);
assert.equal(legacy.aligned.eps, false, 'Matching unknown statement bases are not verified alignment');
assert.deepEqual(legacy.rows.map((row) => row.epsYoy), [null, null]);
assert.deepEqual(legacy.rows.map((row) => row.eps?.value), [12, 10], 'Legacy values remain visible');

const ambiguous = { ...empty(), statements: [eps('A', '2026-06-30', '12'), eps('A', '2026-06-30', '15', 'CONSOLIDATED', 2)] };
assert.equal(buildFundamentalsComparison(['A'], { A: ambiguous }, cutoff).rows[0].eps, null);
const unrelated = { ...empty(), statements: [{ ...eps('A', '2026-06-30', '12'), origin_name: '繼續營業單位基本每股盈餘' }] };
assert.equal(buildFundamentalsComparison(['A'], { A: unrelated }, cutoff).rows[0].eps, null);

const publication = { ...empty(), revenues: [revenue('A', '2026-09', 500, '2026-10-10'), revenue('A', '2026-08', 120, '2026-09-10'), revenue('A', '2025-08', 100, '2025-09-10')],
  valuations: [valuation('A', '2026-10-01'), valuation('A', '2026-09-24', null)],
  statements: [eps('A', '2026-09-30', '30'), eps('A', '2026-06-30', null)] };
const publicationRow = buildFundamentalsComparison(['A'], { A: publication }, cutoff).rows[0];
assert.equal(publicationRow.revenue?.period, '2026-08');
assert.equal(publicationRow.revenue?.publication, '2026-09-10');
assert.equal(publicationRow.valuation?.per, null);
assert.equal(publicationRow.valuation?.yield, null);
assert.equal(publicationRow.valuation?.period, '2026-09-24');
assert.equal(publicationRow.eps, null);
assert.equal(buildFundamentalsComparison(['A'], { A: a }, cutoff).rows[0].revenue?.publication, null);

async function checkPartialFetch() {
  const original = apiClient.defaults.adapter;
  const requests: string[] = [];
  apiClient.defaults.adapter = async (config) => {
    requests.push(config.url ?? '');
    assert.equal(config.params.start_date, '2024-09-01');
    assert.equal(config.params.end_date, cutoff);
    if (config.url?.endsWith('valuations')) throw new Error('Unavailable');
    if (config.url?.endsWith('financial-statements')) assert.equal(config.params.statement, 'income');
    return { data: { data: [] }, status: 200, statusText: 'OK', headers: {}, config };
  };
  try {
    const result = await fetchCompareFundamentals('A', cutoff);
    assert.equal(requests.length, 3);
    assert.deepEqual(result.revenues, []);
    assert.deepEqual(result.valuations, []);
    assert.deepEqual(result.statements, []);
    assert.deepEqual(result.warnings, ['A 估值暫時無法取得，其他比較仍可使用。']);
    await assert.rejects(fetchCompareFundamentals('A', '2026-02-30'), /Invalid comparison end date/);
  } finally {
    apiClient.defaults.adapter = original;
  }
}

checkPartialFetch().then(() => console.log('Fundamental comparison checks passed: alignment, EPS basis, publication dates, nulls, growth and partial fetch failures.'));
