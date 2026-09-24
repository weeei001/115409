import type { MultiStockResponse, PriceChangeResponse, VolumeAnalysisResponse } from '../types/api';
import type {
  CategoryLeader,
  CompareChartMode,
  CompareMetricsRow,
  CompareQualityMeta,
  CompareViewModel,
  CorrelationMatrix,
  InstitutionalAggregate,
} from '../types/compare';
import type { InstitutionalDay, TechnicalDay } from '../types/view';
import { COMPARE_SYMBOL_COLORS } from '../charts/theme';
import { fmtInstitutionalShares, fmtPercent } from './format';
import { directionLabel, maTrendSpreadPct, momentumBreakdown } from './compareSignals';
import { getValueTone } from './tone';

/** 台股年化常數：一年約 252 個交易日 */
const TRADING_DAYS_PER_YEAR = 252;
const ANNUALIZE_FACTOR = Math.sqrt(TRADING_DAYS_PER_YEAR);

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// ── 股票代表色 ──────────────────────────────────────────────

/** 依比較清單的順序取色（決議 c76）：第 1 檔用第 1 色…，全頁各區塊一致 */
export function buildSymbolColorMap(symbols: string[]): Record<string, string> {
  return Object.fromEntries([...new Set(symbols)].map((symbol, i) => [symbol, COMPARE_SYMBOL_COLORS[i % COMPARE_SYMBOL_COLORS.length]]));
}

// ── 比較主圖 ────────────────────────────────────────────────

export interface CompareChartSeries {
  dates: string[];
  values: Record<string, Array<number | null>>;
}

/** 報價（元）／指數化（首日 = 100）／累積報酬（%） */
export function toCompareChartSeries(data: MultiStockResponse, mode: CompareChartMode): CompareChartSeries {
  const bases = new Map<string, number>();
  for (const sym of data.symbols) {
    const first = data.data.find((d) => isNum(d.prices[sym]))?.prices[sym];
    if (isNum(first) && first > 0) bases.set(sym, first);
  }
  const values: CompareChartSeries['values'] = {};
  for (const sym of data.symbols) {
    const base = bases.get(sym);
    values[sym] = data.data.map((row) => {
      const price = row.prices[sym];
      if (!isNum(price)) return null;
      if (mode === 'price') return price;
      if (!base) return null;
      return mode === 'index100' ? (price / base) * 100 : (price / base - 1) * 100;
    });
  }
  return { dates: data.data.map((row) => row.date), values };
}

export function toggleHiddenSymbol(hiddenSymbols: string[], symbol: string): string[] {
  return hiddenSymbols.includes(symbol) ? hiddenSymbols.filter((s) => s !== symbol) : [...hiddenSymbols, symbol];
}

export function visibleSymbolsFromHidden(symbols: string[], hiddenSymbols: string[]): string[] {
  const hidden = new Set(hiddenSymbols);
  return symbols.filter((symbol) => !hidden.has(symbol));
}

/** 每檔最後一個有效收盤（快照卡 sparkline 取最近 30 點用） */
export function recentCloses(data: MultiStockResponse | null, symbol: string, points = 30): number[] {
  if (!data) return [];
  return data.data.map((row) => row.prices[symbol]).filter(isNum).slice(-points);
}

// ── 比較指標 ────────────────────────────────────────────────

function mean(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((acc, n) => acc + n, 0) / nums.length;
}

/** 樣本標準差（除以 n−1） */
function std(nums: number[]): number | null {
  if (nums.length < 2) return null;
  const avg = mean(nums) as number;
  return Math.sqrt(nums.reduce((acc, n) => acc + (n - avg) ** 2, 0) / (nums.length - 1));
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

const byDate = <T extends { date: string }>(a: T, b: T) => a.date.localeCompare(b.date);

/**
 * 可用的日報酬列：依日期排序後去掉區間第一天。第一天的 change_percent 是相對區間前一天，
 * 後端實際回 0（決議 D9-c25）；指標表、相關係數、有效樣本與共同交易日都用這份（決議 c71）。
 */
function dailyReturnRows(change: PriceChangeResponse | null) {
  return [...(change?.data ?? [])]
    .sort(byDate)
    .slice(1)
    .filter((d) => typeof d.date === 'string' && d.date && isNum(d.change_percent));
}

export function buildMetricsRow(symbol: string, change: PriceChangeResponse | null, volume: VolumeAnalysisResponse | null): CompareMetricsRow {
  // 平均量與平均金額只看成交資料，漲跌資料缺了也照算（決議 c73）
  const avgVolume = mean(volume?.data.map((d) => d.volume).filter(isNum) ?? []);
  const avgAmount = mean(volume?.data.map((d) => d.amount).filter(isNum) ?? []);
  if (!change || change.data.length === 0) {
    return {
      symbol,
      totalReturnPct: null,
      volatilityPct: null,
      maxDrawdownPct: null,
      winRatePct: null,
      maxDailyGainPct: null,
      maxDailyLossPct: null,
      avgVolume,
      avgAmount,
    };
  }

  const rows = [...change.data].sort(byDate);
  const changePercents = dailyReturnRows(change).map((d) => d.change_percent);
  const dailyReturns = changePercents.map((p) => p / 100);
  const upDays = changePercents.filter((p) => p > 0).length;

  const closes = rows.map((d) => d.close).filter(isNum);
  const first = closes[0];
  const last = closes[closes.length - 1];
  const totalReturnPct = closes.length >= 2 && first !== 0 ? (last / first - 1) * 100 : null;

  const volatility = std(dailyReturns);

  return {
    symbol,
    totalReturnPct,
    // 年化波動度：日報酬樣本標準差 × √252 × 100%
    volatilityPct: volatility == null ? null : volatility * ANNUALIZE_FACTOR * 100,
    maxDrawdownPct: maxDrawdownPctFromReturns(dailyReturns),
    // 分母只算有效的日報酬（決議 D9-c25）
    winRatePct: changePercents.length > 0 ? (upDays / changePercents.length) * 100 : null,
    maxDailyGainPct: changePercents.length ? Math.max(...changePercents) : null,
    maxDailyLossPct: changePercents.length ? Math.min(...changePercents) : null,
    avgVolume,
    avgAmount,
  };
}

export type CompareSortKey = keyof CompareMetricsRow;

export interface CompareSortState {
  key: CompareSortKey;
  direction: 'asc' | 'desc';
}

/** 排序；空值一律排最後 */
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

// ── 相關性 ──────────────────────────────────────────────────

function pearson(x: number[], y: number[]): number | null {
  const n = Math.min(x.length, y.length);
  if (n === 0) return null;
  const meanX = mean(x.slice(0, n)) as number;
  const meanY = mean(y.slice(0, n)) as number;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? null : num / den;
}

/** 共同交易日的日報酬 Pearson 相關係數；對角線為 1 */
export function buildCorrelationMatrix(symbols: string[], priceChangeMap: Record<string, PriceChangeResponse | null>): CorrelationMatrix {
  const returnsBySymbol: Record<string, Map<string, number>> = {};
  for (const sym of symbols) {
    returnsBySymbol[sym] = new Map(dailyReturnRows(priceChangeMap[sym] ?? null).map((d) => [d.date, d.change_percent / 100]));
  }

  const matrix: CorrelationMatrix = {};
  for (const a of symbols) {
    matrix[a] = {};
    for (const b of symbols) {
      if (a === b) {
        matrix[a][b] = 1;
        continue;
      }
      const aMap = returnsBySymbol[a];
      const bMap = returnsBySymbol[b];
      const common = [...aMap.keys()].filter((date) => bMap.has(date)).sort();
      matrix[a][b] = pearson(
        common.map((date) => aMap.get(date) as number),
        common.map((date) => bMap.get(date) as number),
      );
    }
  }
  return matrix;
}

// ── 資料品質 ────────────────────────────────────────────────

function validDailyDateSet(change: PriceChangeResponse | null): Set<string> {
  return new Set(dailyReturnRows(change).map((d) => d.date));
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
  const dateSets = symbols.map((symbol) => {
    const set = validDailyDateSet(priceChangeMap[symbol] ?? null);
    for (const date of set) unionDates.add(date);
    samplesBySymbol[symbol] = set.size;
    return set;
  });

  for (const symbol of symbols) {
    const sampleCount = samplesBySymbol[symbol] ?? 0;
    const missingRatio = unionDates.size > 0 ? Math.max(0, 1 - sampleCount / unionDates.size) : 0;
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
  if (dateSets.length > 0) {
    const [first, ...rest] = dateSets;
    alignedDays = [...first].filter((date) => rest.every((set) => set.has(date))).length;
  }

  if (symbols.length >= 2) {
    if (alignedDays === 0) qualityWarnings.push('標的之間沒有共同交易日，相關係數無法計算。');
    else if (alignedDays < 20) qualityWarnings.push(`共同交易日僅 ${alignedDays} 天，相關係數穩定性較低。`);
  }

  return { analysisRange: { startDate, endDate }, alignedDays, samplesBySymbol, missingRatioBySymbol, generatedAt, qualityWarnings };
}

export function buildCompareViewModel({
  symbols,
  startDate,
  endDate,
  priceChangeMap,
  volumeMap,
  generatedAt = new Date().toISOString(),
}: {
  symbols: string[];
  startDate: string;
  endDate: string;
  priceChangeMap: Record<string, PriceChangeResponse | null>;
  volumeMap: Record<string, VolumeAnalysisResponse | null>;
  generatedAt?: string;
}): CompareViewModel {
  return {
    metricsRows: symbols.map((symbol) => buildMetricsRow(symbol, priceChangeMap[symbol] ?? null, volumeMap[symbol] ?? null)),
    correlationMatrix: buildCorrelationMatrix(symbols, priceChangeMap),
    qualityMeta: buildQualityMeta(symbols, startDate, endDate, priceChangeMap, generatedAt),
  };
}

// ── 三大法人 ────────────────────────────────────────────────

export function aggregateInstitutional(symbol: string, rows: InstitutionalDay[] | null): InstitutionalAggregate {
  const sum = (pick: (row: InstitutionalDay) => number | null) => {
    const values = (rows ?? []).map(pick).filter(isNum);
    return values.length > 0 ? values.reduce((acc, v) => acc + v, 0) : null;
  };

  let maxDay: number | null = null;
  let maxDayDate: string | null = null;
  for (const row of rows ?? []) {
    const v = row.total_institutional_net;
    if (isNum(v) && (maxDay == null || v > maxDay)) {
      maxDay = v;
      maxDayDate = row.date;
    }
  }

  // 從期末往回算連續買超天數（合計 > 0）
  let consecutive = 0;
  for (let i = (rows?.length ?? 0) - 1; i >= 0; i -= 1) {
    const v = rows![i].total_institutional_net;
    if (isNum(v) && v > 0) consecutive += 1;
    else break;
  }

  return {
    symbol,
    foreignNet: sum((r) => r.foreign_net),
    investmentTrustNet: sum((r) => r.investment_trust_net),
    dealerNet: sum((r) => r.dealer_net),
    totalNet: sum((r) => r.total_institutional_net),
    maxDailyTotalNet: maxDay,
    maxDailyTotalNetDate: maxDayDate,
    consecutiveBuyDays: consecutive,
  };
}

/** 各檔在所有日期上的累計合計買賣超（該日沒有資料為 null） */
export function buildInstitutionalCumulative(
  symbols: string[],
  institutionalMap: Record<string, InstitutionalDay[] | null>,
): CompareChartSeries {
  const dates = [...new Set(symbols.flatMap((sym) => (institutionalMap[sym] ?? []).map((row) => row.date)))].sort();
  const values: CompareChartSeries['values'] = {};
  for (const sym of symbols) {
    const byDateMap = new Map<string, number>();
    let running = 0;
    for (const row of institutionalMap[sym] ?? []) {
      if (isNum(row.total_institutional_net)) running += row.total_institutional_net;
      byDateMap.set(row.date, running);
    }
    values[sym] = dates.map((date) => byDateMap.get(date) ?? null);
  }
  return { dates, values };
}

// ── 類別冠軍 ────────────────────────────────────────────────

const fallbackLeader = (id: CategoryLeader['id'], title: string, reason: string): CategoryLeader => ({ id, title, symbol: '--', value: '--', tone: 'neutral', reason });

export function lowestCorrelationPair(symbols: string[], matrix: CorrelationMatrix): { a: string; b: string; value: number } | null {
  let lowest: { a: string; b: string; value: number } | null = null;
  for (let i = 0; i < symbols.length; i += 1) {
    for (let j = i + 1; j < symbols.length; j += 1) {
      const value = matrix[symbols[i]]?.[symbols[j]];
      if (value == null) continue;
      if (!lowest || value < lowest.value) lowest = { a: symbols[i], b: symbols[j], value };
    }
  }
  return lowest;
}

export function buildCategoryLeaders(
  symbols: string[],
  metricsRows: CompareMetricsRow[],
  institutionalAggregateMap: Record<string, InstitutionalAggregate>,
  technicalLatestMap: Record<string, TechnicalDay | null>,
  correlationMatrix: CorrelationMatrix,
): CategoryLeader[] {
  const bestReturn = metricsRows
    .filter((r) => r.totalReturnPct != null)
    .sort((a, b) => (b.totalReturnPct as number) - (a.totalReturnPct as number))[0];

  const minVolatility = metricsRows
    .filter((r) => r.volatilityPct != null)
    .sort((a, b) => (a.volatilityPct as number) - (b.volatilityPct as number))[0];

  const topInstitutional = symbols
    .map((sym) => institutionalAggregateMap[sym])
    .filter((a): a is InstitutionalAggregate => Boolean(a) && a.totalNet != null)
    .sort((a, b) => (b.totalNet as number) - (a.totalNet as number))[0];

  const topMomentum = symbols
    .map((symbol) => ({ symbol, score: maTrendSpreadPct(technicalLatestMap[symbol] ?? null) }))
    .filter((m): m is { symbol: string; score: number } => m.score != null)
    .sort((a, b) => b.score - a.score)[0];

  const lowestPair = lowestCorrelationPair(symbols, correlationMatrix);

  const momentumReason = (() => {
    if (!topMomentum) return '技術指標資料不足，無法計算均線乖離。';
    const lead =
      topMomentum.score >= 0
        ? `MA20 高於 MA60 ${fmtPercent(topMomentum.score, { sign: true })}，均線多頭排列最明顯`
        : `MA20 仍低於 MA60 ${fmtPercent(topMomentum.score, { sign: true })}，為比較組中相對最強`;
    const bd = momentumBreakdown(technicalLatestMap[topMomentum.symbol] ?? null);
    const parts: string[] = [];
    if (bd.rsi.zone !== 'na') {
      const zoneLabel = bd.rsi.zone === 'overbought' ? '超買區' : bd.rsi.zone === 'oversold' ? '超賣區' : '中性區';
      parts.push(`RSI ${bd.rsi.value?.toFixed(0) ?? '—'}（${zoneLabel}）`);
    }
    if (bd.macd.direction !== 'na') parts.push(`MACD ${directionLabel(bd.macd.direction)}`);
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
          id: 'bestReturn',
          title: '期間累積報酬最高',
          symbol: bestReturn.symbol,
          value: fmtPercent(bestReturn.totalReturnPct, { sign: true }),
          tone: getValueTone(bestReturn.totalReturnPct),
          reason: '依首末日收盤計算之累積報酬最高。',
        }
      : fallbackLeader('bestReturn', '期間累積報酬最高', '尚無可計算資料。'),
    minVolatility
      ? {
          id: 'minVolatility',
          title: '年化波動最低',
          symbol: minVolatility.symbol,
          value: fmtPercent(minVolatility.volatilityPct),
          tone: 'neutral',
          reason: '日報酬標準差 × √252 最低，走勢相對最穩。',
        }
      : fallbackLeader('minVolatility', '年化波動最低', '尚無可計算資料。'),
    topInstitutional
      ? {
          id: 'institutionalFavorite',
          title: '法人合計買超最高',
          symbol: topInstitutional.symbol,
          value: fmtInstitutionalShares(topInstitutional.totalNet),
          tone: getValueTone(topInstitutional.totalNet),
          reason: '期間三大法人合計買超總量最大（非投資建議）。',
        }
      : fallbackLeader('institutionalFavorite', '法人合計買超最高', '法人資料載入中或不足。'),
    topMomentum
      ? {
          id: 'strongestMomentum',
          title: '均線最偏多',
          symbol: topMomentum.symbol,
          value: fmtPercent(topMomentum.score, { sign: true }),
          tone: getValueTone(topMomentum.score),
          reason: momentumReason,
        }
      : fallbackLeader('strongestMomentum', '均線最偏多', '技術指標資料不足。'),
    lowestPair
      ? {
          id: 'lowestCorrelationPair',
          title: '相關性最低組合',
          symbol: `${lowestPair.a} × ${lowestPair.b}`,
          value: `ρ ${lowestPair.value.toFixed(2)}`,
          tone: 'neutral',
          reason: correlationReason,
        }
      : fallbackLeader('lowestCorrelationPair', '相關性最低組合', '共同交易日不足。'),
  ];
}
