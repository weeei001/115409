import type {
  CompareInsightCard,
  CompareMetricsRow,
  CompareQualityMeta,
  CompareViewModel,
  MultiStockResponse,
  PriceChangeResponse,
  VolumeAnalysisResponse,
} from '../types';
import type {
  InstitutionalTradeListResponse,
  TechnicalIndicatorListResponse,
  TechnicalIndicatorDayRow,
} from '../types/stockDashboard';
import { fmtInstitutionalShares, fmtPercent } from './format';
import {
  directionLabel,
  maTrendSpreadPct,
  momentumBreakdown,
} from './compareSignals';

type CompareChartPoint = {
  date: string;
  [key: string]: string | number | null;
};

/** 台股年化常數：一年約 252 個交易日 */
const TRADING_DAYS_PER_YEAR = 252;
const ANNUALIZE_FACTOR = Math.sqrt(TRADING_DAYS_PER_YEAR);

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

/**
 * 多股比較線色：用於辨識不同股票，**非漲跌語意**。
 * 避開純紅純綠（#ef4444 / #16a34a 等），以免使用者誤把線色當成「漲/跌」（紅漲綠跌）。
 * 改用冷暖中性色相（橙、藍、紫、青、洋紅、琥珀、靛、天藍等）。
 */
export const COMPARE_COLOR_PALETTE = [
  '#f97316', // orange-500
  '#2563eb', // blue-600
  '#9333ea', // purple-600
  '#0891b2', // cyan-600
  '#db2777', // pink-600
  '#d97706', // amber-600
  '#4f46e5', // indigo-600
  '#7c3aed', // violet-600
  '#0284c7', // sky-600
  '#a16207', // yellow-700
  '#92400e', // amber-800
  '#581c87', // purple-900
  '#155e75', // cyan-800
  '#831843', // pink-900
  '#1d4ed8', // blue-700
  '#3730a3', // indigo-800
];

function isValidPrice(price: number | null | undefined): price is number {
  return typeof price === 'number' && Number.isFinite(price);
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
  if (nums.length < 2) return null;
  const avg = mean(nums);
  if (avg == null) return null;
  // 樣本標準差（Bessel 修正：除以 n−1），避免低估波動度
  const variance = nums.reduce((acc, n) => acc + (n - avg) ** 2, 0) / (nums.length - 1);
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
          value: fmtPercent(bestReturn.totalReturnPct as number),
          reason: '在同區間內累積報酬最高。',
        }
      : fallbackInsight('bestReturn', '最佳區間報酬', '尚無可計算資料。'),
    minDrawdown
      ? {
          id: 'minDrawdown',
          title: '最大回撤最小',
          symbol: minDrawdown.symbol,
          value: fmtPercent(minDrawdown.maxDrawdownPct as number),
          reason: '最大回撤最淺，區間抗跌性相對較好。',
        }
      : fallbackInsight('minDrawdown', '最大回撤最小', '尚無可計算資料。'),
    minVolatility
      ? {
          id: 'minVolatility',
          title: '波動最低',
          symbol: minVolatility.symbol,
          value: fmtPercent(minVolatility.volatilityPct as number),
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
    // 年化波動度：日報酬標準差 × √252 × 100%
    volatilityPct: volatility == null ? null : volatility * ANNUALIZE_FACTOR * 100,
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

// ────────────────────────────────────────────────────────────────────────────
//  法人聚合（期間外資 / 投信 / 自營 / 合計 + 最大單日合計買超 + 連續買超天數）
// ────────────────────────────────────────────────────────────────────────────

export interface InstitutionalAggregate {
  symbol: string;
  foreignNet: number | null;
  investmentTrustNet: number | null;
  dealerNet: number | null;
  totalNet: number | null;
  maxDailyTotalNet: number | null;
  maxDailyTotalNetDate: string | null;
  consecutiveBuyDays: number;
}

export function aggregateInstitutional(
  symbol: string,
  list: InstitutionalTradeListResponse | null,
): InstitutionalAggregate {
  if (!list || list.data.length === 0) {
    return {
      symbol,
      foreignNet: null,
      investmentTrustNet: null,
      dealerNet: null,
      totalNet: null,
      maxDailyTotalNet: null,
      maxDailyTotalNetDate: null,
      consecutiveBuyDays: 0,
    };
  }

  let foreign = 0;
  let foreignSamples = 0;
  let trust = 0;
  let trustSamples = 0;
  let dealer = 0;
  let dealerSamples = 0;
  let total = 0;
  let totalSamples = 0;
  let maxDay: number | null = null;
  let maxDayDate: string | null = null;

  for (const row of list.data) {
    if (row.foreign_excl_dealer_net != null && Number.isFinite(row.foreign_excl_dealer_net)) {
      foreign += row.foreign_excl_dealer_net;
      foreignSamples += 1;
    }
    if (row.investment_trust_net != null && Number.isFinite(row.investment_trust_net)) {
      trust += row.investment_trust_net;
      trustSamples += 1;
    }
    if (row.dealer_net_total != null && Number.isFinite(row.dealer_net_total)) {
      dealer += row.dealer_net_total;
      dealerSamples += 1;
    }
    if (row.total_net != null && Number.isFinite(row.total_net)) {
      total += row.total_net;
      totalSamples += 1;
      if (maxDay == null || row.total_net > maxDay) {
        maxDay = row.total_net;
        maxDayDate = row.date;
      }
    }
  }

  // 從尾端往回算「連續買超天數」（total_net > 0）
  let consecutive = 0;
  for (let i = list.data.length - 1; i >= 0; i -= 1) {
    const v = list.data[i].total_net;
    if (v != null && Number.isFinite(v) && v > 0) consecutive += 1;
    else break;
  }

  return {
    symbol,
    foreignNet: foreignSamples > 0 ? foreign : null,
    investmentTrustNet: trustSamples > 0 ? trust : null,
    dealerNet: dealerSamples > 0 ? dealer : null,
    totalNet: totalSamples > 0 ? total : null,
    maxDailyTotalNet: maxDay,
    maxDailyTotalNetDate: maxDayDate,
    consecutiveBuyDays: consecutive,
  };
}

/** 給法人累計買賣超折線圖用的資料：每檔在每個 union date 的累計 total_net（null 不前進） */
export interface InstitutionalCumulativeRow {
  date: string;
  [symbol: string]: string | number | null;
}

export function buildInstitutionalCumulativeChart(
  symbols: string[],
  institutionalMap: Record<string, InstitutionalTradeListResponse | null>,
): InstitutionalCumulativeRow[] {
  const dateSet = new Set<string>();
  for (const sym of symbols) {
    const rows = institutionalMap[sym]?.data ?? [];
    for (const row of rows) {
      if (row.date) dateSet.add(row.date);
    }
  }
  const dates = [...dateSet].sort();

  const cumPerSymbol: Record<string, Map<string, number>> = {};
  for (const sym of symbols) {
    const rows = institutionalMap[sym]?.data ?? [];
    const byDate = new Map<string, number>();
    let running = 0;
    for (const row of rows) {
      if (row.total_net != null && Number.isFinite(row.total_net)) {
        running += row.total_net;
      }
      byDate.set(row.date, running);
    }
    cumPerSymbol[sym] = byDate;
  }

  return dates.map((date) => {
    const point: InstitutionalCumulativeRow = { date };
    for (const sym of symbols) {
      const v = cumPerSymbol[sym]?.get(date);
      point[sym] = v == null ? null : v;
    }
    return point;
  });
}

// ────────────────────────────────────────────────────────────────────────────
//  類別冠軍（5 格 KPI）：取代舊 4 格 buildInsightCards，補入法人最愛 / 均線最偏多
// ────────────────────────────────────────────────────────────────────────────

export interface CategoryLeader {
  id:
    | 'bestReturn'
    | 'minVolatility'
    | 'institutionalFavorite'
    | 'strongestMomentum'
    | 'lowestCorrelationPair';
  title: string;
  /** 主要股代號；對組合（如最低相關性）為 'A × B' */
  symbol: string;
  /** 該檔主數值的展示字串（已格式化） */
  value: string;
  /** 補充解釋（一句話） */
  reason: string;
}

function fallbackLeader(
  id: CategoryLeader['id'],
  title: string,
  reason: string,
): CategoryLeader {
  return { id, title, symbol: '--', value: '--', reason };
}

export function buildCategoryLeaders(
  symbols: string[],
  metricsRows: CompareMetricsRow[],
  institutionalAggregateMap: Record<string, InstitutionalAggregate>,
  technicalLatestMap: Record<string, TechnicalIndicatorDayRow | null>,
  correlationMatrix: Record<string, Record<string, number | null>>,
): CategoryLeader[] {
  const bestReturn = metricsRows
    .filter((r) => r.totalReturnPct != null)
    .sort((a, b) => (b.totalReturnPct as number) - (a.totalReturnPct as number))[0];

  const minVolatility = metricsRows
    .filter((r) => r.volatilityPct != null)
    .sort((a, b) => (a.volatilityPct as number) - (b.volatilityPct as number))[0];

  const institutionalSorted = symbols
    .map((sym) => institutionalAggregateMap[sym])
    .filter((a): a is InstitutionalAggregate => Boolean(a) && a.totalNet != null)
    .sort((a, b) => (b.totalNet as number) - (a.totalNet as number));
  const topInstitutional = institutionalSorted[0];

  const momentumSorted = symbols
    .map((sym) => ({
      symbol: sym,
      score: maTrendSpreadPct(technicalLatestMap[sym] ?? null),
    }))
    .filter((m): m is { symbol: string; score: number } => m.score != null)
    .sort((a, b) => b.score - a.score);
  const topMomentum = momentumSorted[0];

  let lowestPair: { a: string; b: string; value: number } | null = null;
  for (let i = 0; i < symbols.length; i += 1) {
    for (let j = i + 1; j < symbols.length; j += 1) {
      const a = symbols[i];
      const b = symbols[j];
      const value = correlationMatrix[a]?.[b];
      if (value == null) continue;
      if (!lowestPair || value < lowestPair.value) {
        lowestPair = { a, b, value };
      }
    }
  }

  const momentumBd = topMomentum
    ? momentumBreakdown(technicalLatestMap[topMomentum.symbol] ?? null)
    : null;

  const momentumReason = (() => {
    if (!topMomentum) return '技術指標資料不足，無法計算均線乖離。';
    const lead =
      topMomentum.score >= 0
        ? `MA20 高於 MA60 ${fmtPercent(topMomentum.score, { sign: true })}，均線多頭排列最明顯`
        : `MA20 仍低於 MA60 ${fmtPercent(topMomentum.score, { sign: true })}，為比較組中相對最強`;
    const parts: string[] = [];
    if (momentumBd && momentumBd.rsi.zone !== 'na') {
      const zoneLabel =
        momentumBd.rsi.zone === 'overbought' ? '超買區' :
        momentumBd.rsi.zone === 'oversold' ? '超賣區' : '中性區';
      parts.push(`RSI ${momentumBd.rsi.value?.toFixed(0) ?? '—'}（${zoneLabel}）`);
    }
    if (momentumBd && momentumBd.macd.direction !== 'na') {
      parts.push(`MACD ${directionLabel(momentumBd.macd.direction)}`);
    }
    return parts.length > 0 ? `${lead}；${parts.join('、')}。` : `${lead}。`;
  })();

  const correlationReason = (() => {
    if (!lowestPair) return '';
    const v = lowestPair.value;
    if (v < 0) return '呈現負相關，理論上具分散風險效果。';
    if (v < 0.3) return '相關性低，分散效果尚可。';
    if (v < 0.7) return '中度相關，分散效果有限。';
    return '相關性偏高，並無顯著分散效果。';
  })();

  return [
    bestReturn
      ? {
          id: 'bestReturn' as const,
          title: '期間累積報酬最高',
          symbol: bestReturn.symbol,
          value: fmtPercent(bestReturn.totalReturnPct as number, { sign: true }),
          reason: '依首末日收盤計算之累積報酬最高。',
        }
      : fallbackLeader('bestReturn', '期間累積報酬最高', '尚無可計算資料。'),
    minVolatility
      ? {
          id: 'minVolatility' as const,
          title: '年化波動最低',
          symbol: minVolatility.symbol,
          value: fmtPercent(minVolatility.volatilityPct as number),
          reason: '日報酬標準差 × √252 最低，走勢相對最穩。',
        }
      : fallbackLeader('minVolatility', '年化波動最低', '尚無可計算資料。'),
    topInstitutional
      ? {
          id: 'institutionalFavorite' as const,
          title: '法人合計買超最高',
          symbol: topInstitutional.symbol,
          value: fmtInstitutionalShares(topInstitutional.totalNet),
          reason: '期間三大法人合計買超總量最大（非投資建議）。',
        }
      : fallbackLeader('institutionalFavorite', '法人合計買超最高', '法人資料載入中或不足。'),
    topMomentum
      ? {
          id: 'strongestMomentum' as const,
          title: '均線最偏多',
          symbol: topMomentum.symbol,
          value: fmtPercent(topMomentum.score, { sign: true }),
          reason: momentumReason,
        }
      : fallbackLeader('strongestMomentum', '均線最偏多', '技術指標資料不足。'),
    lowestPair
      ? {
          id: 'lowestCorrelationPair' as const,
          title: '相關性最低組合',
          symbol: `${lowestPair.a} × ${lowestPair.b}`,
          value: `ρ ${lowestPair.value.toFixed(2)}`,
          reason: correlationReason,
        }
      : fallbackLeader('lowestCorrelationPair', '相關性最低組合', '共同交易日不足。'),
  ];
}
