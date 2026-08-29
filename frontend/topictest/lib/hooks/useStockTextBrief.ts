import { useCallback, useEffect, useRef, useState } from 'react';
import { postStockBehaviorTextBrief } from '../api/stockBehaviorTextBrief';
import { formatAdvisorError } from '../api/userFacingError';
import type { TextBriefResponse } from '../types/textBrief';

interface Params {
  symbol: string;
  /** 分析基準日；留空由後端當成今天 */
  asOfDate?: string;
}

/**
 * 個股頁唯一的 AI 分析來源：`POST /analyze/stock-behavior/text-brief`。
 * Hero 卡片、風險提醒與 AI 抽屜共用同一個實例，全頁只會打一次。
 *
 * 何時發動由呼叫端決定（目前是儀表板基準日就緒時）；同一組 symbol＋as_of_date 只打一次。
 * 自動載入一律 `cache_only`：只讀排程產好的快取，不在頁面上等 LLM；
 * 查無當日快照時後端會退回該檔最近一次的分析。要真的重跑才用 `run(true)`（force_refresh）。
 */
export function useStockTextBrief({ symbol, asOfDate }: Params) {
  const requestSeq = useRef(0);
  const lastKeyRef = useRef<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<TextBriefResponse | null>(null);
  /** 已等待秒數，給 90 秒左右的等待畫面用 */
  const [seconds, setSeconds] = useState(0);

  const reset = useCallback(() => {
    requestSeq.current += 1;
    lastKeyRef.current = null;
    setLoading(false);
    setError(null);
    setData(null);
    setSeconds(0);
  }, []);

  // 換股票就把上一檔的結果清掉，避免抽屜打開瞬間看到別檔的內容
  useEffect(() => {
    reset();
  }, [symbol, reset]);

  useEffect(() => {
    if (!loading) return;
    setSeconds(0);
    const timer = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [loading]);

  const run = useCallback(
    async (force: boolean) => {
      const trimmed = symbol.trim().toUpperCase();
      if (!trimmed) return;

      const key = `${trimmed}:${asOfDate ?? ''}`;
      // force 之外，同一組條件只跑一次；失敗後 lastKey 不會留下，所以重開抽屜會重試
      if (!force && (loading || lastKeyRef.current === key)) return;

      const seq = ++requestSeq.current;
      setLoading(true);
      setError(null);
      if (force) setData(null);

      try {
        const res = await postStockBehaviorTextBrief({
          symbol: trimmed,
          ...(asOfDate ? { as_of_date: asOfDate } : {}),
          ...(force ? { force_refresh: true } : { cache_only: true }),
        });
        if (seq !== requestSeq.current) return;
        setData(res);
        lastKeyRef.current = key;
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setError(formatAdvisorError(err));
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [symbol, asOfDate, loading]
  );

  return { loading, error, data, seconds, run, reset };
}

export type UseStockTextBriefResult = ReturnType<typeof useStockTextBrief>;
