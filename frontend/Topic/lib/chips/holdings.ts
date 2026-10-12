import type { ForeignShareholdingResponse, HoldingShareLevelResponse, MarginTradeResponse } from '../types/api';
import { toNum } from '../utils/parseNumber';

/*
 * 個股頁「信用交易與持股」的資料整理，只用後端回傳的欄位：
 * - 融資融券（交易所公布，單位是張）
 * - 外資持股（股數單位是股，比例是百分比）
 * - 集保股權分散（每週，級距以股數劃分）
 * 衍生值只有標準比率：餘額增減、券資比。
 */

const isDay = (value: string | null | undefined): value is string => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value.slice(0, 10));
const diff = (today: number | null, yesterday: number | null) => (today == null || yesterday == null ? null : today - yesterday);

export interface MarginDay {
  date: string;
  /** 以下單位都是張 */
  marginBuy: number | null;
  marginSell: number | null;
  marginRepay: number | null;
  marginBalance: number | null;
  /** 融資餘額增減（今日餘額 − 前日餘額） */
  marginChange: number | null;
  shortSell: number | null;
  shortBuy: number | null;
  shortRepay: number | null;
  shortBalance: number | null;
  shortChange: number | null;
  offset: number | null;
  /** 券資比（%）＝融券餘額 ÷ 融資餘額 */
  shortMarginRatio: number | null;
}

/** 由舊到新 */
export function buildMarginDays(rows: MarginTradeResponse[]): MarginDay[] {
  const byDate = new Map<string, MarginDay>();
  for (const row of rows) {
    if (!isDay(row.date)) continue;
    const marginBalance = row.margin_purchase_today_balance;
    const shortBalance = row.short_sale_today_balance;
    byDate.set(row.date.slice(0, 10), {
      date: row.date.slice(0, 10),
      marginBuy: row.margin_purchase_buy,
      marginSell: row.margin_purchase_sell,
      marginRepay: row.margin_purchase_cash_repayment,
      marginBalance,
      marginChange: diff(marginBalance, row.margin_purchase_yesterday_balance),
      shortSell: row.short_sale_sell,
      shortBuy: row.short_sale_buy,
      shortRepay: row.short_sale_cash_repayment,
      shortBalance,
      shortChange: diff(shortBalance, row.short_sale_yesterday_balance),
      offset: row.offset_loan_and_short,
      shortMarginRatio: marginBalance != null && shortBalance != null && marginBalance > 0 ? (shortBalance / marginBalance) * 100 : null,
    });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export interface ForeignHoldingDay {
  date: string;
  /** 外資持股（股） */
  shares: number | null;
  /** 外資持股比例（%） */
  ratio: number | null;
  /** 外資尚可投資比例（%） */
  remainRatio: number | null;
  /** 外資投資上限（%） */
  upperLimitRatio: number | null;
  /** 發行股數（股） */
  issuedShares: number | null;
}

/** 由舊到新；沒有持股比例也沒有股數的日子不列 */
export function buildForeignHoldingDays(rows: ForeignShareholdingResponse[]): ForeignHoldingDay[] {
  const byDate = new Map<string, ForeignHoldingDay>();
  for (const row of rows) {
    if (!isDay(row.date)) continue;
    const day = {
      date: row.date.slice(0, 10),
      shares: row.foreign_investment_shares,
      ratio: toNum(row.foreign_investment_shares_ratio),
      remainRatio: toNum(row.foreign_investment_remain_ratio),
      upperLimitRatio: toNum(row.foreign_investment_upper_limit_ratio),
      issuedShares: row.number_of_shares_issued,
    };
    if (day.ratio != null || day.shares != null) byDate.set(day.date, day);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export interface HoldingLevel {
  /** 後端原字串，例如「1,000,001以上」 */
  level: string;
  /** 「1,000,001 股以上」「1–999 股」 */
  label: string;
  /** 級距下限（股），排序用 */
  min: number;
  people: number | null;
  /** 占集保庫存數比例（%） */
  percent: number | null;
  /** 股數 */
  shares: number | null;
}

export interface HoldingWeek {
  date: string;
  /** 由小到大的持股級距（不含合計與差異數調整） */
  levels: HoldingLevel[];
  total: { people: number | null; percent: number | null; shares: number | null } | null;
  /** 最大級距（1,000,001 股以上，也就是超過 1,000 張） */
  top: HoldingLevel | null;
}

/** TDCC 最大的級距；超過 1,000 張 */
export const TOP_HOLDING_LEVEL_MIN = 1_000_001;

/** 「1,000-5,000」→ 1000；「1,000,001以上」→ 1000001；不是級距（合計、差異數調整）回傳 null */
export function holdingLevelMin(level: string): number | null {
  const match = /^([\d,]+)\s*(?:-|－|~|以上)/.exec(level.trim());
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

function holdingLevelLabel(level: string): string {
  const text = level.trim().replace(/\s/g, '');
  if (text.endsWith('以上')) return `${text.slice(0, -2)} 股以上`;
  return `${text.replace(/-|－|~/, '–')} 股`;
}

/** 由舊到新，每週一筆 */
export function buildHoldingWeeks(rows: HoldingShareLevelResponse[]): HoldingWeek[] {
  const byDate = new Map<string, HoldingWeek>();
  for (const row of rows) {
    if (!isDay(row.date)) continue;
    const date = row.date.slice(0, 10);
    const week = byDate.get(date) ?? { date, levels: [], total: null, top: null };
    const values = { people: row.people, percent: toNum(row.percent), shares: row.unit };
    if (row.holding_shares_level.trim() === '合計') {
      week.total = values;
    } else {
      const min = holdingLevelMin(row.holding_shares_level);
      if (min != null && !week.levels.some((item) => item.min === min)) {
        week.levels.push({ level: row.holding_shares_level, label: holdingLevelLabel(row.holding_shares_level), min, ...values });
      }
    }
    byDate.set(date, week);
  }
  return [...byDate.values()]
    .map((week) => {
      const levels = [...week.levels].sort((a, b) => a.min - b.min);
      return { ...week, levels, top: levels.find((item) => item.min === TOP_HOLDING_LEVEL_MIN) ?? null };
    })
    .filter((week) => week.levels.length > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}
