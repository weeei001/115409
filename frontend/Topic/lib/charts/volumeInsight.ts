import type { DailyPriceResponse } from '../types/api';

type VolumeDay = Pick<DailyPriceResponse, 'date' | 'volume_shares'>;

const validVolume = (value: number | null): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** 和 20 日均量相差在 ±5% 以內算「接近均量」 */
const NEAR_AVERAGE_PCT = 5;

/** 成交量相對 20 日均量的百分比；缺值或均量不是正數時回 null */
export function volumeVsMa20(volume: number | null, ma20: number | null): number | null {
  if (!validVolume(volume) || ma20 === null || !Number.isFinite(ma20) || ma20 <= 0) return null;
  return (volume - ma20) / ma20 * 100;
}

export function volumeState(vsMa20: number | null) {
  return vsMa20 === null ? '資料不足或無法比較'
    : Math.abs(vsMa20) <= NEAR_AVERAGE_PCT ? '接近均量' : vsMa20 > 0 ? '量增' : '量縮';
}

/**
 * 量能狀態加上和 20 日均量的差距，例如「量縮（低於 20 日均量 6.2%）」。
 * 價量圖的讀數列和「量能狀態」都用這一句，同一組數字不會出現兩種標籤。
 */
export function volumeVsMa20Text(volume: number | null, ma20: number | null): string {
  const pct = volumeVsMa20(volume, ma20);
  if (pct === null) return '無 20 日均量可比較';
  const diff = Math.abs(pct).toFixed(1);
  if (diff === '0.0') return `${volumeState(pct)}（與 20 日均量相差不到 0.1%）`;
  return `${volumeState(pct)}（${pct > 0 ? '高於' : '低於'} 20 日均量 ${diff}%）`;
}

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
  const vsMa20 = volumeVsMa20(latestVolume, short.average);
  const state = volumeState(vsMa20);
  return {
    date: rows[0]?.date ?? null, latestVolume, ma20: short.average, ma60: long.average,
    count20: short.count, count60: long.count, vsMa20, state,
  };
}

export type VolumeInsight = ReturnType<typeof buildVolumeInsight>;
