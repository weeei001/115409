import React, { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import { CandlestickChart } from 'lucide-react';
import type { PriceChartData } from '../../../lib/types/priceChart';
import { EChartPanel } from '../../charts/EChartPanel';
import { useTheme } from '../../../lib/ThemeContext';
import { getChartPalette, getEChartsBaseOption } from '../../../lib/chartTheme';
import { BentoActionButton } from './BentoActionButton';

interface Props {
  priceChart: PriceChartData | null;
  onOpenDetail: () => void;
}

const RECENT_CANDLES = 30;

export const MiniPriceCard: React.FC<Props> = ({ priceChart, onOpenDetail }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const { option, rangeChangePct, rangeChangeTone } = useMemo(() => {
    if (!priceChart?.candles?.length) {
      return { option: null, rangeChangePct: null as number | null, rangeChangeTone: 'neutral' as const };
    }
    const palette = getChartPalette(isDark);
    const candles = priceChart.candles.slice(-RECENT_CANDLES);
    const first = candles[0]?.close ?? 0;
    const last = candles[candles.length - 1]?.close ?? 0;
    const pct = first !== 0 ? ((last - first) / first) * 100 : 0;
    const tone = pct > 0 ? 'up' : pct < 0 ? 'down' : 'neutral';

    const closeSeries = candles.map((c) => c.close);
    const dates = candles.map((c) => c.time);

    const base = getEChartsBaseOption(isDark);
    const opt: EChartsOption = {
      ...base,
      grid: { left: 8, right: 8, top: 8, bottom: 16, containLabel: false },
      xAxis: {
        type: 'category',
        data: dates,
        show: false,
        boundaryGap: false,
      },
      yAxis: {
        type: 'value',
        scale: true,
        show: false,
        splitLine: { show: false },
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: isDark ? '#1C1C1F' : '#FFFFFF',
        borderColor: palette.tickMuted,
        textStyle: { color: isDark ? '#E8E6E3' : '#1A1A1A', fontSize: 12 },
        formatter: (params) => {
          const arr = Array.isArray(params) ? params : [params];
          const p = arr[0] as { axisValue?: string; data?: number } | undefined;
          if (!p) return '';
          const close = typeof p.data === 'number' ? p.data.toFixed(2) : '';
          return `${p.axisValue ?? ''}<br/>收盤 ${close}`;
        },
      },
      series: [
        {
          type: 'line',
          data: closeSeries,
          showSymbol: false,
          smooth: true,
          lineStyle: {
            width: 2,
            color: tone === 'up' ? palette.up : tone === 'down' ? palette.down : palette.tickMuted,
          },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                {
                  offset: 0,
                  color:
                    tone === 'up'
                      ? 'rgba(208,101,101,0.30)'
                      : tone === 'down'
                        ? 'rgba(100,154,126,0.30)'
                        : 'rgba(128,128,128,0.20)',
                },
                { offset: 1, color: 'rgba(0,0,0,0)' },
              ],
            },
          },
        },
      ],
    };
    return { option: opt, rangeChangePct: pct, rangeChangeTone: tone };
  }, [priceChart, isDark]);

  const toneClass =
    rangeChangeTone === 'up' ? 'text-up' : rangeChangeTone === 'down' ? 'text-down' : 'text-[var(--color-text-secondary)]';

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] shadow-[var(--shadow-card)] p-4 sm:p-5 flex flex-col gap-3 h-full min-h-[260px]">
      <div className="flex items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-text-primary)]">
          <CandlestickChart size={16} className="text-brand" aria-hidden />
          價量走勢
        </h3>
        {rangeChangePct != null ? (
          <span className={`text-sm font-mono font-semibold tabular-nums ${toneClass}`}>
            {rangeChangePct > 0 ? '+' : ''}
            {rangeChangePct.toFixed(2)}%
          </span>
        ) : null}
      </div>
      <p className="text-[11px] text-[var(--color-text-muted)]">
        近 {Math.min(priceChart?.candles?.length ?? 0, RECENT_CANDLES)} 個交易日收盤
      </p>
      <div className="flex-1 min-h-[140px]">
        {option ? (
          <EChartPanel title="近期收盤走勢" option={option} height={140} bare />
        ) : (
          <p className="text-sm text-[var(--color-text-muted)] py-8 text-center">尚無 K 線資料</p>
        )}
      </div>
      <BentoActionButton label="詳細 K 線與量能" onClick={onOpenDetail} />
    </div>
  );
};
