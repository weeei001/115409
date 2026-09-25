import type { BenchmarkHistoryResponse } from '../api/benchmark';
import type { MultiStockResponse } from '../types/api';
import { alignComparePrices } from './compare';

/** A missing benchmark never changes the stocks' comparison window. */
export function buildBenchmarkComparison(prices: MultiStockResponse | null, benchmark: BenchmarkHistoryResponse | null) {
  const chart = prices ? alignComparePrices(prices) : null;
  if (!chart?.data.length) return { chart, returnPct: null, warning: '尚無共同價格期間可供大盤對照。' };
  if (!benchmark?.data.length || benchmark.id !== 'TAIEX' || benchmark.basis !== 'price_index_excluding_dividends') {
    return { chart, returnPct: null, warning: '此期間尚無可用的加權指數資料，個股比較仍可使用。' };
  }
  const closes = new Map(benchmark.data.filter((row) => Number.isFinite(row.close) && row.close > 0).map((row) => [row.date, row.close]));
  const first = closes.get(chart.start_date);
  const last = closes.get(chart.end_date);
  if (first == null || last == null) {
    return { chart, returnPct: null, warning: '加權指數缺少共同起日或迄日，暫不計算差值；個股比較期間維持不變。' };
  }
  return {
    chart: {
      ...chart,
      symbols: [...chart.symbols, benchmark.id],
      data: chart.data.map((row) => ({ ...row, prices: { ...row.prices, [benchmark.id]: closes.get(row.date) ?? null } })),
    },
    returnPct: (last / first - 1) * 100,
    warning: chart.data.some((row) => !closes.has(row.date)) ? '加權指數部分日期缺值，曲線保留斷點。' : null,
  };
}
