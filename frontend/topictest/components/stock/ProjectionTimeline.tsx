import React from 'react';
import { Sparkles } from 'lucide-react';
import { EChartPanel } from '../charts/EChartPanel';
import { useTheme } from '../../lib/ThemeContext';
import type {
  StockBehaviorAiProjection,
  StockBehaviorAiProjectionPoint,
  StockBehaviorDataInventory,
} from '../../lib/types/stockBehavior';
import {
  projectionDirectionLabel,
  projectionToLineOption,
} from '../../lib/utils/projectionChartAdapter';
import { fmtPercent, fmtVolumeShort } from '../../lib/utils/format';
import { getBadgeToneClass, getValueToneClass, getValueTone } from '../../lib/utils/valueToneClass';
import {
  buildEvidenceIndex,
  formatInventoryValueShort,
  inventoryFieldLabel,
} from '../../lib/utils/aiInventoryHelpers';

interface Props {
  projection: StockBehaviorAiProjection;
  variant?: 'page' | 'drawer';
  inventory?: StockBehaviorDataInventory;
  onEvidenceClick?: (evidenceId: string) => void;
}

function pointTone(point: StockBehaviorAiProjectionPoint, baseClose?: number | null) {
  if (point.direction === 'up') return 'up' as const;
  if (point.direction === 'down') return 'down' as const;
  if (
    baseClose != null &&
    Number.isFinite(baseClose) &&
    point.predicted_close != null &&
    Number.isFinite(Number(point.predicted_close))
  ) {
    return getValueTone(Number(point.predicted_close) - baseClose);
  }
  return 'neutral' as const;
}

function deltaPercent(close: number | null | undefined, base: number | null | undefined): number | null {
  if (close == null || base == null || !Number.isFinite(close) || !Number.isFinite(base) || base === 0) {
    return null;
  }
  return ((close - base) / base) * 100;
}

export const ProjectionTimeline: React.FC<Props> = ({
  projection,
  variant = 'page',
  inventory,
  onEvidenceClick,
}) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const points = projection?.points ?? [];
  if (!points.length) return null;

  const horizon = projection.horizon_days ?? points.length;
  const baseClose = projection.base_close ?? null;
  const baseVolume = projection.base_volume ?? null;
  const option = projectionToLineOption(projection, isDark);
  const isDrawer = variant === 'drawer';
  const chartHeight = isDrawer ? 140 : 200;
  const evidenceIndex = React.useMemo(() => buildEvidenceIndex(inventory), [inventory]);
  const gridCols = isDrawer
    ? 'grid-cols-1'
    : points.length >= 5
      ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5'
      : points.length === 4
        ? 'grid-cols-2 sm:grid-cols-2 lg:grid-cols-4'
        : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';

  const containerClass = isDrawer
    ? 'rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 shadow-[var(--shadow-card)]'
    : 'rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/40 p-5';

  return (
    <section aria-label="未來 N 日情境推演" className={containerClass}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-base font-bold text-[var(--color-text-primary)]">
            <Sparkles size={14} className="text-brand" aria-hidden />
            未來 {horizon} 日情境推演
          </h3>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            模型依目前資料推估 D+1 ~ D+{horizon} 的方向、預測收盤與量能。僅供參考，請自行評估風險。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {baseClose != null && Number.isFinite(baseClose) ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2.5 py-1 text-xs text-[var(--color-text-secondary)]">
              <span className="text-[var(--color-text-muted)]">基準收盤</span>
              <span className="font-semibold tabular-nums text-[var(--color-text-primary)]">
                {baseClose.toFixed(2)}
              </span>
            </span>
          ) : null}
          {baseVolume != null && Number.isFinite(Number(baseVolume)) ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2.5 py-1 text-xs text-[var(--color-text-secondary)]">
              <span className="text-[var(--color-text-muted)]">基準量</span>
              <span className="font-semibold tabular-nums text-[var(--color-text-primary)]">
                {fmtVolumeShort(Number(baseVolume))}
              </span>
            </span>
          ) : null}
        </div>
      </div>

      {option ? (
        <div className="mt-3">
          <EChartPanel title="未來情境推演折線" option={option} height={chartHeight} bare />
        </div>
      ) : null}

      <div className={`mt-4 grid gap-3 ${gridCols}`}>
        {points.map((p) => {
          const close = p.predicted_close != null ? Number(p.predicted_close) : null;
          const delta = deltaPercent(close, baseClose);
          const tone = pointTone(p, baseClose);
          const badgeClass = getBadgeToneClass(tone, { emphasis: true });
          const reason = p.reason?.trim() ?? '';
          const relative = p.relative_price != null && Number.isFinite(p.relative_price)
            ? p.relative_price
            : null;
          const evidenceItems = (p.evidence_ids ?? [])
            .map((id) => evidenceIndex.get(id))
            .filter((e): e is NonNullable<ReturnType<typeof evidenceIndex.get>> => Boolean(e))
            // 新聞已搬到「資料來源」區，這裡不再顯示 nw_xx 引用 chip，避免點下去找不到位置
            .filter((e) => e.category !== 'news');

          return (
            <article
              key={`day-${p.day}`}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-3"
            >
              <header className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-flex items-center rounded-md bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand tabular-nums">
                    D+{p.day}
                  </span>
                  {relative != null ? (
                    <span className="text-[10px] text-[var(--color-text-muted)] tabular-nums">
                      ×{relative.toFixed(3)}
                    </span>
                  ) : null}
                </span>
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${badgeClass}`}
                >
                  {projectionDirectionLabel(p.direction)}
                </span>
              </header>

              <div className="mt-2.5 flex items-baseline gap-2">
                <p className="text-lg font-bold tabular-nums text-[var(--color-text-primary)]">
                  {close != null && Number.isFinite(close) ? close.toFixed(2) : '--'}
                </p>
                {delta != null ? (
                  <p className={`text-xs font-medium tabular-nums ${getValueToneClass(delta)}`}>
                    {fmtPercent(delta, { sign: true })}
                  </p>
                ) : null}
              </div>

              <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
                {p.predicted_volume != null && Number.isFinite(Number(p.predicted_volume))
                  ? `預測量 ${fmtVolumeShort(Number(p.predicted_volume))}`
                  : '預測量 --'}
              </p>

              {reason ? (
                <details className="group mt-2">
                  <summary className="cursor-pointer list-none text-xs leading-6 text-[var(--color-text-secondary)] line-clamp-2 group-open:line-clamp-none">
                    {reason}
                  </summary>
                  {evidenceItems.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {evidenceItems.map((ev) => (
                        <button
                          key={ev.id}
                          type="button"
                          onClick={() => onEvidenceClick?.(ev.id)}
                          className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/5 px-2 py-0.5 text-[10px] text-brand hover:bg-brand/10 transition-colors cursor-pointer"
                          title={`引用：${ev.id}`}
                        >
                          <span className="font-mono opacity-70">{ev.id}</span>
                          <span className="text-[var(--color-text-primary)] font-medium">
                            {inventoryFieldLabel(ev.field)}
                          </span>
                          <span className="tabular-nums text-[var(--color-text-secondary)]">
                            {formatInventoryValueShort(ev.category, ev)}
                          </span>
                          {ev.streak_days != null && Number.isFinite(ev.streak_days) ? (
                            <span className="text-brand">連{ev.streak_days}日</span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </details>
              ) : evidenceItems.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {evidenceItems.map((ev) => (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => onEvidenceClick?.(ev.id)}
                      className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/5 px-2 py-0.5 text-[10px] text-brand hover:bg-brand/10 transition-colors cursor-pointer"
                      title={`引用：${ev.id}`}
                    >
                      <span className="font-mono opacity-70">{ev.id}</span>
                      <span className="text-[var(--color-text-primary)] font-medium">
                        {inventoryFieldLabel(ev.field)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
};
