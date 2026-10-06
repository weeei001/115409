import type { ValueTone } from './tone';

/**
 * 技術指標的判讀標籤。RSI 的超買／超賣不是漲跌方向，用 warning 表示（決議 D8-c8）；
 * MACD 柱與 K／D 相對位置有方向性，才用漲跌色。
 */
export type SignalTone = ValueTone | 'warning';

export interface Signal {
  label: string;
  tone: SignalTone;
  value: number | null;
}

const finite = (v: number | null | undefined): number | null => (v == null || !Number.isFinite(v) ? null : v);

/** 指標名稱帶計算參數（後端 jobs/indicators.py：RSI10、KD 9 日、MACD 12/26/9），各處用同一組字（04-U7） */
export const INDICATOR_LABELS = {
  rsi: 'RSI（10）',
  kd: 'KD（9）',
  macdHist: 'MACD 柱（12, 26, 9）',
} as const;

/** MACD 柱的小數位；RSI、KD 一律 1 位（fmtIndicator） */
export const MACD_DECIMALS = 3;
export const fmtIndicator = (v: number): string => v.toFixed(1);

export type RsiZone = 'overbought' | 'oversold' | 'neutral' | 'na';

export function rsiZone(rsi: number | null | undefined): RsiZone {
  const v = finite(rsi);
  if (v == null) return 'na';
  if (v >= 70) return 'overbought';
  if (v <= 30) return 'oversold';
  return 'neutral';
}

export function rsiSignal(rsi: number | null | undefined): Signal {
  const value = finite(rsi);
  const zone = rsiZone(value);
  if (zone === 'na') return { label: 'RSI 無資料', tone: 'neutral', value };
  if (zone === 'overbought') return { label: '超買', tone: 'warning', value };
  if (zone === 'oversold') return { label: '超賣', tone: 'warning', value };
  return { label: '中性', tone: 'neutral', value };
}

export function macdSignal(hist: number | null | undefined): Signal {
  const value = finite(hist);
  if (value == null) return { label: 'MACD 無資料', tone: 'neutral', value };
  // 判讀標籤全站統一「偏多／偏空／中性」（05 用語表）
  if (value > 0) return { label: '偏多', tone: 'up', value };
  if (value < 0) return { label: '偏空', tone: 'down', value };
  return { label: '中性', tone: 'neutral', value };
}

/** K 與 D 的相對位置（是狀態，不是交叉事件，決議 D9-c24） */
export function kdSignal(k: number | null | undefined, d: number | null | undefined): Signal {
  const kv = finite(k);
  const dv = finite(d);
  if (kv == null || dv == null) return { label: 'KD 無資料', tone: 'neutral', value: null };
  if (kv > dv) return { label: 'K 在 D 之上', tone: 'up', value: kv - dv };
  if (kv < dv) return { label: 'K 在 D 之下', tone: 'down', value: kv - dv };
  return { label: 'K、D 黏合', tone: 'neutral', value: 0 };
}
