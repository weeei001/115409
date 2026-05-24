import type {
  CompareInsightCard,
  CompareMetricsRow,
  CompareQualityMeta,
  CompareViewModel,
  MultiStockResponse,
  PriceChangeResponse,
  VolumeAnalysisResponse,
} from '../types';

type CompareChartPoint = {
  date: string;
  [key: string]: string | number | null;
};

type SortDirection = 'asc' | 'desc';

export interface CompareSortState {
  key: keyof CompareMetricsRow;
  direction: SortDirection;
}

interface BuildCompareViewModelInput {
  symbols: string[];
  startDate: string;
  endDate: string;
  priceChangeMap: Record<string, PriceChangeResponse | null>;
  volumeMap: Record<string, VolumeAnalysisResponse | null>;
  generatedAt?: string;
}

export const COMPARE_COLOR_PALETTE = [
  '#f97316', '#2563eb', '#ef4444', '#16a34a', '#7c3aed', '#0891b2',
  '#db2777', '#65a30d', '#d97706', '#4f46e5', '#059669', '#dc2626',
  '#0284c7', '#9333ea', '#0d9488', '#b45309',
];

export interface CompareSeriesCoverage {
  symbol: string;
  firstDate: string | null;
  lastDate: string | null;
  validDays: number;
}

export interface CompareSeriesCoverageSummary {
  series: CompareSeriesCoverage[];
  chartLastDate: string | null;
  /** 任一股的最後有效交易日早於圖表最後一日 */
  hasUnevenEnd: boolean;
}

function isValidPrice(price: number | null | undefined): price is number {
  return typeof price === 'number' && Number.isFinite(price);
}

/** 各股在主圖資料中的實際覆蓋區間（用於解釋走勢線提前結束） */
export function getCompareSeriesCoverage(data: MultiStockResponse): CompareSeriesCoverageSummary {
  const chartLastDate = data.data.at(-1)?.date ?? null;
  const series = data.symbols.map((symbol) => {
    let firstDate: string | null = null;
    let lastDate: string | null = null;
    let validDays = 0;

    for (const row of data.data) {
      const price = row.prices[symbol];
      if (!isValidPrice(price)) continue;
      validDays += 1;
      if (!firstDate) firstDate = row.date;
      lastDate = row.date;
    }

    return { symbol, firstDate, lastDate, validDays };
  });

  const hasUnevenEnd = Boolean(
    chartLastDate && series.some((item) => item.lastDate && item.lastDate < chartLastDate),
  );

  return { series, chartLastDate, hasUnevenEnd };
}

export function toPriceChartData(data: MultiStockResponse): CompareChartPoint[] {
  return data.data.map((row) => {
    const point: CompareChartPoint = { date: row.date };
    for (const sym of data.symbols) {
      point[sym] = isValidPrice(row.prices[sym]) ? row.prices[sym] : null;
    }
    return point;
  });
}

export function toIndex100ChartData(data: MultiStockResponse): CompareChartPoint[] {
  const bases = new Map<string, number>();
  for (const sym of data.symbols) {
    const first = data.data.find((d) => typeof d.prices[sym] === 'number')?.prices[sym];
    if (typeof first === 'number' && first > 0) bases.set(sym, first);
  }

  return data.data.map((row) => {
    const point: CompareChartPoint = { date: row.date };
    for (const sym of data.symbols) {
      const base = bases.get(sym);
      const price = row.prices[sym];
      point[sym] = base && typeof price === 'number' ? (price / base) * 100 : null;
    }
    return point;
  });
}

export function toCumulativeReturnChartData(data: MultiStockResponse): CompareChartPoint[] {
  const bases = new Map<string, number>();
  for (const sym of data.symbols) {
    const first = data.data.find((d) => typeof d.prices[sym] === 'number')?.prices[sym];
    if (typeof first === 'number' && first > 0) bases.set(sym, first);
  }

  return data.data.map((row) => {
    const point: CompareChartPoint = { date: row.date };
    for (const sym of data.symbols) {
      const base = bases.get(sym);
      const price = row.prices[sym];
      point[sym] = base && typeof price === 'number' ? ((price / base) - 1) * 100 : null;
    }
    return point;
  });
}

function mean(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((acc, n) => acc + n, 0) / nums.length;
}

function std(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const avg = mean(nums);
  if (avg == null) return null;
  const variance = nums.reduce((acc, n) => acc + (n - avg) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
}

function maxDrawdownPctFromReturns(dailyReturns: number[]): number | null {
  if (dailyReturns.length === 0) return null;
  let nav = 1;
  let peak = 1;
  let maxDd = 0;
  for (const r of dailyReturns) {
    nav *= 1 + r;
    if (nav > peak) peak = nav;
    const dd = (nav - peak) / peak;
    if (dd < maxDd) maxDd = dd;
  }
  return maxDd * 100;
}

function firstAndLastClose(data: PriceChangeResponse): { first: number; last: number } | null {
  const closes = data.data.map((d) => d.close).filter((n) => Number.isFinite(n));
  if (closes.length < 2) return null;
  const first = closes[0];
  const last = closes[closes.length - 1];
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) return null;
  return { first, last };
}

function fmtPct(v: number): string {
  return `${v.toFixed(2)}%`;
}

function hashSymbol(symbol: string): number {
  let hash = 0;
  for (let i = 0; i < symbol.length; i += 1) {
    hash = (hash << 5) - hash + symbol.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function validDailyDateSet(change: PriceChangeResponse | null): Set<string> {
  const dateSet = new Set<string>();
  if (!change) return dateSet;

  for (const d of change.data) {
    if (!Number.isFinite(d.change_percent)) continue;
    if (typeof d.date !== 'string' || !d.date) continue;
    dateSet.add(d.date);
  }

  return dateSet;
}

function buildQualityMeta(
  symbols: string[],
  startDate: string,
  endDate: string,
  priceChangeMap: Record<string, PriceChangeResponse | null>,
  generatedAt: string,
): CompareQualityMeta {
  const samplesBySymbol: Record<string, number> = {};
  const missingRatioBySymbol: Record<string, number> = {};
  const qualityWarnings: string[] = [];

  const unionDates = new Set<string>();
  const symbolDateSets: Array<{ symbol: string; set: Set<string> }> = [];

  for (const symbol of symbols) {
    const dateSet = validDailyDateSet(priceChangeMap[symbol] ?? null);
    symbolDateSets.push({ symbol, set: dateSet });

    for (const date of dateSet) {
      unionDates.add(date);
    }

    samplesBySymbol[symbol] = dateSet.size;
  }

  const unionDays = unionDates.size;

  for (const symbol of symbols) {
    const sampleCount = samplesBySymbol[symbol] ?? 0;
    const missingRatio = unionDays > 0 ? Math.max(0, 1 - sampleCount / unionDays) : 0;
    missingRatioBySymbol[symbol] = missingRatio;

    if (sampleCount === 0) {
      qualityWarnings.push(`${symbol} 缺少有效漲跌資料，部分指標以 -- 顯示。`);
      continue;
    }

    if (missingRatio >= 0.2) {
      qualityWarnings.push(`${symbol} 在比較區間缺值 ${(missingRatio * 100).toFixed(1)}%，結果需審慎解讀。`);
    }
  }

  let alignedDays = 0;
  if (symbolDateSets.length > 0) {
    const [first, ...rest] = symbolDateSets;
    let commonDates = new Set(first.set);
    for (const item of rest) {
      commonDates = new Set([...commonDates].filter((d) => item.set.has(d)));
    }
    alignedDays = commonDates.size;
  }

  if (symbols.length >= 2) {
    if (alignedDays === 0) {
      qualityWarnings.push('標的之間沒有共同交易日，相關係數無法計算。');
    } else if (alignedDays < 20) {
      qualityWarnings.push(`共同交易日僅 ${alignedDays} 天，相關係數穩定性較低。`);
    }
  }

  return {
    analysisRange: { startDate, endDate },
    alignedDays,
    samplesBySymbol,
    missingRatioBySymbol,
    generatedAt,
    qualityWarnings,
  };
}

function fallbackInsight(
  id: CompareInsightCard['id'],
  title: string,
  reason: string,
): CompareInsightCard {
  return {
    id,
    title,
    symbol: '--',
    value: '--',
    reason,
  };
}

function buildInsightCards(
  rows: CompareMetricsRow[],
  symbols: string[],
  matrix: Record<string, Record<string, number | null>>,
): CompareInsightCard[] {
  const bestReturn = rows
    .filter((r) => r.totalReturnPct != null)
    .sort((a, b) => (b.totalReturnPct as number) - (a.totalReturnPct as number))[0];

  const minDrawdown = rows
    .filter((r) => r.maxDrawdownPct != null)
    .sort((a, b) => (b.maxDrawdownPct as number) - (a.maxDrawdownPct as number))[0];

  const minVolatility = rows
    .filter((r) => r.volatilityPct != null)
    .sort((a, b) => (a.volatilityPct as number) - (b.volatilityPct as number))[0];

  let lowestPair: { a: string; b: string; value: number } | null = null;
  for (let i = 0; i < symbols.length; i += 1) {
    for (let j = i + 1; j < symbols.length; j += 1) {
      const a = symbols[i];
      const b = symbols[j];
      const value = matrix[a]?.[b];
      if (value == null) continue;

      if (!lowestPair || value < lowestPair.value) {
        lowestPair = { a, b, value };
      }
    }
  }

  return [
    bestReturn
      ? {
          id: 'bestReturn',
          title: '最佳區間報酬',
          symbol: bestReturn.symbol,
          value: fmtPct(bestReturn.totalReturnPct as number),
          reason: '在同區間內累積報酬最高。',
        }
      : fallbackInsight('bestReturn', '最佳區間報酬', '尚無可計算資料。'),
    minDrawdown
      ? {
          id: 'minDrawdown',
          title: '最大回撤最小',
          symbol: minDrawdown.symbol,
          value: fmtPct(minDrawdown.maxDrawdownPct as number),
          reason: '最大回撤最淺，區間抗跌性相對較好。',
        }
      : fallbackInsight('minDrawdown', '最大回撤最小', '尚無可計算資料。'),
    minVolatility
      ? {
          id: 'minVolatility',
          title: '波動最低',
          symbol: minVolatility.symbol,
          value: fmtPct(minVolatility.volatilityPct as number),
          reason: '日報酬標準差最低，波動相對較小。',
        }
      : fallbackInsight('minVolatility', '波動最低', '尚無可計算資料。'),
    lowestPair
      ? {
          id: 'lowestCorrelationPair',
          title: '最低相關係數組合',
          symbol: `${lowestPair.a} × ${lowestPair.b}`,
          value: `ρ ${lowestPair.value.toFixed(2)}`,
          reason: lowestPair.value < 0
            ? '呈現負相關，具分散風險效果。'
            : '為目前最低相關組合，可做分散配置參考。',
        }
      : fallbackInsight('lowestCorrelationPair', '最低相關係數組合', '共同交易日不足，無法計算。'),
  ];
}

export function buildSymbolColorMap(symbols: string[]): Record<string, string> {
  const uniqueSymbols = [...new Set(symbols)];
  const map: Record<string, string> = {};

  for (const symbol of uniqueSymbols) {
    const idx = hashSymbol(symbol) % COMPARE_COLOR_PALETTE.length;
    map[symbol] = COMPARE_COLOR_PALETTE[idx];
  }

  return map;
}

export function buildMetricsRow(
  symbol: string,
  change: PriceChangeResponse | null,
  volume: VolumeAnalysisResponse | null,
): CompareMetricsRow {
  if (!change || change.data.length === 0) {
    return {
      symbol,
      totalReturnPct: null,
      volatilityPct: null,
      maxDrawdownPct: null,
      winRatePct: null,
      maxDailyGainPct: null,
      maxDailyLossPct: null,
      avgVolume: null,
      avgAmount: null,
    };
  }

  const dailyReturns = change.data
    .map((d) => d.change_percent / 100)
    .filter((n) => Number.isFinite(n));
  const changePercents = change.data.map((d) => d.change_percent).filter((n) => Number.isFinite(n));
  const upDays = change.data.filter((d) => d.change_percent > 0).length;
  const validDays = change.data.length;

  const firstLast = firstAndLastClose(change);
  const totalReturnPct =
    firstLast == null ? null : ((firstLast.last / firstLast.first) - 1) * 100;

  const volumeValues = volume?.data.map((d) => d.volume).filter((n) => Number.isFinite(n)) ?? [];
  const amountValues = volume?.data.map((d) => d.amount).filter((n) => Number.isFinite(n)) ?? [];
  const volatility = std(dailyReturns);

  return {
    symbol,
    totalReturnPct,
    volatilityPct: volatility == null ? null : volatility * 100,
    maxDrawdownPct: maxDrawdownPctFromReturns(dailyReturns),
    winRatePct: validDays > 0 ? (upDays / validDays) * 100 : null,
    maxDailyGainPct: changePercents.length ? Math.max(...changePercents) : null,
    maxDailyLossPct: changePercents.length ? Math.min(...changePercents) : null,
    avgVolume: mean(volumeValues),
    avgAmount: mean(amountValues),
  };
}

export function sortMetricsRows(rows: CompareMetricsRow[], sort: CompareSortState): CompareMetricsRow[] {
  const { key, direction } = sort;
  return [...rows].sort((a, b) => {
    if (key === 'symbol') {
      const cmp = a.symbol.localeCompare(b.symbol, 'zh-Hant');
      return direction === 'asc' ? cmp : -cmp;
    }
    const aVal = a[key];
    const bVal = b[key];
    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    const cmp = aVal - bVal;
    return direction === 'asc' ? cmp : -cmp;
  });
}

function pearson(x: number[], y: number[]): number | null {
  const n = Math.min(x.length, y.length);
  if (n === 0) return null;
  const xSlice = x.slice(0, n);
  const ySlice = y.slice(0, n);
  const meanX = mean(xSlice);
  const meanY = mean(ySlice);
  if (meanX == null || meanY == null) return null;

  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xSlice[i] - meanX;
    const dy = ySlice[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  if (den === 0) return null;
  return num / den;
}

export function buildCorrelationMatrix(
  symbols: string[],
  priceChangeMap: Record<string, PriceChangeResponse | null>,
): Record<string, Record<string, number | null>> {
  const returnsByDateBySymbol: Record<string, Map<string, number>> = {};
  for (const sym of symbols) {
    const data = priceChangeMap[sym]?.data ?? [];
    const map = new Map<string, number>();
    for (const d of data) {
      const date = (d as { date?: string }).date;
      const r = d.change_percent / 100;
      if (typeof date === 'string' && date && Number.isFinite(r)) map.set(date, r);
    }
    returnsByDateBySymbol[sym] = map;
  }

  const matrix: Record<string, Record<string, number | null>> = {};
  for (const a of symbols) {
    matrix[a] = {};
    for (const b of symbols) {
      if (a === b) {
        matrix[a][b] = 1;
      } else {
        const aMap = returnsByDateBySymbol[a] ?? new Map<string, number>();
        const bMap = returnsByDateBySymbol[b] ?? new Map<string, number>();
        const commonDates: string[] = [];
        for (const date of aMap.keys()) {
          if (bMap.has(date)) commonDates.push(date);
        }
        commonDates.sort();
        const x: number[] = [];
        const y: number[] = [];
        for (const date of commonDates) {
          const ax = aMap.get(date);
          const by = bMap.get(date);
          if (ax == null || by == null) continue;
          x.push(ax);
          y.push(by);
        }
        matrix[a][b] = pearson(x, y);
      }
    }
  }
  return matrix;
}

export function toggleHiddenSymbol(hiddenSymbols: string[], symbol: string): string[] {
  const hiddenSet = new Set(hiddenSymbols);
  if (hiddenSet.has(symbol)) {
    hiddenSet.delete(symbol);
  } else {
    hiddenSet.add(symbol);
  }
  return [...hiddenSet];
}

export function visibleSymbolsFromHidden(symbols: string[], hiddenSymbols: string[]): string[] {
  const hiddenSet = new Set(hiddenSymbols);
  return symbols.filter((symbol) => !hiddenSet.has(symbol));
}

export function buildCompareViewModel({
  symbols,
  startDate,
  endDate,
  priceChangeMap,
  volumeMap,
  generatedAt = new Date().toISOString(),
}: BuildCompareViewModelInput): CompareViewModel {
  const metricsRows = symbols.map((symbol) =>
    buildMetricsRow(symbol, priceChangeMap[symbol] ?? null, volumeMap[symbol] ?? null),
  );

  const correlationMatrix = buildCorrelationMatrix(symbols, priceChangeMap);
  const qualityMeta = buildQualityMeta(symbols, startDate, endDate, priceChangeMap, generatedAt);
  const insights = buildInsightCards(metricsRows, symbols, correlationMatrix);
  const symbolColors = buildSymbolColorMap(symbols);

  return {
    metricsRows,
    correlationMatrix,
    insights,
    qualityMeta,
    symbolColors,
  };
}
