import { useEffect, useRef } from 'react';
import { LabelLayout } from 'echarts/features';
import { echarts, type EChartsOption } from '@/lib/charts/echarts';
import { CHART_SANS } from '@/lib/charts/adapters';
import { echartsImage } from '@/lib/export/chartImage';
import type { ExportMeta } from '@/lib/export/csv';
import { useTheme } from '@/lib/theme/ThemeContext';
import { ImageExportButton } from '@/components/common/ExportButtons';

// 散點標籤的 labelLayout（moveOverlap／hideOverlap）需要這個 feature；其餘模組在 lib/charts/echarts.ts 註冊
echarts.use([LabelLayout]);

interface Props {
  /** 同時當作 aria-label */
  title: string;
  option: EChartsOption;
  /** 數字為 px；要隨斷點變高度時傳 '100%' 並由外層容器決定高度 */
  height?: number | string;
  className?: string;
  /**
   * 每次繪製完成（設定資料、改變尺寸、重建主題）後呼叫，讓外層用 convertToPixel 量座標
   * （例如主圖圖廓邊緣的水深字）。只讀不寫，不要在這裡 setOption。
   */
  onRendered?: (chart: echarts.ECharts) => void;
  /** 給了就在圖上方放「存成圖片」（專業版工具）；圖片會附標題、資料期間與來源 */
  exportImage?: ExportMeta & { fileName: string };
}

/** 每張圖的共同底：關動畫、介面字用 Noto Sans TC（刻度與數字的等寬字由 adapters 的共用軸設定） */
const withDefaults = (option: EChartsOption): EChartsOption => ({
  animation: false,
  ...option,
  textStyle: { fontFamily: CHART_SANS, ...(option.textStyle as object | undefined) },
});

/**
 * 所有 ECharts 圖都經過這裡，不要在元件裡自己 echarts.init。
 * 主題切換時整個重建；setOption 一律 notMerge 且不用 lazyUpdate
 * （延遲到下一幀時滑鼠觸發 tooltip 會讀到尚未建立資料的 series 而拋錯）。
 */
export function EChart({ title, option, height = 300, className, onRendered, exportImage }: Props) {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const optionRef = useRef(option);
  optionRef.current = option;
  const renderedRef = useRef(onRendered);
  renderedRef.current = onRendered;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: 'canvas' });
    chart.on('finished', () => renderedRef.current?.(chart));
    chart.setOption(withDefaults(optionRef.current), { notMerge: true });
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
    chartRef.current?.setOption(withDefaults(option), { notMerge: true });
  }, [option]);

  const plot = <div ref={containerRef} role="img" aria-label={title} className={className} style={{ width: '100%', height }} />;
  if (!exportImage) return plot;

  const isDark = theme === 'dark';
  const capture = async () => (chartRef.current ? echartsImage(chartRef.current, exportImage, isDark) : null);
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <ImageExportButton capture={capture} fileName={exportImage.fileName} />
      </div>
      {plot}
    </div>
  );
}
