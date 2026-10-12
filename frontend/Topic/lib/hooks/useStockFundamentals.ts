import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchDividendResults, fetchFinancialStatements, fetchMonthlyRevenues, fetchValuations } from '../api/stock';
import { userFacingMessage } from '../api/errorDetail';
import {
  buildBalanceQuarters,
  buildCashflowQuarters,
  buildDividendEvents,
  buildQuarterProfits,
  buildRevenueMonths,
  buildValuations,
  type BalanceQuarter,
  type CashflowQuarter,
  type DividendEvent,
  type QuarterProfit,
  type RevenueMonth,
  type ValuationDay,
} from '../fundamentals/stockFundamentals';
import { shiftYmdMonths } from '../utils/date';

/*
 * 個股頁的基本面：期間不跟著 K 線的日期區間走，固定以資料最後一天（baseDate）往前推：
 * 月營收 3 年（畫 2 年、第一個月也算得出年增率）、單季獲利 4 年（畫 12 季＋年增率）、估值 1 年、除權息 5 年。
 * 資產負債表與現金流量表比較大，打開「財務體質」分頁才讀（loadStatements）。
 */
export const FUNDAMENTAL_WINDOWS = { revenueMonths: 36, incomeMonths: 48, valuationMonths: 12, dividendMonths: 60, statementMonths: 36 } as const;

type Section<T> = { data: T | null; error: string | null };
const empty = <T,>(): Section<T> => ({ data: null, error: null });

export interface StockFundamentals {
  loading: boolean;
  revenue: Section<RevenueMonth[]>;
  quarters: Section<QuarterProfit[]>;
  valuations: Section<ValuationDay[]>;
  dividends: Section<DividendEvent[]>;
  /** 資產負債表與現金流量表（打開時才讀） */
  statements: { loading: boolean; balance: BalanceQuarter[] | null; cashflow: CashflowQuarter[] | null; error: string | null };
  /** 各區塊實際查詢的起訖日（匯出與圖說用） */
  windows: { revenue: [string, string]; income: [string, string]; valuation: [string, string]; dividend: [string, string]; statement: [string, string] } | null;
  reload: () => void;
  loadStatements: () => void;
}

const settled = <T, R>(result: PromiseSettledResult<T>, map: (value: T) => R, fallback: string): Section<R> =>
  result.status === 'fulfilled' ? { data: map(result.value), error: null } : { data: null, error: userFacingMessage(result.reason, fallback) };

const windowFor = (end: string, months: number): [string, string] => [shiftYmdMonths(end, -months), end];

export function useStockFundamentals(symbol: string, baseDate: string | null): StockFundamentals {
  const [loading, setLoading] = useState(false);
  const [revenue, setRevenue] = useState(empty<RevenueMonth[]>);
  const [quarters, setQuarters] = useState(empty<QuarterProfit[]>);
  const [valuations, setValuations] = useState(empty<ValuationDay[]>);
  const [dividends, setDividends] = useState(empty<DividendEvent[]>);
  const [statements, setStatements] = useState<StockFundamentals['statements']>({ loading: false, balance: null, cashflow: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const request = useRef(0);
  const statementRequest = useRef(0);

  const windows = baseDate
    ? {
        revenue: windowFor(baseDate, FUNDAMENTAL_WINDOWS.revenueMonths),
        income: windowFor(baseDate, FUNDAMENTAL_WINDOWS.incomeMonths),
        valuation: windowFor(baseDate, FUNDAMENTAL_WINDOWS.valuationMonths),
        dividend: windowFor(baseDate, FUNDAMENTAL_WINDOWS.dividendMonths),
        statement: windowFor(baseDate, FUNDAMENTAL_WINDOWS.statementMonths),
      }
    : null;
  const windowKey = windows ? JSON.stringify(windows) : '';

  useEffect(() => {
    // 換股票：清掉上一檔，避免短暫顯示別檔的數字
    setRevenue(empty());
    setQuarters(empty());
    setValuations(empty());
    setDividends(empty());
    setStatements({ loading: false, balance: null, cashflow: null, error: null });
    statementRequest.current += 1;
  }, [symbol]);

  useEffect(() => {
    if (!windows || !symbol) return;
    const id = ++request.current;
    setLoading(true);
    void Promise.allSettled([
      fetchMonthlyRevenues(symbol, ...windows.revenue),
      fetchFinancialStatements(symbol, 'income', ...windows.income),
      fetchValuations(symbol, ...windows.valuation),
      fetchDividendResults(symbol, ...windows.dividend),
    ]).then(([rev, income, valuation, dividend]) => {
      if (id !== request.current) return;
      setRevenue(settled(rev, buildRevenueMonths, '月營收暫時無法取得'));
      setQuarters(settled(income, buildQuarterProfits, '財報暫時無法取得'));
      setValuations(settled(valuation, buildValuations, '估值暫時無法取得'));
      setDividends(settled(dividend, buildDividendEvents, '除權息資料暫時無法取得'));
      setLoading(false);
    });
    // windowKey 涵蓋 windows 的內容
  }, [symbol, windowKey, attempt]);

  const loadStatements = useCallback(() => {
    if (!windows || !symbol) return;
    const id = ++statementRequest.current;
    setStatements((prev) => ({ ...prev, loading: true, error: null }));
    void Promise.all([
      fetchFinancialStatements(symbol, 'balance', ...windows.statement),
      fetchFinancialStatements(symbol, 'cashflow', ...windows.statement),
    ]).then(
      ([balance, cashflow]) => {
        if (id !== statementRequest.current) return;
        setStatements({ loading: false, balance: buildBalanceQuarters(balance), cashflow: buildCashflowQuarters(cashflow), error: null });
      },
      (error: unknown) => {
        if (id !== statementRequest.current) return;
        setStatements({ loading: false, balance: null, cashflow: null, error: userFacingMessage(error, '資產負債表與現金流量表暫時無法取得') });
      },
    );
  }, [symbol, windowKey]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  // 有 baseDate 但第一批還沒回來時也算讀取中（effect 在畫面之後才跑，不然會先閃一下「沒有資料」）
  const pending = !!windows && revenue.data == null && revenue.error == null;
  return { loading: loading || pending, revenue, quarters, valuations, dividends, statements, windows, reload, loadStatements };
}
