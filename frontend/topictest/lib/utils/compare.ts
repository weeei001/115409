import type {
  CompareMetricsRow,
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

export function toPriceChartData(data: MultiStockResponse): CompareChartPoint[] {
  return data.data.map((d) => ({ date: d.date, ...d.prices }));
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

export function buildMetricsRow(
  symbol: string,
  change: PriceChangeResponse | null,
  volume: VolumeAnalysisResponse | null
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
  priceChangeMap: Record<string, PriceChangeResponse | null>
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
