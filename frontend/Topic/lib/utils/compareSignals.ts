import type { TechnicalDay } from '../types/view';
import { finite, rsiSignal as indicatorRsiSignal, rsiZone, type RsiZone, type Signal } from './indicatorSignals';

/**
 * 多股比較「技術指標快照」的判讀標籤。
 * RSI 超買／超賣用 warning（決議 D8-c8）；K 與 D 的相對位置是狀態、不是交叉事件（決議 D9-c24）。
 * MACD、KD 的判讀和個股頁、首頁同一組字（05 用語表、決議 C4／c59），直接沿用 indicatorSignals；RSI 只多冠「RSI 」。
 */

export { kdSignal, macdSignal } from './indicatorSignals';

export const rsiSignal = (rsi: number | null | undefined): Signal => indicatorRsiSignal(rsi, { labelPrefix: 'RSI ' });

/** 收盤相對 MA 的位置；收盤與 MA 取自技術指標同一列（同一天，決議 D9-c24） */
export function maPositionSignal(close: number | null | undefined, ma: number | null | undefined, periodLabel: string): Signal {
  const cv = finite(close);
  const mv = finite(ma);
  if (cv == null || mv == null || mv === 0) return { label: `${periodLabel} 無資料`, tone: 'neutral', value: null };
  const diffPct = ((cv - mv) / mv) * 100;
  if (cv > mv) return { label: `站上 ${periodLabel}`, tone: 'up', value: diffPct };
  if (cv < mv) return { label: `跌破 ${periodLabel}`, tone: 'down', value: diffPct };
  return { label: `貼齊 ${periodLabel}`, tone: 'neutral', value: 0 };
}

type Direction = 'up' | 'down' | 'flat' | 'na';

export interface MomentumBreakdown {
  rsi: { value: number | null; zone: RsiZone };
  macd: { value: number | null; direction: Direction };
}

/** 類別冠軍「均線最偏多」說明文字用的 RSI 區間與 MACD 方向 */
export function momentumBreakdown(row: TechnicalDay | null): MomentumBreakdown {
  const rsi = finite(row?.rsi10);
  const macd = finite(row?.macd_hist);
  return {
    rsi: { value: rsi, zone: rsiZone(rsi) },
    macd: { value: macd, direction: macd == null ? 'na' : macd > 0 ? 'up' : macd < 0 ? 'down' : 'flat' },
  };
}

export function directionLabel(direction: Direction): string {
  if (direction === 'up') return '偏多';
  if (direction === 'down') return '偏空';
  if (direction === 'flat') return '中性';
  return '無資料';
}

/** 均線乖離率 = (MA20 − MA60) / MA60 × 100；正值代表短均在中均之上。缺值回傳 null */
export function maTrendSpreadPct(row: TechnicalDay | null): number | null {
  const ma20 = finite(row?.ma20);
  const ma60 = finite(row?.ma60);
  if (ma20 == null || ma60 == null || ma60 === 0) return null;
  return ((ma20 - ma60) / ma60) * 100;
}
