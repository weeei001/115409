import { useCallback, useEffect, useRef, useState } from 'react';
import { postStockBehaviorTextBrief } from '../api/textBrief';
import { formatAdvisorError } from '../api/userFacingError';
import type { TextBriefResponse } from '../types/textBrief';

interface Params {
  symbol: string;
  /** 分析基準日；留空由後端當成今天 */
  asOfDate?: string;
}

/** Read eligible saved analysis. Omit asOfDate for the current news cutoff;
 * explicit dates are historical cutoffs and must never include newer evidence.
 */
export function useStockTextBrief({ symbol, asOfDate }: Params) {
  const requestSeq = useRef(0);
  const lastKeyRef = useRef<string | null>(null);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<TextBriefResponse | null>(null);
  /** 已等待秒數，給 90 秒左右的等待畫面用 */
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
    if (!trimmed || !/^\d{4,6}$/.test(trimmed)) return;

    const key = `${trimmed}:${asOfDate ?? ''}`;
    // 同一組條件只打一次；失敗後 lastKey 不會留下，所以重試按鈕還是打得出去
    if (pending || lastKeyRef.current === key) return;

    const seq = ++requestSeq.current;
    setPending(true);
    setError(null);

    try {
      const res = await postStockBehaviorTextBrief({
        symbol: trimmed,
        ...(asOfDate ? { as_of_date: asOfDate } : {}),
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
  }, [symbol, asOfDate, pending]);

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
