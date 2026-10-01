import type { DailyPriceResponse } from '../types/api';

type VolumeDay = Pick<DailyPriceResponse, 'date' | 'volume_shares'>;

const validVolume = (value: number | null): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Fixed trading-day windows, including the last stored day on or before endDate. */
export function buildVolumeInsight(history: VolumeDay[], endDate: string) {
  const rows = history.filter((row) => row.date <= endDate).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60);
  const window = (period: number) => {
    const values = rows.slice(0, period).map((row) => row.volume_shares).filter(validVolume);
    return { count: values.length, average: values.length === period ? values.reduce((sum, value) => sum + value, 0) / period : null };
  };
  const short = window(20);
  const long = window(60);
  const latest = rows[0]?.volume_shares ?? null;
  const latestVolume = validVolume(latest) ? latest : null;
  const vsMa20 = latestVolume !== null && short.average !== null && short.average > 0
    ? (latestVolume - short.average) / short.average * 100 : null;
  const state = vsMa20 === null ? '資料不足或無法比較'
    : Math.abs(vsMa20) <= 5 ? '接近均量' : vsMa20 > 0 ? '量增' : '量縮';
  return {
    date: rows[0]?.date ?? null, latestVolume, ma20: short.average, ma60: long.average,
    count20: short.count, count60: long.count, vsMa20, state,
  };
}

export type VolumeInsight = ReturnType<typeof buildVolumeInsight>;
