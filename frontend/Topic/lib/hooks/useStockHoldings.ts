import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchForeignShareholding, fetchHoldingShareLevels, fetchMarginTrades } from '../api/stock';
import { userFacingMessage } from '../api/errorDetail';
import {
  buildForeignHoldingDays,
  buildHoldingWeeks,
  buildMarginDays,
  type ForeignHoldingDay,
  type HoldingWeek,
  type MarginDay,
} from '../chips/holdings';

type Section<T> = { data: T | null; error: string | null };
const empty = <T,>(): Section<T> => ({ data: null, error: null });

export interface StockHoldings {
  loading: boolean;
  margin: Section<MarginDay[]>;
  foreign: Section<ForeignHoldingDay[]>;
  holding: Section<HoldingWeek[]>;
  reload: () => void;
}

const settled = <T, R>(result: PromiseSettledResult<T>, map: (value: T) => R, fallback: string): Section<R> =>
  result.status === 'fulfilled' ? { data: map(result.value), error: null } : { data: null, error: userFacingMessage(result.reason, fallback) };

/** 融資融券、外資持股、集保股權分散：和三大法人一樣跟著個股頁的日期區間 */
export function useStockHoldings(symbol: string, startDate: string, endDate: string, enabled: boolean): StockHoldings {
  const [loading, setLoading] = useState(false);
  const [margin, setMargin] = useState(empty<MarginDay[]>);
  const [foreign, setForeign] = useState(empty<ForeignHoldingDay[]>);
  const [holding, setHolding] = useState(empty<HoldingWeek[]>);
  const [attempt, setAttempt] = useState(0);
  const request = useRef(0);

  useEffect(() => {
    setMargin(empty());
    setForeign(empty());
    setHolding(empty());
  }, [symbol]);

  useEffect(() => {
    if (!enabled || !symbol) return;
    const id = ++request.current;
    setLoading(true);
    void Promise.allSettled([
      fetchMarginTrades(symbol, startDate, endDate),
      fetchForeignShareholding(symbol, startDate, endDate),
      fetchHoldingShareLevels(symbol, startDate, endDate),
    ]).then(([marginResult, foreignResult, holdingResult]) => {
      if (id !== request.current) return;
      setMargin(settled(marginResult, buildMarginDays, '融資融券暫時無法取得'));
      setForeign(settled(foreignResult, buildForeignHoldingDays, '外資持股暫時無法取得'));
      setHolding(settled(holdingResult, buildHoldingWeeks, '集保股權分散暫時無法取得'));
      setLoading(false);
    });
  }, [symbol, startDate, endDate, enabled, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const pending = enabled && margin.data == null && margin.error == null;
  return { loading: loading || pending, margin, foreign, holding, reload };
}
