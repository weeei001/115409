import { useCallback, useRef } from 'react';
import type { echarts } from '@/lib/charts/echarts';
import { echartsImage } from '@/lib/export/chartImage';
import type { ExportMeta } from '@/lib/export/csv';
import { useTheme } from '@/lib/theme/ThemeContext';

/**
 * 把「存成圖片」鈕放在圖表外面（例如和「匯出 CSV」並排）時用：
 * onRendered 交給 EChart 記住最近一次畫好的圖，capture 交給 ImageExportButton。
 */
export function useChartImage(meta: ExportMeta) {
  const chartRef = useRef<echarts.ECharts | null>(null);
  const { theme } = useTheme();
  const onRendered = useCallback((chart: echarts.ECharts) => {
    chartRef.current = chart;
  }, []);
  const capture = async () => {
    const chart = chartRef.current;
    return chart && !chart.isDisposed() ? echartsImage(chart, meta, theme === 'dark') : null;
  };
  return { onRendered, capture };
}
