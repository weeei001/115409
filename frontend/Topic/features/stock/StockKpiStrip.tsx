import React from 'react';
import type { InstitutionalDay, PriceChartData, TechnicalDay } from '@/lib/types/view';
import { fmtInstitutionalShares, fmtPercent } from '@/lib/utils/format';
import { getValueTone, type ValueTone } from '@/lib/utils/tone';
import { rsiZone } from '@/lib/utils/indicatorSignals';
import { cn } from '@/lib/cn';

interface Props {
  priceChart: PriceChartData | null;
  institutionalLatest: InstitutionalDay | null;
  indicatorLatest: TechnicalDay | null;
}

interface Tile {
  label: string;
  value: string;
  /** 只有有正負方向的數值才上漲跌色（決議 D8） */
  tone: ValueTone | 'warning';
  sub?: string;
}

const TONE_CLASS: Record<Tile['tone'], string> = {
  up: 'text-up',
  down: 'text-down',
  neutral: 'text-foreground',
  warning: 'text-warning',
};

function rangeTiles(priceChart: PriceChartData | null): Tile[] {
  const candles = priceChart?.candles ?? [];
  const first = candles[0]?.close;
  const last = candles[candles.length - 1]?.close;
  const pct = candles.length && first ? ((last - first) / first) * 100 : null;
  const highs = candles.map((c) => c.high).filter(Number.isFinite);
  const lows = candles.map((c) => c.low).filter(Number.isFinite);
  return [
    {
      label: '區間漲跌幅',
      value: fmtPercent(pct, { sign: true, fallback: '—' }),
      tone: getValueTone(pct),
      sub: candles.length ? `${candles.length} 個交易日` : undefined,
    },
    { label: '區間最高', value: highs.length ? Math.max(...highs).toFixed(2) : '—', tone: 'neutral' },
    { label: '區間最低', value: lows.length ? Math.min(...lows).toFixed(2) : '—', tone: 'neutral' },
  ];
}

/** 個股關鍵指標 6 格 */
export function StockKpiStrip({ priceChart, institutionalLatest, indicatorLatest }: Props) {
  const rsi = indicatorLatest?.rsi10 ?? null;
  const zone = rsiZone(rsi);
  const macd = indicatorLatest?.macd_hist ?? null;
  const tiles: Tile[] = [
    ...rangeTiles(priceChart),
    {
      label: '法人合計',
      value: fmtInstitutionalShares(institutionalLatest?.total_institutional_net, '—'),
      tone: getValueTone(institutionalLatest?.total_institutional_net),
      sub: institutionalLatest?.date ? `截至 ${institutionalLatest.date}` : undefined,
    },
    {
      label: 'RSI10',
      value: rsi != null ? rsi.toFixed(1) : '—',
      tone: zone === 'overbought' || zone === 'oversold' ? 'warning' : 'neutral',
      sub: '≥70 超買 / ≤30 超賣',
    },
    {
      label: 'MACD 動能',
      value: macd != null ? macd.toFixed(3) : '—',
      tone: getValueTone(macd),
      sub: '正值偏多 / 負值偏空',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-6" aria-label="個股關鍵指標">
      {tiles.map((tile) => (
        <div key={tile.label} data-stagger className="rounded-lg border bg-card px-3 py-2.5 shadow-card">
          <p className="text-[11px] leading-tight text-muted-foreground">{tile.label}</p>
          <p className={cn('mt-1 font-mono text-lg leading-tight font-semibold tabular-nums', TONE_CLASS[tile.tone])}>{tile.value}</p>
          {tile.sub ? <p className="mt-0.5 truncate text-[11px] leading-tight text-muted-foreground tabular-nums">{tile.sub}</p> : null}
        </div>
      ))}
    </div>
  );
}
