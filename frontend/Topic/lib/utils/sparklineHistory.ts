import { fetchHistory } from '../api/stock';
import { toYmdLocal } from './date';

const SPARKLINE_DAYS = 30;

/** 首頁股價卡的迷你走勢：近 30 天收盤，日期由舊到新；日期用本地時間（決議 c22） */
export async function fetchSparklineCloses(symbol: string): Promise<number[]> {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - SPARKLINE_DAYS);
  const res = await fetchHistory(symbol, {
    start_date: toYmdLocal(start),
    end_date: toYmdLocal(end),
    limit: SPARKLINE_DAYS,
  });
  return (res.data ?? [])
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((row) => Number(row.close))
    .filter((v) => Number.isFinite(v));
}
