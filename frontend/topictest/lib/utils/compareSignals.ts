import type { TechnicalIndicatorDayRow } from '../types/stockDashboard';
import type { ValueTone } from './valueToneClass';

export interface Signal {
  label: string;
  tone: ValueTone;
  /** 對應原始數值；缺資料時為 null */
  value: number | null;
}

export function rsiSignal(rsi: number | null | undefined): Signal {
  const v = rsi == null || !Number.isFinite(rsi) ? null : Number(rsi);
  if (v == null) return { label: 'RSI 無資料', tone: 'neutral', value: null };
  if (v >= 70) return { label: 'RSI 超買', tone: 'up', value: v };
  if (v <= 30) return { label: 'RSI 超賣', tone: 'down', value: v };
  return { label: 'RSI 中性', tone: 'neutral', value: v };
}

export function macdSignal(hist: number | null | undefined): Signal {
  const v = hist == null || !Number.isFinite(hist) ? null : Number(hist);
  if (v == null) return { label: 'MACD 無資料', tone: 'neutral', value: null };
  if (v > 0) return { label: 'MACD 多方', tone: 'up', value: v };
  if (v < 0) return { label: 'MACD 空方', tone: 'down', value: v };
  return { label: 'MACD 平淡', tone: 'neutral', value: v };
}

export function kdSignal(
  k: number | null | undefined,
  d: number | null | undefined,
): Signal {
  const kv = k == null || !Number.isFinite(k) ? null : Number(k);
  const dv = d == null || !Number.isFinite(d) ? null : Number(d);
  if (kv == null || dv == null) {
    return { label: 'KD 無資料', tone: 'neutral', value: null };
  }
  if (kv > dv) return { label: 'KD 黃金交叉', tone: 'up', value: kv - dv };
  if (kv < dv) return { label: 'KD 死亡交叉', tone: 'down', value: kv - dv };
  return { label: 'KD 黏合', tone: 'neutral', value: 0 };
}

/** close 對 MA 的相對位置：站上紅、跌破綠 */
export function maPositionSignal(
  close: number | null | undefined,
  ma: number | null | undefined,
  periodLabel: string,
): Signal {
  const cv = close == null || !Number.isFinite(close) ? null : Number(close);
  const mv = ma == null || !Number.isFinite(ma) ? null : Number(ma);
  if (cv == null || mv == null) {
    return { label: `${periodLabel} 無資料`, tone: 'neutral', value: null };
  }
  const diffPct = ((cv - mv) / mv) * 100;
  if (cv > mv) return { label: `站上 ${periodLabel}`, tone: 'up', value: diffPct };
  if (cv < mv) return { label: `跌破 ${periodLabel}`, tone: 'down', value: diffPct };
  return { label: `貼齊 ${periodLabel}`, tone: 'neutral', value: 0 };
}

type Direction = 'up' | 'down' | 'flat' | 'na';

export interface MomentumBreakdown {
  rsi: { value: number | null; zone: 'overbought' | 'oversold' | 'neutral' | 'na' };
  macd: { value: number | null; direction: Direction };
  trend: { ma20: number | null; ma60: number | null; direction: Direction };
  /** 至少一項有資料才回傳，否則 null */
  hasAny: boolean;
}

/** 拆解 RSI / MACD / 均線方向三項訊號，用於 KPI reason 文案的輔助說明。 */
export function momentumBreakdown(row: TechnicalIndicatorDayRow | null): MomentumBreakdown {
  if (!row) {
    return {
      rsi: { value: null, zone: 'na' },
      macd: { value: null, direction: 'na' },
      trend: { ma20: null, ma60: null, direction: 'na' },
      hasAny: false,
    };
  }

  const rsiVal = row.rsi10 != null && Number.isFinite(row.rsi10) ? row.rsi10 : null;
  const macdVal = row.macd_hist != null && Number.isFinite(row.macd_hist) ? row.macd_hist : null;
  const ma20 = row.ma20 != null && Number.isFinite(row.ma20) ? row.ma20 : null;
  const ma60 = row.ma60 != null && Number.isFinite(row.ma60) ? row.ma60 : null;

  const rsiZone: MomentumBreakdown['rsi']['zone'] =
    rsiVal == null ? 'na' : rsiVal >= 70 ? 'overbought' : rsiVal <= 30 ? 'oversold' : 'neutral';

  const macdDir: Direction =
    macdVal == null ? 'na' : macdVal > 0 ? 'up' : macdVal < 0 ? 'down' : 'flat';

  const trendDir: Direction =
    ma20 == null || ma60 == null
      ? 'na'
      : ma20 > ma60 ? 'up' : ma20 < ma60 ? 'down' : 'flat';

  return {
    rsi: { value: rsiVal, zone: rsiZone },
    macd: { value: macdVal, direction: macdDir },
    trend: { ma20, ma60, direction: trendDir },
    hasAny: rsiVal != null || macdVal != null || (ma20 != null && ma60 != null),
  };
}

/** 把 Direction 轉成單字中文，供 reason 文案組裝。 */
export function directionLabel(direction: Direction): string {
  switch (direction) {
    case 'up':
      return '偏多';
    case 'down':
      return '偏空';
    case 'flat':
      return '持平';
    default:
      return '無資料';
  }
}

/** 均線乖離率 = (MA20 − MA60) / MA60 × 100。正值代表短均在中均之上（趨勢偏多）。缺值回傳 null。 */
export function maTrendSpreadPct(row: TechnicalIndicatorDayRow | null): number | null {
  if (!row) return null;
  const ma20 = row.ma20;
  const ma60 = row.ma60;
  if (
    ma20 == null ||
    ma60 == null ||
    !Number.isFinite(ma20) ||
    !Number.isFinite(ma60) ||
    ma60 === 0
  ) {
    return null;
  }
  return ((ma20 - ma60) / ma60) * 100;
}
