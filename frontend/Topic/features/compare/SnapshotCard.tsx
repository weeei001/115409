import React, { useMemo } from 'react';
import { Sparkline } from '@/components/common/Sparkline';
import type { MultiStockResponse, StockInfo } from '@/lib/types/api';
import { recentCloses } from '@/lib/utils/compare';
import { fmtPercent } from '@/lib/utils/format';
import { getValueTone, valueToneText } from '@/lib/utils/tone';
import { cn } from '@/lib/cn';

interface Props {
  symbol: string;
  color: string;
  stockInfos: Record<string, StockInfo>;
  data: MultiStockResponse;
  /** Closing-price change over the shared analysis window. */
  returnPct: number | null;
}

/** Company context, price change, and recent closes. */
export function SnapshotCard({ symbol, color, stockInfos, data, returnPct }: Props) {
  const closes = useMemo(() => recentCloses(data, symbol), [data, symbol]);
  const tone = getValueTone(returnPct);
  return (
    <article aria-label={`${symbol} 比較快照`} className="flex h-full min-h-[180px] flex-col gap-3 rounded-2xl border bg-card p-4 shadow-card sm:p-5">
      <header className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold tabular-nums">{symbol} {stockInfos[symbol]?.name?.trim() || ''}</h3>
            <p className="text-[11px] text-muted-foreground">{stockInfos[symbol]?.industry?.trim() || '產業未提供'}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[10px] leading-tight text-muted-foreground">期間價格漲跌</p>
          <p className={cn('font-mono text-xl leading-tight font-bold tabular-nums', valueToneText(returnPct))}>{fmtPercent(returnPct, { sign: true })}</p>
        </div>
      </header>
      <div className="min-h-[60px] flex-1">
        {closes.length >= 2 ? (
          <Sparkline values={closes} trend={tone === 'neutral' ? 'flat' : tone} className="h-[60px]" />
        ) : (
          <p className="py-2 text-center text-[11px] text-muted-foreground">走勢資料不足或有缺值，請查看主圖斷點。</p>
        )}
      </div>
    </article>
  );
}
