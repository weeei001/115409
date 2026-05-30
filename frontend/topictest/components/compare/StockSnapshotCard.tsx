import React, { useMemo } from 'react';
import type { CompareMetricsRow, MultiStockResponse } from '../../lib/types';
import { fmtPercent } from '../../lib/utils/format';
import { getToneTextClass, getValueTone } from '../../lib/utils/valueToneClass';
import { StockSparkline, type SparklineTrend } from '../StockSparkline';

const SPARKLINE_POINTS = 30;

interface Props {
  symbol: string;
  color: string;
  multiStockData: MultiStockResponse | null;
  metricsRow: CompareMetricsRow | undefined;
}

function extractRecentCloses(data: MultiStockResponse | null, symbol: string): number[] {
  if (!data) return [];
  const all: number[] = [];
  for (const row of data.data) {
    const v = row.prices[symbol];
    if (typeof v === 'number' && Number.isFinite(v)) all.push(v);
  }
  return all.slice(-SPARKLINE_POINTS);
}

function trendFromTone(value: number | null | undefined): SparklineTrend {
  if (value == null || !Number.isFinite(value)) return 'flat';
  if (value > 0) return 'up';
  if (value < 0) return 'down';
  return 'flat';
}

export const StockSnapshotCard: React.FC<Props> = ({
  symbol,
  color,
  multiStockData,
  metricsRow,
}) => {
  const closes = useMemo(
    () => extractRecentCloses(multiStockData, symbol),
    [multiStockData, symbol],
  );
  const returnPct = metricsRow?.totalReturnPct ?? null;
  const returnTone = getValueTone(returnPct);
  const trend = trendFromTone(returnPct);

  return (
    <article
      className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] shadow-[var(--shadow-card)] p-4 sm:p-5 flex flex-col gap-3 h-full min-h-[180px]"
      aria-label={`${symbol} 比較快照`}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: color }}
            aria-hidden
          />
          <h3 className="text-sm font-mono font-semibold tabular-nums text-[var(--color-text-primary)] truncate">
            {symbol}
          </h3>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-[var(--color-text-muted)] leading-tight">期間漲跌</p>
          <p
            className={`text-xl font-mono font-bold tabular-nums leading-tight ${getToneTextClass(returnTone)}`}
          >
            {fmtPercent(returnPct, { sign: true })}
          </p>
        </div>
      </header>

      <div className="min-h-[60px] flex-1">
        {closes.length >= 2 ? (
          <StockSparkline values={closes} trend={trend} />
        ) : (
          <p className="text-[11px] text-[var(--color-text-muted)] text-center py-2">
            走勢資料不足
          </p>
        )}
      </div>
    </article>
  );
};
