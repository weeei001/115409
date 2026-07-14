import type { EChartsOption } from 'echarts';
import type {
  ProjectionDirection,
  StockBehaviorAiProjection,
  StockBehaviorAiProjectionPoint,
} from '../types/stockBehavior';
import { getChartPalette } from '../chartTheme';
import { fmtPercent, fmtVolumeShort } from './format';

function colorForDirection(
  direction: ProjectionDirection | undefined,
  palette: ReturnType<typeof getChartPalette>
): string {
  if (direction === 'up') return palette.up;
  if (direction === 'down') return palette.down;
  return palette.tickMuted;
}

function directionLabel(direction: ProjectionDirection | undefined): string {
  if (direction === 'up') return '偏多';
  if (direction === 'down') return '偏空';
  if (direction === 'neutral') return '中性';
  return '不確定';
}

export function projectionToLineOption(
  projection: StockBehaviorAiProjection | undefined,
  isDark: boolean
): EChartsOption | null {
  const points = projection?.points ?? [];
  if (!points.length) return null;
  const hasCloseSeries = points.some(
    (p) => p.predicted_close != null && Number.isFinite(Number(p.predicted_close))
  );
  if (!hasCloseSeries) return null;

  const palette = getChartPalette(isDark);
  const base = projection?.base_close ?? null;

  const dates = points.map((p) => `D+${p.day}`);
  const seriesData = points.map((p): { value: number | null; itemStyle: { color: string } } => ({
    value:
      p.predicted_close != null && Number.isFinite(Number(p.predicted_close))
        ? Number(p.predicted_close)
        : null,
    itemStyle: { color: colorForDirection(p.direction, palette) },
  }));

  return {
    animation: false,
    grid: { left: 44, right: 16, top: 18, bottom: 28 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: palette.tooltipBg,
      borderColor: palette.grid,
      textStyle: { color: palette.tooltipText, fontSize: 12 },
      formatter: (params: unknown) => {
        const items = params as Array<{ axisValue: string; dataIndex: number }>;
        if (!items?.length) return '';
        const idx = items[0].dataIndex;
        const p: StockBehaviorAiProjectionPoint | undefined = points[idx];
        if (!p) return '';
        const close = p.predicted_close != null ? Number(p.predicted_close) : null;
        const deltaPct =
          close != null && base != null && Number.isFinite(base) && base !== 0
            ? ((close - base) / base) * 100
            : null;
        const closeLine =
          close != null
            ? `預測收盤：<b>${close.toFixed(2)}</b>${
                deltaPct != null ? `（${fmtPercent(deltaPct, { sign: true })}）` : ''
              }`
            : '預測收盤：--';
        const volLine =
          p.predicted_volume != null && Number.isFinite(Number(p.predicted_volume))
            ? `預測量：${fmtVolumeShort(Number(p.predicted_volume))}`
            : null;
        const dirLine = `方向：${directionLabel(p.direction)}`;
        const reasonLine = p.reason?.trim()
          ? `<div style="margin-top:4px;max-width:240px;white-space:normal;line-height:1.5;color:${palette.tickMuted};">${p.reason.trim()}</div>`
          : '';
        return [
          `<b>D+${p.day}</b>`,
          closeLine,
          volLine,
          dirLine,
        ]
          .filter(Boolean)
          .join('<br/>') + reasonLine;
      },
    },
    xAxis: {
      type: 'category',
      data: dates,
      axisLabel: { color: palette.tickMuted, fontSize: 10 },
      axisLine: { lineStyle: { color: palette.grid } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: {
        color: palette.tickMuted,
        fontSize: 10,
        formatter: (value: number) => (Number.isFinite(value) ? value.toFixed(0) : ''),
      },
      splitLine: { lineStyle: { color: palette.gridSubtle } },
    },
    series: [
      {
        name: '預測收盤',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 8,
        connectNulls: true,
        lineStyle: { width: 2, color: palette.brand },
        data: seriesData,
        markLine:
          base != null && Number.isFinite(base)
            ? {
                symbol: 'none',
                silent: true,
                lineStyle: { color: palette.referenceLine, type: 'dashed', width: 1 },
                label: {
                  formatter: `基準 ${base.toFixed(2)}`,
                  color: palette.tickMuted,
                  fontSize: 10,
                  position: 'insideEndTop',
                },
                data: [{ yAxis: base }],
              }
            : undefined,
      },
    ],
  };
}

export function projectionDirectionLabel(direction: ProjectionDirection | undefined): string {
  return directionLabel(direction);
}
