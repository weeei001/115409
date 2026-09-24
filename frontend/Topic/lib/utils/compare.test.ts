import assert from 'node:assert/strict';
import type { PriceChangeResponse } from '../types/api';
import type { CategoryLeader, CompareMetricsRow, InstitutionalAggregate } from '../types/compare';
import type { InstitutionalDay, TechnicalDay } from '../types/view';
import { COMPARE_SYMBOL_COLORS, getChartPalette } from '../charts/theme';
import {
  aggregateInstitutional,
  buildCategoryLeaders,
  buildCompareViewModel,
  buildCorrelationMatrix,
  buildMetricsRow,
  buildSymbolColorMap,
  sortMetricsRows,
  toCompareChartSeries,
} from './compare';
import { kdSignal, maPositionSignal, rsiSignal } from './compareSignals';

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
  const volume = { symbol: 'X', start_date: 's', end_date: 'e', data: [{ date: 'd1', volume: 100, amount: 1000, close: 1, change: 0 }, { date: 'd2', volume: 300, amount: 3000, close: 1, change: 0 }] };
  const row = buildMetricsRow('X', null, volume);
  assert.equal(row.avgVolume, 200);
  assert.equal(row.avgAmount, 2000);
  assert.equal(row.totalReturnPct, null);
}

// 沒有漲跌資料：全部 null
assert.deepEqual(Object.values(buildMetricsRow('X', null, null)).slice(1), Array(8).fill(null));

// 相關係數：同向 1、反向 -1、沒有共同日 null、對角線 1；第一天不算（決議 c71）
{
  const a = change([['d0', 1, 0], ['d1', 1, 1], ['d2', 1, 2], ['d3', 1, 3]]);
  const b = change([['d0', 1, 0], ['d1', 1, 2], ['d2', 1, 4], ['d3', 1, 6]]);
  const c = change([['d0', 1, 0], ['d1', 1, 3], ['d2', 1, 2], ['d3', 1, 1]]);
  const d = change([['d1', 1, 0], ['x2', 1, 2]]);
  const m = buildCorrelationMatrix(['A', 'B', 'C', 'D'], { A: a, B: b, C: c, D: d });
  assert.ok(close(m.A.B as number, 1));
  assert.ok(close(m.A.C as number, -1));
  assert.equal(m.A.D, null);
  assert.equal(m.A.A, 1);
}

// 資料品質：共同交易日、缺值提醒；第一天不算有效樣本（決議 c71）
{
  const a = change([['d1', 1, 0], ['d2', 1, 1], ['d3', 1, 2], ['d4', 1, 3], ['d5', 1, 4]]);
  const b = change([['d1', 1, 0], ['d2', 1, 1]]);
  const vm = buildCompareViewModel({ symbols: ['A', 'B'], startDate: 's', endDate: 'e', priceChangeMap: { A: a, B: b }, volumeMap: {}, generatedAt: 't' });
  assert.equal(vm.qualityMeta.alignedDays, 1);
  assert.deepEqual(vm.qualityMeta.samplesBySymbol, { A: 4, B: 1 });
  assert.ok(close(vm.qualityMeta.missingRatioBySymbol.B, 0.75));
  assert.deepEqual(vm.qualityMeta.qualityWarnings, ['B 在比較區間缺值 75.0%，結果需審慎解讀。', '共同交易日僅 1 天，相關係數穩定性較低。']);
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

// 主圖：指數化首日 = 100、累積報酬首日 = 0，缺值保持 null
{
  const data = { start_date: 's', end_date: 'e', symbols: ['A'], data: [{ date: 'd1', prices: { A: null } }, { date: 'd2', prices: { A: 50 } }, { date: 'd3', prices: { A: 60 } }] };
  assert.deepEqual(toCompareChartSeries(data, 'index100').values.A, [null, 100, 120]);
  assert.ok(close(toCompareChartSeries(data, 'cumulativeReturn').values.A[2] as number, 20));
  assert.deepEqual(toCompareChartSeries(data, 'price').values.A, [null, 50, 60]);
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
  );
  assert.deepEqual(tones(falling), {
    bestReturn: 'down', minVolatility: 'neutral', institutionalFavorite: 'down',
    strongestMomentum: 'neutral', lowestCorrelationPair: 'neutral',
  });
  const rising = buildCategoryLeaders(['A'], [metric('A', 3, 20)], { A: aggregate('A', 500) }, { A: null }, {});
  assert.equal(tones(rising).bestReturn, 'up');
  assert.equal(tones(rising).institutionalFavorite, 'up');
  assert.equal(tones(buildCategoryLeaders(['A'], [metric('A', 0, 20)], {}, {}, {})).bestReturn, 'neutral');
}

console.log('compare metrics tests passed');
