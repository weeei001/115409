import React from 'react';
import { RefreshCw, CalendarRange } from 'lucide-react';

interface Props {
  title: string;
  message?: string;
  onRetry?: () => void;
  onWidenRange?: () => void;
}

export const IndicatorChartEmptyState: React.FC<Props> = ({
  title,
  message = '此指標在目前區間無有效數值（其他指標可能有資料）。請拉長日期或重新載入。',
  onRetry,
  onWidenRange,
}) => (
  <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-3">
    <div className="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">{title}</div>
    <div className="flex h-[240px] flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-sm text-[var(--color-text-muted)]">{message}</p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {onWidenRange ? (
          <button
            type="button"
            onClick={onWidenRange}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)] hover:border-brand/35 hover:text-brand"
          >
            <CalendarRange size={14} aria-hidden />
            拉長日期區間
          </button>
        ) : null}
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-xs font-medium text-brand hover:bg-brand/10"
          >
            <RefreshCw size={14} aria-hidden />
            重新載入
          </button>
        ) : null}
      </div>
    </div>
  </div>
);
