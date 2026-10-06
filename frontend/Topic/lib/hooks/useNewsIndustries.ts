import { useEffect, useState } from 'react';
import { fetchNewsIndustries } from '../api/news';
import type { NewsIndustry } from '../types/api';

export type NewsIndustriesStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * 新聞篩選的產業清單（/news/industries）。fetchNewsIndustries 有 10 分鐘快取，篩選面板與已套用條件共用只會打一次。
 * enabled 為 false 時不抓（status 停在 idle）。
 */
export function useNewsIndustries(enabled = true) {
  const [state, setState] = useState<{ status: NewsIndustriesStatus; items: NewsIndustry[] }>({ status: 'idle', items: [] });

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setState((prev) => (prev.status === 'ready' ? prev : { status: 'loading', items: [] }));
    fetchNewsIndustries()
      .then((items) => {
        if (active) setState({ status: 'ready', items });
      })
      .catch(() => {
        if (active) setState({ status: 'error', items: [] });
      });
    return () => {
      active = false;
    };
  }, [enabled]);

  return state;
}
