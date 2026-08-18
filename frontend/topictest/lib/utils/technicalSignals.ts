import type { PriceChartData } from '../types/priceChart';

/**
 * 純由儀表板價量資料算出來的技術訊號，跟 AI 分析無關。
 * 個股頁 Hero 卡片的「均線／量能」兩顆 chip 用這裡的結果。
 */

export type RelativePosition = 'above' | 'below' | 'equal' | 'unknown';

export interface PricePositionSummary {
  close: number | null;
  ma20: number | null;
  ma60: number | null;
  relativeToMA20: RelativePosition;
  relativeToMA60: RelativePosition;
}

function compareRelative(close: number | null, ma: number | null): RelativePosition {
  if (close === null || ma === null) return 'unknown';
  if (Math.abs(close - ma) < 1e-6) return 'equal';
  return close > ma ? 'above' : 'below';
}

function latestOverlayValueByTime(
  points: Array<{ time: string; value: number | null }>,
  time: string
): number | null {
  if (!points.length) return null;
  const found = points.find((item) => item.time === time);
  if (found && found.value !== null) return Number(found.value);
  for (let i = points.length - 1; i >= 0; i -= 1) {
    if (points[i].value !== null && points[i].time <= time) return Number(points[i].value);
  }
  return null;
}

export function summarizePricePosition(priceChart: PriceChartData | null): PricePositionSummary {
  const empty: PricePositionSummary = {
    close: null,
    ma20: null,
    ma60: null,
    relativeToMA20: 'unknown',
    relativeToMA60: 'unknown',
  };
  if (!priceChart) return empty;
  const latestCandle = priceChart.candles[priceChart.candles.length - 1];
  if (!latestCandle) return empty;
  const close = latestCandle.close;
  const ma20 = latestOverlayValueByTime(priceChart.overlays.MA20, latestCandle.time);
  const ma60 = latestOverlayValueByTime(priceChart.overlays.MA60, latestCandle.time);
  return {
    close,
    ma20,
    ma60,
    relativeToMA20: compareRelative(close, ma20),
    relativeToMA60: compareRelative(close, ma60),
  };
}

/** 均線結構的短標籤：偏多／偏空／盤整 */
export function getMaStructureLabel(summary: PricePositionSummary): string {
  if (summary.relativeToMA20 === 'above' && summary.relativeToMA60 === 'above') return '偏多';
  if (summary.relativeToMA20 === 'below' && summary.relativeToMA60 === 'below') return '偏空';
  return '盤整';
}

export function getVolumeInsight(priceChart: PriceChartData | null): {
  latest: number | null;
  ma20: number | null;
  ma20DiffPct: number | null;
  status: string;
} {
  if (!priceChart?.volume?.length || !priceChart.candles.length) {
    return { latest: null, ma20: null, ma20DiffPct: null, status: '無資料' };
  }
  const latestTime = priceChart.candles[priceChart.candles.length - 1].time;
  const volumePoint = priceChart.volume.find((item) => item.time === latestTime);
  const latest = volumePoint && Number.isFinite(volumePoint.value) ? volumePoint.value : null;
  const volumes = priceChart.volume
    .map((item) => item.value)
    .filter((value) => Number.isFinite(value));
  const segment = volumes.slice(-20);
  const ma20 = segment.length
    ? segment.reduce((acc, curr) => acc + curr, 0) / segment.length
    : null;
  const ma20DiffPct =
    latest !== null && ma20 !== null && ma20 > 0 ? ((latest - ma20) / ma20) * 100 : null;
  let status = '無資料';
  if (ma20DiffPct !== null) {
    if (Math.abs(ma20DiffPct) <= 5) status = '接近均量';
    else status = ma20DiffPct >= 0 ? '量增' : '量縮';
  }
  return { latest, ma20, ma20DiffPct, status };
}

/** 量能是否確認：充足／不足／中性／無資料 */
export function getVolumeConfirmLabel(status: string): string {
  if (status === '量增') return '充足';
  if (status === '量縮') return '不足';
  if (status === '接近均量') return '中性';
  return '無資料';
}
