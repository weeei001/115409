import { useCallback, useEffect, useState } from 'react';
import { fetchStockInfos } from '../api/stock';
import type { StockInfo } from '../types/api';

export type StockInfosStatus = 'idle' | 'loading' | 'ready' | 'error';

interface StockInfosState {
  status: StockInfosStatus;
  data: StockInfo[] | null;
  error: unknown;
}

/**
 * /stocks/info 的股票清單（代號、名稱、產業）。fetchStockInfos 有 30 秒去重快取，多個元件同時使用只會打一次。
 * enabled 為 false 時不抓（status 停在 idle）；讀取失敗時保留上一次的資料，retry 重抓。
 */
export function useStockInfos({ enabled = true }: { enabled?: boolean } = {}) {
  const [state, setState] = useState<StockInfosState>({ status: 'idle', data: null, error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setState((prev) => ({ status: 'loading', data: prev.data, error: null }));
    fetchStockInfos()
      .then((data) => {
        if (active) setState({ status: 'ready', data, error: null });
      })
      .catch((error: unknown) => {
        if (active) setState((prev) => ({ status: 'error', data: prev.data, error }));
      });
    return () => {
      active = false;
    };
  }, [enabled, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { ...state, retry };
}
