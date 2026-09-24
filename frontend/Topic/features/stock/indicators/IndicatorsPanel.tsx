import React, { useMemo } from 'react';
import { CalendarRange, RefreshCw } from 'lucide-react';
import type { EChartsOption } from '@/lib/charts/echarts';
import type { TechnicalDay } from '@/lib/types/view';
import { bollOption, kdOption, rsiMacdOptions } from '@/lib/charts/adapters';
import { kdSignal, macdSignal, rsiSignal, signalBadgeClass, type SignalTone } from '@/lib/utils/indicatorSignals';
import { useTheme } from '@/lib/theme/ThemeContext';
import { EChart } from '@/components/charts/EChart';
import { cn } from '@/lib/cn';

interface Actions {
  onRetry: () => void;
  onWidenRange: () => void;
}

function EmptyIndicator({ title, message, onRetry, onWidenRange }: { title: string; message?: string } & Actions) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="mb-2 text-sm font-semibold">{title}</p>
      <div className="flex h-[240px] flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-sm text-muted-foreground">{message ?? '此指標在目前區間無有效數值（其他指標可能有資料）。請拉長日期或重新載入。'}</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={onWidenRange}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium text-subtle hover:border-border-strong hover:text-brand-text"
          >
            <CalendarRange size={14} aria-hidden />
            拉長日期區間
          </button>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-brand/30 bg-accent px-3 py-2 text-xs font-medium text-accent-foreground"
          >
            <RefreshCw size={14} aria-hidden />
            重新載入
          </button>
        </div>
      </div>
    </div>
  );
}

function IndicatorCard({ title, option, badge, badgeLabel, badgeTone = 'neutral', ...actions }: {
  title: string;
  option: EChartsOption | null;
  badge?: string;
  badgeLabel?: string;
  badgeTone?: SignalTone;
} & Actions) {
  if (!option) return <EmptyIndicator title={title} {...actions} />;
  return (
    <div className="rounded-xl border bg-card p-3 shadow-card sm:p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {badge ? (
          <span className={cn('inline-flex items-baseline gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium tabular-nums', signalBadgeClass(badgeTone, true))}>
            {badgeLabel ? <span className="text-[11px] opacity-80">{badgeLabel}</span> : null}
            <span className="font-mono font-semibold">{badge}</span>
          </span>
        ) : null}
      </div>
      <EChart title={title} option={option} height={220} />
    </div>
  );
}

/** 「技術指標詳細」抽屜：RSI／MACD／KD／布林通道 */
export function IndicatorsPanel({ rows, loading, onRetry, onWidenRange }: { rows: TechnicalDay[] | null; loading: boolean } & Actions) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const charts = useMemo(() => {
    if (!rows?.length) return null;
    const rsiMacd = rsiMacdOptions(rows, isDark);
    const kd = kdOption(rows, isDark);
    const boll = bollOption(rows, isDark);
    return { ...rsiMacd, kd, boll, hasAny: Boolean(rsiMacd.rsiOption || rsiMacd.macdOption || kd || boll), latest: rows[rows.length - 1] };
  }, [rows, isDark]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[280px] animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    );
  }

  const actions = { onRetry, onWidenRange };
  if (!charts?.hasAny) return <EmptyIndicator title="技術指標" message="尚無技術指標資料，請調整日期區間或稍後重試。" {...actions} />;

  const { latest } = charts;
  const rsi = rsiSignal(latest.rsi10);
  const macd = macdSignal(latest.macd_hist);
  const kd = kdSignal(latest.kd_k9, latest.kd_d9);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <IndicatorCard
        title="RSI"
        option={charts.rsiOption}
        badgeLabel="RSI10"
        badge={rsi.value != null ? `${rsi.value.toFixed(1)}・${rsi.label}` : undefined}
        badgeTone={rsi.tone}
        {...actions}
      />
      <IndicatorCard
        title="MACD"
        option={charts.macdOption}
        badgeLabel="Hist"
        badge={macd.value != null ? macd.value.toFixed(3) : undefined}
        badgeTone={macd.tone}
        {...actions}
      />
      <IndicatorCard
        title="KD"
        option={charts.kd}
        badge={latest.kd_k9 != null && latest.kd_d9 != null ? `K ${latest.kd_k9.toFixed(1)} / D ${latest.kd_d9.toFixed(1)}` : undefined}
        badgeTone={kd.tone}
        {...actions}
      />
      <IndicatorCard
        title="布林通道 (20)"
        option={charts.boll}
        badge={latest.boll_mid20 != null && latest.boll_upper20 != null && latest.boll_lower20 != null ? `中 ${latest.boll_mid20.toFixed(1)}` : undefined}
        {...actions}
      />
    </div>
  );
}
