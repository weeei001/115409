import { useCallback, useEffect, useRef, useState } from 'react';
import { postStockBehaviorTextBrief } from '../api/textBrief';
import { formatAdvisorError } from '../api/userFacingError';
import type { TextBriefResponse } from '../types/textBrief';
import { isTaiwanStockCode } from '../utils/stockValidation';

interface Params {
  symbol: string;
}

/** 讀取後端已存好的分析（cache_only）。不帶 as_of_date，跟著後端最新的資料（決議 D9） */
export function useStockTextBrief({ symbol }: Params) {
  const requestSeq = useRef(0);
  const lastKeyRef = useRef<string | null>(null);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<TextBriefResponse | null>(null);
  /** Elapsed seconds while loading a saved analysis. */
  const [seconds, setSeconds] = useState(0);

  const reset = useCallback(() => {
    requestSeq.current += 1;
    lastKeyRef.current = null;
    setPending(false);
    setError(null);
    setData(null);
    setSeconds(0);
  }, []);

  // 換股票就把上一檔的結果清掉，避免抽屜打開瞬間看到別檔的內容
  useEffect(() => {
    reset();
  }, [symbol, reset]);

  useEffect(() => {
    if (!pending) return;
    setSeconds(0);
    const timer = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [pending]);

  const run = useCallback(async () => {
    const trimmed = symbol.trim().toUpperCase();
    if (!isTaiwanStockCode(trimmed)) return;

    const key = trimmed;
    // 同一檔只打一次；失敗後 lastKey 不會留下，所以重試按鈕還是打得出去
    if (pending || lastKeyRef.current === key) return;

    const seq = ++requestSeq.current;
    setPending(true);
    setError(null);

    try {
      const res = await postStockBehaviorTextBrief({
        symbol: trimmed,
        cache_only: true,
      });
      if (seq !== requestSeq.current) return;
      setData(res);
      lastKeyRef.current = key;
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(formatAdvisorError(err));
    } finally {
      if (seq === requestSeq.current) setPending(false);
    }
  }, [symbol, pending]);

  return {
    loading: pending && !data,
    error,
    data,
    seconds,
    run,
    reset,
  };
}

export type UseStockTextBriefResult = ReturnType<typeof useStockTextBrief>;
