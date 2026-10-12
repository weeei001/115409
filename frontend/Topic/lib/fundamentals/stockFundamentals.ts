import type {
  DividendResultResponse,
  FinancialStatementRowResponse,
  MonthlyRevenueResponse,
  StockValuationResponse,
} from '../types/api';
import { toNum } from '../utils/parseNumber';

/*
 * 個股頁「基本面」的資料整理：只用後端回傳的原始欄位，衍生值只算標準比率
 * （年增率、月增率、毛利率、營業利益率、負債比率、流動比率），不自創分數。
 *
 * 財報有兩種來源（backend app/jobs/market/financial_metrics.py、mops_financial.py）：
 * - 單季指標：item_type 為 EPS／Revenue／GrossProfit／OperatingIncome，公開資訊觀測站的單季數字，合併／個別未標示。
 * - 原始報表：item_type 為 MOPS_{ASOF|YTD}_<雜湊>_{CONSOLIDATED|SEPARATE}_<第幾次出現>；
 *   損益表與現金流量表是「年初累計」，資產負債表是季底餘額。同名科目出現兩次以上時無法判斷是哪一個，不取。
 */

const num = (value: unknown): number | null => (typeof value === 'number' || typeof value === 'string' ? toNum(value) : null);

function isoDay(value: string | null | undefined): string | null {
  const day = value?.slice(0, 10);
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const parsed = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : null;
}

/** 成長率（%）：基期不是正數時不算（負轉正、由虧轉盈的「成長率」沒有意義） */
export function growthPercent(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  const value = (current / previous - 1) * 100;
  return Number.isFinite(value) ? value : null;
}

/** 比率（%）：分母不是正數時不算 */
export function ratioPercent(numerator: number | null | undefined, denominator: number | null | undefined): number | null {
  if (numerator == null || denominator == null || !Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return (numerator / denominator) * 100;
}

// ── 月營收 ──────────────────────────────────────────

export interface RevenueMonth {
  /** YYYY-MM */
  period: string;
  /** 元 */
  revenue: number;
  mom: number | null;
  yoy: number | null;
  /** 公開資訊觀測站彙總表的出表日 YYYY-MM-DD（不是首次公布日，backend app/jobs/market/monthly_revenue.py）；未提供為 null */
  published: string | null;
}

const shiftMonth = (period: string, months: number): string => {
  const [y, m] = period.split('-').map(Number);
  const index = y * 12 + (m - 1) + months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
};

/** 由舊到新；同一個月份有多筆時取出表日較晚的那筆 */
export function buildRevenueMonths(rows: MonthlyRevenueResponse[]): RevenueMonth[] {
  const byPeriod = new Map<string, { revenue: number; published: string | null }>();
  for (const row of rows) {
    const revenue = num(row.revenue);
    const month = row.revenue_month;
    const period = row.revenue_year && month && month >= 1 && month <= 12
      ? `${row.revenue_year}-${String(month).padStart(2, '0')}`
      : isoDay(row.date)?.slice(0, 7);
    if (!period || revenue == null) continue;
    const published = isoDay(row.create_time);
    const existing = byPeriod.get(period);
    if (!existing || (published ?? '') > (existing.published ?? '')) byPeriod.set(period, { revenue, published });
  }
  return [...byPeriod.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, { revenue, published }]) => ({
      period,
      revenue,
      published,
      mom: growthPercent(revenue, byPeriod.get(shiftMonth(period, -1))?.revenue),
      yoy: growthPercent(revenue, byPeriod.get(shiftMonth(period, -12))?.revenue),
    }));
}

// ── 單季獲利 ──────────────────────────────────────────

/** 「2026 Q2」；不是季底日期回傳原字串 */
export function quarterLabel(period: string): string {
  const match = /^(\d{4})-(03|06|09|12)-(30|31)$/.exec(period);
  return match ? `${match[1]} Q${Number(match[2]) / 3}` : period;
}

const isQuarterEnd = (day: string) => /-(03-31|06-30|09-30|12-31)$/.test(day);
const yearBefore = (day: string) => `${Number(day.slice(0, 4)) - 1}${day.slice(4)}`;

/** 後端單季指標的科目名稱（financial_metrics.py 的 METRICS） */
const QUARTER_METRICS = {
  EPS: '基本每股盈餘',
  Revenue: '營業收入',
  GrossProfit: '營業毛利（毛損）',
  OperatingIncome: '營業利益（損失）',
} as const;
type QuarterMetric = keyof typeof QUARTER_METRICS;

export interface QuarterProfit {
  /** 季底 YYYY-MM-DD */
  period: string;
  label: string;
  /** 元 */
  revenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  /** % */
  grossMargin: number | null;
  operatingMargin: number | null;
  /** 元／股 */
  eps: number | null;
  epsYoy: number | null;
}

/** 單季營收、毛利、營業利益、EPS；由舊到新 */
export function buildQuarterProfits(rows: FinancialStatementRowResponse[]): QuarterProfit[] {
  const values = new Map<string, Partial<Record<QuarterMetric, number | 'ambiguous'>>>();
  for (const row of rows) {
    const day = isoDay(row.date);
    if (row.statement !== 'income' || !day || !isQuarterEnd(day) || !(row.item_type in QUARTER_METRICS)) continue;
    const metric = row.item_type as QuarterMetric;
    const value = num(row.value);
    if (normalizeAccount(row.origin_name) !== normalizeAccount(QUARTER_METRICS[metric]) || value == null) continue;
    const entry = values.get(day) ?? {};
    entry[metric] = entry[metric] === undefined ? value : 'ambiguous';
    values.set(day, entry);
  }
  const pick = (day: string, metric: QuarterMetric): number | null => {
    const value = values.get(day)?.[metric];
    return typeof value === 'number' ? value : null;
  };
  return [...values.keys()].sort().map((period) => {
    const revenue = pick(period, 'Revenue');
    const grossProfit = pick(period, 'GrossProfit');
    const operatingIncome = pick(period, 'OperatingIncome');
    const eps = pick(period, 'EPS');
    return {
      period,
      label: quarterLabel(period),
      revenue,
      grossProfit,
      operatingIncome,
      grossMargin: ratioPercent(grossProfit, revenue),
      operatingMargin: ratioPercent(operatingIncome, revenue),
      eps,
      epsYoy: growthPercent(eps, pick(yearBefore(period), 'EPS')),
    };
  });
}

// ── 資產負債表、現金流量表（原始報表） ──────────────────────────────────────────

export type StatementBasis = 'CONSOLIDATED' | 'SEPARATE';
export const STATEMENT_BASIS_LABEL: Record<StatementBasis, string> = { CONSOLIDATED: '合併', SEPARATE: '個別' };

/** 比對科目名稱用：去空白、半形括號換全形 */
export function normalizeAccount(name: string): string {
  return name.replace(/\s/g, '').replace(/\(/g, '（').replace(/\)/g, '）');
}

const MOPS_ITEM = /^MOPS_(ASOF|YTD)_[0-9a-f]{16}_(CONSOLIDATED|SEPARATE)_(\d+)$/;

type AccountValues = Map<string, number | 'ambiguous'>;

/** 季底日 → 編製基礎 → 科目名稱 → 數值 */
function mopsAccounts(rows: FinancialStatementRowResponse[], statement: 'balance' | 'cashflow') {
  const periods = new Map<string, Map<StatementBasis, AccountValues>>();
  for (const row of rows) {
    const day = isoDay(row.date);
    const match = MOPS_ITEM.exec(row.item_type);
    const value = num(row.value);
    if (row.statement !== statement || !day || !isQuarterEnd(day) || !match || value == null) continue;
    const basis = match[2] as StatementBasis;
    const byBasis = periods.get(day) ?? new Map<StatementBasis, AccountValues>();
    const accounts = byBasis.get(basis) ?? new Map<string, number | 'ambiguous'>();
    const name = normalizeAccount(row.origin_name);
    // 同名科目出現第二次（_2 以後）或重複出現，就不知道哪一個才是要的
    accounts.set(name, match[3] !== '1' || accounts.has(name) ? 'ambiguous' : value);
    byBasis.set(basis, accounts);
    periods.set(day, byBasis);
  }
  return periods;
}

/** 依序找第一個存在的科目名稱（金融業用「資產總計」，一般產業用「資產總額」） */
function account(accounts: AccountValues, names: readonly string[]): number | null {
  for (const name of names) {
    const value = accounts.get(normalizeAccount(name));
    if (value === 'ambiguous') return null;
    if (typeof value === 'number') return value;
  }
  return null;
}

/** 每一季優先用合併報表，沒有才用個別報表 */
function eachQuarter<T>(periods: Map<string, Map<StatementBasis, AccountValues>>, build: (accounts: AccountValues) => T) {
  return [...periods.keys()].sort().flatMap((period) => {
    const byBasis = periods.get(period)!;
    const basis: StatementBasis | null = byBasis.has('CONSOLIDATED') ? 'CONSOLIDATED' : byBasis.has('SEPARATE') ? 'SEPARATE' : null;
    return basis ? [{ period, label: quarterLabel(period), basis, ...build(byBasis.get(basis)!) }] : [];
  });
}

export interface BalanceQuarter {
  period: string;
  label: string;
  basis: StatementBasis;
  /** 元 */
  totalAssets: number | null;
  totalLiabilities: number | null;
  totalEquity: number | null;
  cash: number | null;
  currentAssets: number | null;
  currentLiabilities: number | null;
  /** 負債比率（%）＝負債總額 ÷ 資產總額 */
  debtRatio: number | null;
  /** 流動比率（%）＝流動資產 ÷ 流動負債；金融業沒有流動／非流動之分 */
  currentRatio: number | null;
}

export function buildBalanceQuarters(rows: FinancialStatementRowResponse[]): BalanceQuarter[] {
  return eachQuarter(mopsAccounts(rows, 'balance'), (accounts) => {
    const totalAssets = account(accounts, ['資產總額', '資產總計']);
    const totalLiabilities = account(accounts, ['負債總額', '負債總計']);
    const currentAssets = account(accounts, ['流動資產合計']);
    const currentLiabilities = account(accounts, ['流動負債合計']);
    return {
      totalAssets,
      totalLiabilities,
      totalEquity: account(accounts, ['權益總額', '權益總計']),
      cash: account(accounts, ['現金及約當現金']),
      currentAssets,
      currentLiabilities,
      debtRatio: ratioPercent(totalLiabilities, totalAssets),
      currentRatio: ratioPercent(currentAssets, currentLiabilities),
    };
  });
}

export interface CashflowQuarter {
  period: string;
  label: string;
  basis: StatementBasis;
  /** 年初累計到該季，元 */
  operating: number | null;
  investing: number | null;
  financing: number | null;
}

export function buildCashflowQuarters(rows: FinancialStatementRowResponse[]): CashflowQuarter[] {
  return eachQuarter(mopsAccounts(rows, 'cashflow'), (accounts) => ({
    operating: account(accounts, ['營業活動之淨現金流入（流出）']),
    investing: account(accounts, ['投資活動之淨現金流入（流出）']),
    financing: account(accounts, ['籌資活動之淨現金流入（流出）']),
  }));
}

/** 「2026 年初累計至 Q2」 */
export function ytdLabel(period: string): string {
  const label = quarterLabel(period);
  const match = /^(\d{4}) Q(\d)$/.exec(label);
  return match ? `${match[1]} 年初累計至 Q${match[2]}` : period;
}

// ── 估值 ──────────────────────────────────────────

export interface ValuationDay {
  date: string;
  per: number | null;
  pbr: number | null;
  /** 殖利率（%） */
  dividendYield: number | null;
}

/** 由舊到新；三個值都沒有的日子不列 */
export function buildValuations(rows: StockValuationResponse[]): ValuationDay[] {
  const byDate = new Map<string, ValuationDay>();
  for (const row of rows) {
    const date = isoDay(row.date);
    const point = { date: date ?? '', per: num(row.per), pbr: num(row.pbr), dividendYield: num(row.dividend_yield) };
    if (date && [point.per, point.pbr, point.dividendYield].some((value) => value != null)) byDate.set(date, point);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ── 除權息 ──────────────────────────────────────────

export interface DividendEvent {
  date: string;
  /** 「權」「息」「權息」；未提供為 null */
  kind: string | null;
  /** 權值＋息值（元） */
  value: number | null;
  beforePrice: number | null;
  referencePrice: number | null;
}

/** 由新到舊 */
export function buildDividendEvents(rows: DividendResultResponse[]): DividendEvent[] {
  return rows
    .flatMap((row) => {
      const date = isoDay(row.date);
      if (!date) return [];
      return [{
        date,
        kind: row.stock_or_cash_dividend?.trim() || null,
        value: num(row.stock_and_cash_dividend),
        beforePrice: num(row.before_price),
        referencePrice: num(row.reference_price),
      }];
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export interface DividendYear {
  year: string;
  /** 當年度各次除權息的權值＋息值合計（元） */
  total: number;
  count: number;
}

/** 依除權息日的年度合計；由新到舊 */
export function dividendYears(events: DividendEvent[]): DividendYear[] {
  const years = new Map<string, DividendYear>();
  for (const event of events) {
    if (event.value == null) continue;
    const year = event.date.slice(0, 4);
    const entry = years.get(year) ?? { year, total: 0, count: 0 };
    entry.total += event.value;
    entry.count += 1;
    years.set(year, entry);
  }
  return [...years.values()].sort((a, b) => b.year.localeCompare(a.year));
}

export const lastOf = <T,>(rows: readonly T[]): T | null => (rows.length ? rows[rows.length - 1] : null);
