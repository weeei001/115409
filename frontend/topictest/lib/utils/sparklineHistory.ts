import { fetchHistory } from '../api/stock';

const SPARKLINE_DAYS = 30;

export async function fetchSparklineCloses(symbol: string): Promise<number[]> {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - SPARKLINE_DAYS);
  const res = await fetchHistory(symbol, {
    start_date: start.toISOString().slice(0, 10),
    end_date: end.toISOString().slice(0, 10),
    limit: SPARKLINE_DAYS,
  });
  return res.data
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((row) => Number(row.close))
    .filter((v) => Number.isFinite(v));
}
