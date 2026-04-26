import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';

interface Props {
  title: string;
  option: EChartsOption;
  height?: number;
}

export const CoreModeEChartPanel: React.FC<Props> = ({ title, option, height = 300 }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!containerRef.current || chartRef.current) return;

    const chart = echarts.init(containerRef.current, undefined, {
      renderer: 'canvas',
    });

    const resizeObserver = new ResizeObserver(() => {
      chart.resize();
    });
    resizeObserver.observe(containerRef.current);

    chartRef.current = chart;

    return () => {
      resizeObserver.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.setOption(
      {
        animation: false,
        ...option,
      },
      {
        notMerge: true,
        lazyUpdate: true,
      }
    );
  }, [option]);

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-3">
      <div className="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">{title}</div>
      <div ref={containerRef} style={{ width: '100%', height }} />
    </div>
  );
};
