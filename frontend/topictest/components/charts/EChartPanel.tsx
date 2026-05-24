import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';
import { useTheme } from '../../lib/ThemeContext';

interface Props {
  title: string;
  option: EChartsOption;
  height?: number;
  /** 隱藏內建標題列 + 卡片外框；由外層容器自行繪製 chrome（如 IndicatorBentoCell） */
  bare?: boolean;
}

export const EChartPanel: React.FC<Props> = ({ title, option, height = 300, bare = false }) => {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = echarts.init(el, undefined, { renderer: 'canvas' });
    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(el);
    chartRef.current = chart;

    return () => {
      resizeObserver.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, [theme]);

  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.setOption(
      { animation: false, ...option },
      { notMerge: true, lazyUpdate: true }
    );
  }, [option]);

  if (bare) {
    return (
      <div ref={containerRef} role="img" aria-label={title || 'chart'} style={{ width: '100%', height }} />
    );
  }

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-3">
      <div className="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">{title}</div>
      <div ref={containerRef} role="img" aria-label={title} style={{ width: '100%', height }} />
    </div>
  );
};
