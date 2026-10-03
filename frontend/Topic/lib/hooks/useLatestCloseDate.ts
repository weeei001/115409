import { useEffect, useState } from 'react';
import { fetchBenchmarkHistory } from '@/lib/api/benchmark';
import { dedupeFetch } from '@/lib/utils/inFlight';
import { toYmdLocal } from '@/lib/utils/date';

const LOOKBACK_DAYS = 14;
const CACHE_MS = 5 * 60_000;

/** 大盤（TAIEX）最近一筆已儲存收盤的日期；整站共用一次請求（快取 5 分鐘） */
export function fetchLatestCloseDate(): Promise<string | null> {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - LOOKBACK_DAYS);
  const startYmd = toYmdLocal(start);
  const endYmd = toYmdLocal(end);
  return dedupeFetch(
    `latest-close-date ${startYmd} ${endYmd}`,
    async () => {
      const res = await fetchBenchmarkHistory(startYmd, endYmd);
      return res.data.length ? res.data[res.data.length - 1].date : null;
    },
    CACHE_MS,
  );
}

/** 頁首的資料日戳記用。載入中或失敗都回傳 null，由畫面改顯示「非即時收盤資料」 */
export function useLatestCloseDate(): string | null {
  const [date, setDate] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    fetchLatestCloseDate()
      .then((d) => {
        if (active) setDate(d);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return date;
}
