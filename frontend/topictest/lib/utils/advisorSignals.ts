import type { PriceChartData } from '../types/priceChart';

export type RelativePosition = 'above' | 'below' | 'equal' | 'unknown';

export interface PricePositionSummary {
  close: number | null;
  ma20: number | null;
  ma60: number | null;
  relativeToMA20: RelativePosition;
  relativeToMA60: RelativePosition;
}

export interface AdvisorFetchProgress {
  pendingInstitutional: boolean;
  pendingFinal: boolean;
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
