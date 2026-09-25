import type { CompareFundamentalsData, FinancialStatementRow } from '../api/compareFundamentals';
import { toNum } from './parseNumber';

interface RevenuePoint { period: string; value: number; publication: string | null }
interface ValuationPoint { period: string; per: number | null; pbr: number | null; yield: number | null }
export type EpsBasis = 'YTD_CONSOLIDATED' | 'YTD_SEPARATE' | 'QUARTER_UNSPECIFIED';
interface EpsPoint { period: string; value: number; basis: EpsBasis }

function number(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  return toNum(value);
}

function isoDate(value: string | null): string | null {
  const day = value?.slice(0, 10);
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const parsed = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : null;
}

function epsBasis(row: FinancialStatementRow): EpsBasis | null {
  if (row.item_type === 'EPS') return 'QUARTER_UNSPECIFIED';
  const match = /^MOPS_YTD_PER_SHARE_[a-f0-9]+_(CONSOLIDATED|SEPARATE)_\d+$/.exec(row.item_type);
  if (!match || !/^基本每股盈餘(?:[（(]元[）)])?$/.test(row.origin_name.replace(/\s/g, ''))) return null;
  return match[1] === 'CONSOLIDATED' ? 'YTD_CONSOLIDATED' : 'YTD_SEPARATE';
}

function epsPoints(rows: FinancialStatementRow[], endDate: string): EpsPoint[] {
  const grouped = new Map<string, EpsPoint[]>();
  for (const row of rows) {
    const period = isoDate(row.date);
    const basis = epsBasis(row);
    const value = number(row.value);
    if (row.statement !== 'income' || !period || period > endDate || !basis || value == null || !/-(03-31|06-30|09-30|12-31)$/.test(period)) continue;
    const key = `${period}|${basis}`;
    grouped.set(key, [...(grouped.get(key) ?? []), { period, basis, value }]);
  }
  // Repeated basic EPS labels are ambiguous; never pick an arbitrary occurrence.
  return [...grouped.values()].filter((points) => points.length === 1).map(([point]) => point);
}

function growth(current: number | undefined, previous: number | undefined): number | null {
  if (current == null || previous == null || previous <= 0) return null;
  const result = (current / previous - 1) * 100;
  return Number.isFinite(result) ? result : null;
}

function yearAgo(period: string): string {
  return `${Number(period.slice(0, 4)) - 1}${period.slice(4)}`;
}

function align<T extends { period: string }>(series: T[][], key: (point: T) => string) {
  const common = series.length ? series[0].filter((point) => series.every((rows) => rows.some((row) => key(row) === key(point)))) : [];
  const selected = common[0];
  return { aligned: !!selected, rows: series.map((rows) => selected ? rows.find((row) => key(row) === key(selected)) ?? null : rows[0] ?? null) };
}

export function buildFundamentalsComparison(symbols: string[], data: Record<string, CompareFundamentalsData | null>, endDate: string) {
  const series = symbols.map((symbol) => {
    const source = data[symbol];
    const revenues: RevenuePoint[] = (source?.revenues ?? []).flatMap((row) => {
      const day = isoDate(row.date);
      const value = number(row.revenue);
      const publication = isoDate(row.create_time);
      const period = row.revenue_year && row.revenue_month && row.revenue_month >= 1 && row.revenue_month <= 12
        ? `${row.revenue_year}-${String(row.revenue_month).padStart(2, '0')}` : day?.slice(0, 7);
      if (row.symbol !== symbol || !day || day > endDate || !period || period > endDate.slice(0, 7) || value == null || (publication && publication > endDate)) return [];
      return [{ period, value, publication }];
    }).sort((a, b) => b.period.localeCompare(a.period));
    const valuations: ValuationPoint[] = (source?.valuations ?? []).flatMap((row) => {
      const period = isoDate(row.date);
      const point = { period: period ?? '', per: number(row.per), pbr: number(row.pbr), yield: number(row.dividend_yield) };
      return row.symbol === symbol && period && period <= endDate && [point.per, point.pbr, point.yield].some((value) => value != null) ? [point] : [];
    }).sort((a, b) => b.period.localeCompare(a.period));
    const basisOrder: Record<EpsBasis, number> = { YTD_CONSOLIDATED: 0, YTD_SEPARATE: 1, QUARTER_UNSPECIFIED: 2 };
    const eps = epsPoints((source?.statements ?? []).filter((row) => row.symbol === symbol), endDate)
      .sort((a, b) => b.period.localeCompare(a.period) || basisOrder[a.basis] - basisOrder[b.basis]);
    return { revenues, valuations, eps };
  });
  const revenue = align(series.map((row) => row.revenues), (point) => point.period);
  const valuation = align(series.map((row) => row.valuations), (point) => point.period);
  const eps = align(series.map((row) => row.eps), (point) => `${point.period}|${point.basis}`);
  return {
    aligned: { revenue: revenue.aligned, valuation: valuation.aligned, eps: eps.aligned && eps.rows.every((point) => point?.basis !== 'QUARTER_UNSPECIFIED') },
    rows: symbols.map((symbol, i) => {
      const r = revenue.rows[i];
      const e = eps.rows[i];
      return { symbol, revenue: r, valuation: valuation.rows[i], eps: e,
        revenueYoy: growth(r?.value, series[i].revenues.find((point) => r && point.period === yearAgo(r.period))?.value),
        epsYoy: e?.basis === 'QUARTER_UNSPECIFIED' ? null : growth(e?.value, series[i].eps.find((point) => e && point.period === yearAgo(e.period) && point.basis === e.basis)?.value),
      };
    }),
    warnings: symbols.flatMap((symbol) => data[symbol]?.warnings ?? [`${symbol} 基本面未提供`]),
  };
}

export function epsPeriodLabel(point: EpsPoint): string {
  const quarter = Number(point.period.slice(5, 7)) / 3;
  const year = point.period.slice(0, 4);
  if (point.basis === 'QUARTER_UNSPECIFIED') return `${year} Q${quarter} 單季（合併／個別未提供）`;
  return `${year} 年初累計至 Q${quarter}（${point.basis === 'YTD_CONSOLIDATED' ? '合併' : '個別'}）`;
}
