import React, { useMemo } from 'react';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import type { DailyQuote, PriceChartData } from '@/lib/types/view';
import { fmtPercent, fmtPrice, fmtSigned } from '@/lib/utils/format';
import { getValueTone, toneText } from '@/lib/utils/tone';
import { Sparkline, type SparklineTrend } from '@/components/common/Sparkline';
import { cn } from '@/lib/cn';

const SPARKLINE_POINTS = 60;

interface Props {
  symbol: string;
  /** 查不到中文名為 null，只顯示代號 */
  stockName: string | null;
  latest: DailyQuote;
  priceChart: PriceChartData | null;
}

/** 個股 Hero：收盤價、漲跌、近 60 日收盤走勢、昨收／開高低 */
export function StockHero({ symbol, stockName, latest, priceChart }: Props) {
  const close = latest.close ?? 0;
  const change = latest.change ?? 0;
  const prevClose = close - change;
  const changePct = prevClose > 0 ? (change / prevClose) * 100 : null;
  const tone = getValueTone(latest.change);
  const TrendIcon = tone === 'up' ? TrendingUp : tone === 'down' ? TrendingDown : Minus;

  const spark = useMemo(
    () => (priceChart?.candles ?? []).slice(-SPARKLINE_POINTS).map((c) => c.close).filter((v) => Number.isFinite(v)),
    [priceChart],
  );
  const sparkTrend: SparklineTrend =
    spark.length < 2 ? 'flat' : spark[spark.length - 1] > spark[0] ? 'up' : spark[spark.length - 1] < spark[0] ? 'down' : 'flat';

  const metrics = [
    { label: '昨收', value: prevClose > 0 ? fmtPrice(prevClose) : '--' },
    { label: '開盤', value: fmtPrice(latest.open) },
    { label: '最高', value: fmtPrice(latest.high) },
    { label: '最低', value: fmtPrice(latest.low) },
  ];

  return (
    <section data-stagger className="flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-card sm:p-5" aria-label="即時報價">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xl font-bold sm:text-2xl">
            <span className="font-mono tabular-nums">{symbol}</span>
            {stockName ? <span className="text-sm font-medium text-subtle sm:text-base">{stockName}</span> : null}
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">收盤日 {latest.date}</p>
        </div>
        <div className="sm:text-right">
          <p className="text-[11px] text-muted-foreground">收盤價</p>
          <p className="font-mono text-3xl leading-none font-bold tabular-nums sm:text-4xl">{fmtPrice(latest.close)}</p>
          <p className={cn('mt-1.5 inline-flex items-center gap-1 font-mono text-sm font-medium tabular-nums', toneText(tone))}>
            <TrendIcon size={14} aria-hidden />
            <span>{fmtSigned(latest.change)}</span>
            <span>({fmtPercent(changePct, { sign: true })})</span>
          </p>
        </div>
      </div>

      {spark.length >= 2 ? (
        <div className="rounded-lg border bg-muted/60 px-3 py-1.5">
          <div className="mb-0.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground tabular-nums">
            <span className="font-medium">近 {spark.length} 日收盤</span>
            <span>
              {spark[0].toFixed(2)} → {spark[spark.length - 1].toFixed(2)}
            </span>
          </div>
          <Sparkline values={spark} trend={sparkTrend} />
        </div>
      ) : null}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-lg border bg-muted px-3 py-3">
            <dt className="mb-1 text-xs text-muted-foreground">{m.label}</dt>
            <dd className="font-mono text-sm font-semibold tabular-nums">{m.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
