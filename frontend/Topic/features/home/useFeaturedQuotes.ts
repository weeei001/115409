import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { fetchLatestPrice, fetchStockInfos } from '@/lib/api/stock';
import type { DailyPriceResponse, StockInfo } from '@/lib/types/api';
import { fetchSparklineCloses } from '@/lib/utils/sparklineHistory';
import { userFacingMessage } from '@/lib/api/errorDetail';

/** 首頁顯示的股票數量；實際股票由 stock info API 提供。 */
export const FEATURED_COUNT = 6;

/** 首頁：股票清單 → 精選 6 檔最新價 → 各檔近 30 天 sparkline */
export function useFeaturedQuotes() {
  const [stockInfos, setStockInfos] = useState<StockInfo[]>([]);
  const [loadingSymbols, setLoadingSymbols] = useState(true);
  const [errorSymbols, setErrorSymbols] = useState<string | null>(null);
  const [prices, setPrices] = useState<DailyPriceResponse[]>([]);
  const [loadingPrices, setLoadingPrices] = useState(true);
  const [errorPrices, setErrorPrices] = useState<string | null>(null);
  const [sparklines, setSparklines] = useState<Record<string, number[]>>({});
  /** 遞增就重抓股價；股票清單有 30 秒快取，不能靠重抓清單觸發（決議 c64） */
  const [pricesAttempt, setPricesAttempt] = useState(0);
  const pricesRequest = useRef(0);

  const reloadSymbols = useCallback(() => {
    setLoadingSymbols(true);
    setErrorSymbols(null);
    fetchStockInfos()
      .then((list) => {
        setStockInfos(list);
        // 清單為空時沒有股價可抓，結束骨架改顯示空狀態（決議 c64）
        if (list.length === 0) setLoadingPrices(false);
      })
      .catch((err) => setErrorSymbols(userFacingMessage(err, '無法載入股票清單')))
      .finally(() => setLoadingSymbols(false));
  }, []);

  useEffect(() => {
    reloadSymbols();
  }, [reloadSymbols]);

  const symbols = stockInfos.map((stock) => stock.symbol);

  const retryPrices = useCallback(() => setPricesAttempt((n) => n + 1), []);

  // 換清單或重試時中止還沒完成的舊請求，避免舊資料覆蓋
  useEffect(() => {
    if (stockInfos.length === 0) return;
    const id = ++pricesRequest.current;
    const ctrl = new AbortController();
    const featured = stockInfos.slice(0, FEATURED_COUNT);
    setLoadingPrices(true);
    Promise.allSettled(featured.map((stock) => fetchLatestPrice(stock.symbol, { signal: ctrl.signal })))
      .then((results) => {
        if (ctrl.signal.aborted || id !== pricesRequest.current) return;
        const loaded: DailyPriceResponse[] = [];
        const failed: string[] = [];
        results.forEach((r, i) => {
          if (r.status === 'fulfilled') loaded.push(r.value);
          else failed.push(featured[i].symbol);
        });
        setPrices(loaded);
        setErrorPrices(loaded.length === 0 ? '無法載入股價資料' : null);
        if (failed.length) toast.warning(`部分股價未載入：${failed.join('、')}`);
      })
      .finally(() => {
        if (id === pricesRequest.current && !ctrl.signal.aborted) setLoadingPrices(false);
      });
    return () => ctrl.abort();
  }, [stockInfos, pricesAttempt]);

  useEffect(() => {
    if (prices.length === 0) {
      setSparklines({});
      return;
    }
    let cancelled = false;
    void Promise.allSettled(prices.map(async (p) => ({ symbol: p.symbol, closes: await fetchSparklineCloses(p.symbol) }))).then(
      (results) => {
        if (cancelled) return;
        const next: Record<string, number[]> = {};
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value.closes.length >= 2) next[r.value.symbol] = r.value.closes;
        }
        setSparklines(next);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [prices]);

  const emptySymbols = !loadingSymbols && !errorSymbols && symbols.length === 0;
  return { symbols, stockInfos, loadingSymbols, errorSymbols, emptySymbols, reloadSymbols, prices, loadingPrices, errorPrices, retryPrices, sparklines };
}
