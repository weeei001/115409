import React, { useEffect, useRef } from 'react';
import { echarts, type EChartsOption } from '@/lib/charts/echarts';
import { useTheme } from '@/lib/theme/ThemeContext';

interface Props {
  /** 同時當作 aria-label */
  title: string;
  option: EChartsOption;
  /** 數字為 px；要隨斷點變高度時傳 '100%' 並由外層容器決定高度 */
  height?: number | string;
  className?: string;
}

/**
 * 所有 ECharts 圖都經過這裡，不要在元件裡自己 echarts.init。
 * 主題切換時整個重建；setOption 一律 notMerge 且不用 lazyUpdate
 * （延遲到下一幀時滑鼠觸發 tooltip 會讀到尚未建立資料的 series 而拋錯）。
 */
export function EChart({ title, option, height = 300, className }: Props) {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const optionRef = useRef(option);
  optionRef.current = option;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: 'canvas' });
    chart.setOption({ animation: false, ...optionRef.current }, { notMerge: true });
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);
    chartRef.current = chart;
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, [theme]);

  useEffect(() => {
    chartRef.current?.setOption({ animation: false, ...option }, { notMerge: true });
  }, [option]);

  return <div ref={containerRef} role="img" aria-label={title} className={className} style={{ width: '100%', height }} />;
}
