import type { PriceChartData } from '../types/view';

/**
 * 純由價量資料算出來的技術訊號，跟 AI 分析無關。
 * AI 摘要的「技術動能」面向在證據目錄沒有均線數字時，用這裡的均線結構當備援。
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

function latestOverlayValueByTime(points: Array<{ time: string; value: number | null }>, time: string): number | null {
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
  const latestCandle = priceChart?.candles[priceChart.candles.length - 1];
  if (!priceChart || !latestCandle) return empty;
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

/** 均線結構短標籤：偏多／偏空／盤整；MA20 或 MA60 缺值時回「無資料」 */
export function getMaStructureLabel(summary: PricePositionSummary): string {
  if (summary.relativeToMA20 === 'unknown' || summary.relativeToMA60 === 'unknown') return '無資料';
  if (summary.relativeToMA20 === 'above' && summary.relativeToMA60 === 'above') return '偏多';
  if (summary.relativeToMA20 === 'below' && summary.relativeToMA60 === 'below') return '偏空';
  return '盤整';
}
