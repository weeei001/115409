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
  if (value > 0) return { label: '多方動能', tone: 'up', value };
  if (value < 0) return { label: '空方動能', tone: 'down', value };
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

export function signalBadgeClass(tone: SignalTone, emphasis = false): string {
  if (tone === 'up') return `border-up/30 bg-up-muted ${emphasis ? 'text-up-emphasis' : 'text-up'}`;
  if (tone === 'down') return `border-down/30 bg-down-muted ${emphasis ? 'text-down-emphasis' : 'text-down'}`;
  if (tone === 'warning') return 'border-warning-border bg-warning-muted text-warning';
  return 'border-border bg-muted text-subtle';
}
