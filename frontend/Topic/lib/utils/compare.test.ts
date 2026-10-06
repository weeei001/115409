import assert from 'node:assert/strict';
import type { MultiStockResponse, PriceChangeResponse } from '../types/api';
import type { CategoryLeader, CompareMetricsRow, InstitutionalAggregate } from '../types/compare';
import type { InstitutionalDay, TechnicalDay } from '../types/view';
import { COMPARE_SYMBOL_COLORS, getChartPalette } from '../charts/theme';
import {
  aggregateInstitutional,
  alignComparePrices,
  buildCategoryLeaders,
  buildCompareViewModel,
  buildCorrelationData,
  buildInstitutionalCumulative,
  buildInstitutionalRankingAggregates,
  buildMetricsRow,
  buildSymbolColorMap,
  sortMetricsRows,
  toCompareChartSeries,
} from './compare';
import { kdSignal, maPositionSignal, rsiSignal } from './compareSignals';
import * as compareSignals from './compareSignals';
import * as indicatorSignals from './indicatorSignals';
import { fmtAmount, fmtPercent } from './format';

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const change = (rows: Array<[string, number, number]>): PriceChangeResponse => ({
  symbol: 'X',
  start_date: rows[0]?.[0] ?? '',
  end_date: rows[rows.length - 1]?.[0] ?? '',
  data: rows.map(([date, c, pct]) => ({ date, close: c, change: 0, change_percent: pct })),
});

// c25：第一天的 change_percent（後端回 0）不算進波動、回撤、勝率、單日漲跌
{
  const data = change([
    ['2026-01-02', 100, 0],
    ['2026-01-03', 110, 10],
    ['2026-01-04', 99, -10],
    ['2026-01-05', 99, 0],
  ]);
  const row = buildMetricsRow('X', data, null);
  assert.ok(close(row.totalReturnPct as number, -1), 'total return from first/last close');
  assert.ok(close(row.winRatePct as number, (1 / 3) * 100), 'win rate over 3 daily returns, not 4');
  assert.equal(row.maxDailyGainPct, 10);
  assert.equal(row.maxDailyLossPct, -10);
  assert.ok(close(row.maxDrawdownPct as number, -10), 'drawdown 1.1 → 0.99');
  const mean = 0;
  const sd = Math.sqrt(((0.1 - mean) ** 2 + (-0.1 - mean) ** 2 + (0 - mean) ** 2) / 2);
  assert.ok(close(row.volatilityPct as number, sd * Math.sqrt(252) * 100), 'sample std of 3 returns × √252');
}

// 勝率分母只算有效值；全部下跌時最大單日漲不會被第一天的 0 蓋掉
{
  const data = change([
    ['2026-01-02', 100, 0],
    ['2026-01-03', 98, -2],
    ['2026-01-04', 97, Number.NaN],
    ['2026-01-05', 95, -1],
  ]);
  const row = buildMetricsRow('X', data, null);
  assert.equal(row.winRatePct, 0);
  assert.equal(row.maxDailyGainPct, -1);
  assert.equal(row.avgVolume, null);
}

// c73：漲跌資料缺了，平均量與平均金額照樣只看成交資料
{
  const volume = { symbol: 'X', start_date: 'd0', end_date: 'd9', data: [{ date: 'd1', volume: 100, amount: 1000, close: 1, change: 0 }, { date: 'd2', volume: 300, amount: 3000, close: 1, change: 0 }] };
  const row = buildMetricsRow('X', null, volume);
  assert.equal(row.avgVolume, 200);
  assert.equal(row.avgAmount, 2000);
  assert.equal(row.totalReturnPct, null);
}

// 沒有漲跌資料：全部 null
assert.deepEqual(Object.values(buildMetricsRow('X', null, null)).slice(1), Array(8).fill(null));

// Correlations exclude the first observation and retain exact pair counts.
{
  const a = change([['d0', 1, 0], ['d1', 1, 1], ['d2', 1, 2], ['d3', 1, 3]]);
  const b = change([['d0', 1, 0], ['d1', 1, 2], ['d2', 1, 4], ['d3', 1, 6]]);
  const c = change([['d0', 1, 0], ['d1', 1, 3], ['d2', 1, 2], ['d3', 1, 1]]);
  const d = change([['d1', 1, 0], ['x2', 1, 2]]);
  const { correlationMatrix: m, correlationSamples } = buildCorrelationData(['A', 'B', 'C', 'D'], { A: a, B: b, C: c, D: d });
  assert.ok(close(m.A.B as number, 1));
  assert.ok(close(m.A.C as number, -1));
  assert.equal(m.A.D, null);
  assert.equal(m.A.A, 1);
  assert.equal(m.D.D, null);
  assert.equal(correlationSamples.A.B, 3);
  assert.equal(correlationSamples.A.D, 0);
  const flat = change([['d0', 100, 0], ['d1', 100, 0], ['d2', 100, 0]]);
  assert.equal(buildCorrelationData(['F'], { F: flat }).correlationMatrix.F.F, null);
}

// Interior missing closes break both adjacent daily samples, not the price window.
{
  const chart: MultiStockResponse = { start_date: 'd1', end_date: 'd5', symbols: ['A', 'B'], data: [
    { date: 'd1', prices: { A: 100, B: 100 } },
    { date: 'd2', prices: { A: 110, B: 110 } },
    { date: 'd3', prices: { A: 100, B: null } },
    { date: 'd4', prices: { A: 120, B: 60 } },
    { date: 'd5', prices: { A: 110, B: 66 } },
  ] };
  const vm = buildCompareViewModel({ symbols: chart.symbols, startDate: 'd1', endDate: 'd5', chart, volumeMap: {}, generatedAt: 't' });
  assert.equal(vm.qualityMeta.alignedDays, 2);
  assert.deepEqual(vm.qualityMeta.samplesBySymbol, { A: 4, B: 2 });
  assert.ok(close(vm.qualityMeta.missingRatioBySymbol.B, 0.5));
  assert.match(vm.qualityMeta.qualityWarnings.join('\n'), /B 有 50.0% 的交易日缺資料；缺漏日不計入，最大回撤只用有資料的收盤價計算。/);
  const b = vm.metricsRows[1];
  assert.ok(close(b.maxDrawdownPct as number, (60 / 110 - 1) * 100));
  assert.ok(close(b.maxDailyLossPct as number, 10), 'the missing interval is not a daily decline');
  assert.ok(close(b.totalReturnPct as number, -34));
}

// 排序：空值排最後（升冪降冪都一樣）
{
  const rows = [
    { ...buildMetricsRow('A', null, null), totalReturnPct: 5 },
    { ...buildMetricsRow('B', null, null), totalReturnPct: null },
    { ...buildMetricsRow('C', null, null), totalReturnPct: -3 },
  ];
  assert.deepEqual(sortMetricsRows(rows, { key: 'totalReturnPct', direction: 'desc' }).map((r) => r.symbol), ['A', 'C', 'B']);
  assert.deepEqual(sortMetricsRows(rows, { key: 'totalReturnPct', direction: 'asc' }).map((r) => r.symbol), ['C', 'A', 'B']);
}

// 法人：期間合計、最大單日、期末連續買超
{
  const day = (date: string, total: number | null, foreign: number | null = null): InstitutionalDay =>
    ({ date, foreign_net: foreign, investment_trust_net: null, dealer_net: null, total_institutional_net: total }) as InstitutionalDay;
  const agg = aggregateInstitutional('A', [day('d1', 500, 100), day('d2', -200), day('d3', 50), day('d4', 30)]);
  assert.equal(agg.totalNet, 380);
  assert.equal(agg.foreignNet, 100);
  assert.equal(agg.dealerNet, null);
  assert.equal(agg.maxDailyTotalNet, 500);
  assert.equal(agg.maxDailyTotalNetDate, 'd1');
  assert.equal(agg.consecutiveBuyDays, 2);
  assert.equal(aggregateInstitutional('A', null).totalNet, null);
}

// All chart modes use the same valid shared boundaries.
{
  const data = { start_date: 'd0', end_date: 'd9', symbols: ['A'], data: [{ date: 'd1', prices: { A: null } }, { date: 'd2', prices: { A: 50 } }, { date: 'd3', prices: { A: 60 } }] };
  assert.deepEqual(toCompareChartSeries(data, 'index100').values.A, [100, 120]);
  assert.ok(close(toCompareChartSeries(data, 'cumulativeReturn').values.A[1] as number, 20));
  assert.deepEqual(toCompareChartSeries(data, 'price').values.A, [50, 60]);
}

// 股票代表色：依清單順序、6 檔不撞色、不是漲跌色（決議 c76）
{
  const palette = getChartPalette(false);
  const colors = buildSymbolColorMap(['2454', '2330', '2317', '2881', '2408', '2615']);
  assert.equal(colors['2454'], COMPARE_SYMBOL_COLORS[0]);
  assert.equal(colors['2330'], COMPARE_SYMBOL_COLORS[1]);
  assert.equal(new Set(Object.values(colors)).size, 6);
  assert.ok(!Object.values(colors).some((c) => c === palette.up || c === palette.down));
}

// 技術快照標籤：RSI 超買用 warning（D8-c8）、K／D 是狀態不是交叉（D9-c24）
{
  assert.deepEqual(rsiSignal(75), { label: 'RSI 超買', tone: 'warning', value: 75 });
  assert.equal(rsiSignal(null).label, 'RSI 無資料');
  assert.equal(kdSignal(60, 50).label, 'K 在 D 之上');
  assert.equal(kdSignal(40, 50).label, 'K 在 D 之下');
  assert.equal(kdSignal(50, 50).label, 'K、D 黏合');
  const row = { close: 110, ma20: 100 } as TechnicalDay;
  const ma = maPositionSignal(row.close, row.ma20, 'MA20');
  assert.equal(ma.label, '站上 MA20');
  assert.ok(close(ma.value as number, 10));
}

// 比較頁沿用個股頁的判讀：MACD、KD 是同一個函式，RSI 只多冠「RSI 」（缺值兩邊都寫「RSI 無資料」）
{
  assert.equal(compareSignals.macdSignal, indicatorSignals.macdSignal);
  assert.equal(compareSignals.kdSignal, indicatorSignals.kdSignal);
  for (const [value, plain] of [[75, '超買'], [25, '超賣'], [50, '中性']] as const) {
    assert.equal(indicatorSignals.rsiSignal(value).label, plain);
    assert.deepEqual(rsiSignal(value), { ...indicatorSignals.rsiSignal(value), label: `RSI ${plain}` });
  }
  assert.equal(indicatorSignals.rsiSignal(Number.NaN).label, 'RSI 無資料');
  assert.equal(indicatorSignals.rsiSignal(75, { labelPrefix: 'RSI ' }).label, 'RSI 超買');
}

// 類別冠軍：有方向的指標依正負上色，波動與相關性、缺值維持中性（決議 D13）
{
  const metric = (symbol: string, totalReturnPct: number, volatilityPct: number): CompareMetricsRow => ({
    symbol, totalReturnPct, volatilityPct, maxDrawdownPct: null, winRatePct: null,
    maxDailyGainPct: null, maxDailyLossPct: null, avgVolume: null, avgAmount: null,
  });
  const aggregate = (symbol: string, totalNet: number): InstitutionalAggregate => ({
    symbol, foreignNet: null, investmentTrustNet: null, dealerNet: null, totalNet,
    maxDailyTotalNet: null, maxDailyTotalNetDate: null, consecutiveBuyDays: 0,
  });
  const tones = (leaders: CategoryLeader[]) => Object.fromEntries(leaders.map((l) => [l.id, l.tone]));
  const falling = buildCategoryLeaders(
    ['A', 'B'],
    [metric('A', -5, 20), metric('B', -2, 30)],
    { A: aggregate('A', -1000), B: aggregate('B', -3000) },
    { A: null, B: null },
    { A: { B: -0.3 }, B: { A: -0.3 } },
    { A: { B: 20 }, B: { A: 20 } },
  );
  assert.deepEqual(tones(falling), {
    bestReturn: 'down', minVolatility: 'neutral', institutionalFavorite: 'down',
    strongestMomentum: 'neutral',
  });
  // 兩檔只有一組配對：不列「相關性最低組合」（P2-092）
  assert.equal(falling.some((leader) => leader.id === 'lowestCorrelationPair'), false);
  assert.equal(falling.find((leader) => leader.id === 'bestReturn')?.value, '−2.00%', 'Leader values use U+2212');
  assert.equal(falling.find((leader) => leader.id === 'bestReturn')?.title, '區間漲跌幅最高');
  const rising = buildCategoryLeaders(['A'], [metric('A', 3, 20)], { A: aggregate('A', 500_000) }, { A: null }, {}, {});
  assert.equal(tones(rising).bestReturn, 'up');
  assert.equal(tones(rising).institutionalFavorite, 'up');
  // P1-21：法人買超不滿 1 張（500 股）寫「不到 1 張」、不上漲跌色
  const underOneLot = buildCategoryLeaders(['A'], [metric('A', 3, 20)], { A: aggregate('A', 500) }, { A: null }, {}, {});
  assert.equal(tones(underOneLot).institutionalFavorite, 'neutral');
  assert.equal(underOneLot.find((leader) => leader.id === 'institutionalFavorite')?.value, '不到 1 張');
  assert.equal(tones(buildCategoryLeaders(['A'], [metric('A', 0, 20)], {}, {}, {}, {})).bestReturn, 'neutral');
  // 四捨五入後是 0.00%：不帶號、不上漲跌色（顏色跟著畫面上的值）
  const nearZero = buildCategoryLeaders(['A'], [metric('A', -0.004, 20)], {}, { A: { ma20: 100.004, ma60: 100 } as TechnicalDay }, {}, {});
  assert.equal(nearZero.find((leader) => leader.id === 'bestReturn')?.value, '0.00%');
  assert.equal(tones(nearZero).bestReturn, 'neutral');
  assert.equal(nearZero.find((leader) => leader.id === 'strongestMomentum')?.value, '0.00%');
  assert.equal(tones(nearZero).strongestMomentum, 'neutral');
}

// fmtPercent 先四捨五入再決定正負號；fmtAmount 負值也依絕對值縮放
{
  assert.equal(fmtPercent(-0.004), '0.00%');
  assert.equal(fmtPercent(0.004, { sign: true }), '0.00%');
  assert.equal(fmtPercent(-0.0004, { fromRatio: true, decimals: 1 }), '0.0%');
  assert.equal(fmtPercent(0.005, { sign: true }), '+0.01%');
  assert.equal(fmtPercent(-0.006), '-0.01%');
  assert.equal(fmtPercent(3.456, { sign: true }), '+3.46%');
  assert.equal(fmtAmount(5e8), '5.00 億元');
  assert.equal(fmtAmount(-5e8), '-5.00 億元');
  assert.equal(fmtAmount(-12_345), '-1.23 萬元');
  assert.equal(fmtAmount(-12.34), '-12 元');
}

// Unsorted histories align endpoints once; charts, metrics, and leaders agree.
{
  const chart: MultiStockResponse = { start_date: 'd0', end_date: 'd5', symbols: ['A', 'B'], data: [
    { date: 'd4', prices: { A: 120, B: 110 } },
    { date: 'd0', prices: { A: 10, B: null } },
    { date: 'd2', prices: { A: null, B: 90 } },
    { date: 'd1', prices: { A: 100, B: 100 } },
    { date: 'd5', prices: { A: null, B: 200 } },
    { date: 'd3', prices: { A: 80, B: 100 } },
    { date: 'd9', prices: { A: 999, B: 999 } },
  ] };
  const originalOrder = chart.data.map((row) => row.date);
  const aligned = alignComparePrices(chart);
  assert.equal(aligned.start_date, 'd1');
  assert.equal(aligned.end_date, 'd4');
  assert.deepEqual(aligned.data.map((row) => row.date), ['d1', 'd2', 'd3', 'd4']);
  assert.deepEqual(chart.data.map((row) => row.date), originalOrder, 'alignment does not mutate the response');
  const vm = buildCompareViewModel({ symbols: chart.symbols, startDate: 'd0', endDate: 'd5', chart, volumeMap: {} });
  assert.deepEqual(vm.qualityMeta.requestedRange, { startDate: 'd0', endDate: 'd5' });
  assert.deepEqual(vm.qualityMeta.analysisRange, { startDate: 'd1', endDate: 'd4' });
  assert.equal(vm.qualityMeta.alignedDays, 1);
  const modes = ['price', 'index100', 'cumulativeReturn'] as const;
  for (const mode of modes) {
    const series = toCompareChartSeries(chart, mode);
    assert.deepEqual(series.dates, ['d1', 'd2', 'd3', 'd4']);
    assert.equal(series.values.A[1], null);
  }
  const cumulative = toCompareChartSeries(chart, 'cumulativeReturn');
  for (const row of vm.metricsRows) {
    assert.ok(close(cumulative.values[row.symbol].at(-1) as number, row.totalReturnPct as number));
  }
  const leaders = buildCategoryLeaders(chart.symbols, vm.metricsRows, {}, {}, vm.correlationMatrix, vm.correlationSamples);
  assert.equal(leaders.find((leader) => leader.id === 'bestReturn')?.symbol, 'A');
  assert.equal(leaders.find((leader) => leader.id === 'lowestCorrelationPair'), undefined, 'Two stocks have no correlation ranking');
  assert.ok(close(vm.metricsRows[0].maxDrawdownPct as number, -20));
  assert.ok(close(vm.metricsRows[0].maxDailyGainPct as number, 50));
  assert.equal(vm.metricsRows[0].volatilityPct, null, 'one observed daily interval cannot define sample volatility');
}

// Pair samples use adjacent valid intervals, not the all-symbol intersection.
{
  const chart: MultiStockResponse = { start_date: 'd0', end_date: 'd6', symbols: ['A', 'B', 'C'], data: [
    { date: 'd0', prices: { A: 100, B: 100, C: 100 } },
    { date: 'd1', prices: { A: 110, B: 120, C: 90 } },
    { date: 'd2', prices: { A: 108, B: null, C: 95 } },
    { date: 'd3', prices: { A: 115, B: null, C: 92 } },
    { date: 'd4', prices: { A: 112, B: 110, C: null } },
    { date: 'd5', prices: { A: 116, B: 114, C: 91 } },
    { date: 'd6', prices: { A: 113, B: 112, C: 97 } },
  ] };
  const vm = buildCompareViewModel({ symbols: chart.symbols, startDate: 'd0', endDate: 'd6', chart, volumeMap: {} });
  assert.deepEqual(vm.qualityMeta.samplesBySymbol, { A: 6, B: 3, C: 4 });
  assert.equal(vm.qualityMeta.alignedDays, 2);
  assert.deepEqual(vm.correlationSamples, {
    A: { A: 6, B: 3, C: 4 }, B: { A: 3, B: 3, C: 2 }, C: { A: 4, B: 2, C: 4 },
  });
}

// Missing, disjoint, single-point, and invalid-price histories cannot invent a shared return.
{
  const cases: Array<MultiStockResponse['data']> = [
    [],
    [{ date: 'd1', prices: { A: 10, B: null } }, { date: 'd2', prices: { A: null, B: 20 } }],
    [{ date: 'd1', prices: { A: 10, B: 20 } }],
    [{ date: 'd1', prices: { A: 0, B: 20 } }, { date: 'd2', prices: { A: 10, B: 20 } }],
    [{ date: 'd1', prices: { A: -1, B: 20 } }, { date: 'd2', prices: { A: Number.NaN, B: 20 } }],
    [{ date: 'd1', prices: { A: 10, B: Number.POSITIVE_INFINITY } }, { date: 'd2', prices: { A: 10, B: 20 } }],
  ];
  for (const data of cases) {
    const chart: MultiStockResponse = { start_date: 'd0', end_date: 'd9', symbols: ['A', 'B'], data };
    assert.deepEqual(alignComparePrices(chart).data, []);
    for (const mode of ['price', 'index100', 'cumulativeReturn'] as const) {
      assert.deepEqual(toCompareChartSeries(chart, mode).dates, []);
    }
    const vm = buildCompareViewModel({ symbols: chart.symbols, startDate: 'd0', endDate: 'd9', chart, volumeMap: {} });
    assert.equal(vm.qualityMeta.analysisRange, null);
    assert.equal(vm.qualityMeta.alignedDays, 0);
    assert.ok(vm.metricsRows.every((row) => row.totalReturnPct === null && row.maxDrawdownPct === null));
  }
  const volume = { symbol: 'A', start_date: 'd0', end_date: 'd9', data: [
    { date: 'd1', volume: 100, amount: 1000, close: 10, change: 0 },
    { date: 'd2', volume: 300, amount: 3000, close: 10, change: 0 },
  ] };
  const vm = buildCompareViewModel({ symbols: ['A'], startDate: 'd0', endDate: 'd9', chart: null, volumeMap: { A: volume } });
  assert.equal(vm.metricsRows[0].avgVolume, 200);
  assert.equal(vm.metricsRows[0].avgAmount, 2000);
  assert.equal(vm.metricsRows[0].totalReturnPct, null);
  assert.equal(vm.qualityMeta.analysisRange, null);
}

// The lowest coefficient is eligible only with at least 20 paired samples.
{
  const matrix = { A: { B: -0.9, C: 0.2 }, B: { A: -0.9, C: 0.4 }, C: { A: 0.2, B: 0.4 } };
  const samples = { A: { B: 19, C: 20 }, B: { A: 19, C: 30 }, C: { A: 20, B: 30 } };
  const leader = buildCategoryLeaders(['A', 'B', 'C'], [], {}, {}, matrix, samples)
    .find((item) => item.id === 'lowestCorrelationPair');
  assert.equal(leader?.symbol, 'A × C');
  assert.match(leader?.reason ?? '', /20 筆/);
  const insufficient = buildCategoryLeaders(['A', 'B', 'C'], [], {}, {}, matrix, { A: { B: 19, C: 5 }, B: { A: 19, C: 3 }, C: { A: 5, B: 3 } })
    .find((item) => item.id === 'lowestCorrelationPair');
  assert.equal(insufficient?.symbol, '--');
  assert.equal(buildCategoryLeaders(['A', 'B'], [], {}, {}, matrix, samples).some((item) => item.id === 'lowestCorrelationPair'), false);
}

// A missing institutional observation remains a gap, even between known totals.
{
  const day = (date: string, total: number | null): InstitutionalDay =>
    ({ date, foreign_net: null, investment_trust_net: null, dealer_net: null, total_institutional_net: total }) as InstitutionalDay;
  const series = buildInstitutionalCumulative(['A', 'B'], {
    A: [day('d4', -5), day('d1', 10), day('d2', null)],
    B: [day('d3', 2)],
  });
  assert.deepEqual(series.dates, ['d1', 'd2', 'd3', 'd4']);
  assert.deepEqual(series.values.A, [10, null, null, 5]);
  assert.deepEqual(series.values.B, [null, null, 2, null]);
}

// Institutional ranking uses shared report dates, not every price date.
{
  const day = (date: string, total: number): InstitutionalDay =>
    ({ date, foreign_net: null, investment_trust_net: null, dealer_net: null, total_institutional_net: total }) as InstitutionalDay;
  const result = buildInstitutionalRankingAggregates(['A', 'B'], {
    A: [day('d1', 10), day('d2', 20), day('d3', 30)],
    B: [day('d2', 5), day('d3', 15), day('d4', 25)],
  });
  assert.deepEqual(result.commonDates, ['d2', 'd3']);
  assert.equal(result.aggregates.A.totalNet, 50);
  assert.equal(result.aggregates.B.totalNet, 20);
  assert.deepEqual(buildInstitutionalRankingAggregates(['A', 'B'], {
    A: [day('d1', 10)],
    B: [day('d2', 5)],
  }).aggregates, {});
}

console.log('compare metrics tests passed');
