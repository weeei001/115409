import type { TechnicalDay } from '../types/view';
import { rsiZone, type Signal } from './indicatorSignals';

/**
 * 多股比較「技術指標快照」的判讀標籤。
 * RSI 超買／超賣用 warning（決議 D8-c8）；K 與 D 的相對位置是狀態、不是交叉事件（決議 D9-c24）。
 */

const finite = (v: number | null | undefined): number | null => (v == null || !Number.isFinite(v) ? null : v);

export function rsiSignal(rsi: number | null | undefined): Signal {
  const value = finite(rsi);
  const zone = rsiZone(value);
  if (zone === 'na') return { label: 'RSI 無資料', tone: 'neutral', value };
  if (zone === 'overbought') return { label: 'RSI 超買', tone: 'warning', value };
  if (zone === 'oversold') return { label: 'RSI 超賣', tone: 'warning', value };
  return { label: 'RSI 中性', tone: 'neutral', value };
}

export function macdSignal(hist: number | null | undefined): Signal {
  const value = finite(hist);
  if (value == null) return { label: 'MACD 無資料', tone: 'neutral', value };
  if (value > 0) return { label: 'MACD 多方', tone: 'up', value };
  if (value < 0) return { label: 'MACD 空方', tone: 'down', value };
  return { label: 'MACD 平淡', tone: 'neutral', value };
}

export function kdSignal(k: number | null | undefined, d: number | null | undefined): Signal {
  const kv = finite(k);
  const dv = finite(d);
  if (kv == null || dv == null) return { label: 'KD 無資料', tone: 'neutral', value: null };
  if (kv > dv) return { label: 'K 在 D 之上', tone: 'up', value: kv - dv };
  if (kv < dv) return { label: 'K 在 D 之下', tone: 'down', value: kv - dv };
  return { label: 'K、D 黏合', tone: 'neutral', value: 0 };
}

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
  rsi: { value: number | null; zone: 'overbought' | 'oversold' | 'neutral' | 'na' };
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
  if (direction === 'flat') return '持平';
  return '無資料';
}

/** 均線乖離率 = (MA20 − MA60) / MA60 × 100；正值代表短均在中均之上。缺值回傳 null */
export function maTrendSpreadPct(row: TechnicalDay | null): number | null {
  const ma20 = finite(row?.ma20);
  const ma60 = finite(row?.ma60);
  if (ma20 == null || ma60 == null || ma60 === 0) return null;
  return ((ma20 - ma60) / ma60) * 100;
}
