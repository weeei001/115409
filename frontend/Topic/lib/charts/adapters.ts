import type { EChartsOption } from './echarts';
import type { ChipsVolumeData } from '../types/api';
import type { InstitutionalDay, PriceChartData, TechnicalDay } from '../types/view';
import type { CompareChartMode } from '../types/compare';
import type { CompareChartSeries } from '../utils/compare';
import { fmtInstitutionalAxisLabel, fmtInstitutionalShares } from '../utils/format';
import { getChartPalette, getInstitutionColors, getMaColors, type ChartPalette } from './theme';

/** 法人與籌碼圖預設只畫最近 30 個交易日 */
const RECENT_DAYS = 30;

function baseAxis(palette: ChartPalette, dates: string[]) {
  return {
    type: 'category' as const,
    data: dates,
    axisLabel: { color: palette.tickMuted, fontSize: 10 },
    axisLine: { lineStyle: { color: palette.grid } },
    axisTick: { show: false },
  };
}

function valueAxis(palette: ChartPalette, extra?: Record<string, unknown>) {
  return {
    type: 'value' as const,
    axisLabel: { color: palette.tickMuted, fontSize: 10 },
    splitLine: { lineStyle: { color: palette.gridSubtle } },
    ...extra,
  };
}

function tooltip(palette: ChartPalette, extra?: Record<string, unknown>) {
  return {
    trigger: 'axis' as const,
    confine: true,
    backgroundColor: palette.tooltipBg,
    borderColor: palette.tooltipBorder,
    textStyle: { color: palette.tooltipText, fontSize: 12 },
    ...extra,
  };
}

const legend = (palette: ChartPalette) => ({ top: 0, textStyle: { color: palette.tick, fontSize: 11 } });

const institutionalAxisLabel = { fontSize: 10, formatter: (value: number) => fmtInstitutionalAxisLabel(Number(value)) };

/** 三大法人每日買賣超：外資／投信／自營堆疊柱（依法人上色）＋合計線 */
export function institutionalFlowOption(rows: InstitutionalDay[] | null, isDark: boolean): EChartsOption | null {
  if (!rows?.length) return null;
  const palette = getChartPalette(isDark);
  const colors = getInstitutionColors(isDark);
  const recent = rows.slice(-RECENT_DAYS);
  const hasBuySell = recent.some((r) => r.foreign_buy != null || r.foreign_sell != null);
  const f = fmtInstitutionalAxisLabel;
  return {
    animation: false,
    grid: { left: 52, right: 16, top: 32, bottom: 28 },
    tooltip: tooltip(palette, {
      formatter: hasBuySell
        ? (params: unknown) => {
            const items = params as Array<{ dataIndex: number }>;
            const row = recent[items?.[0]?.dataIndex ?? -1];
            if (!row) return '';
            return [
              `<b>${row.date}</b>`,
              `外資：買 ${f(row.foreign_buy ?? 0)} / 賣 ${f(row.foreign_sell ?? 0)} / 淨 <b>${f(row.foreign_net ?? 0)}</b>`,
              `投信：買 ${f(row.investment_trust_buy ?? 0)} / 賣 ${f(row.investment_trust_sell ?? 0)} / 淨 <b>${f(row.investment_trust_net ?? 0)}</b>`,
              `自營：買 ${f(row.dealer_buy ?? 0)} / 賣 ${f(row.dealer_sell ?? 0)} / 淨 <b>${f(row.dealer_net ?? 0)}</b>`,
              `合計：<b>${f(row.total_institutional_net ?? 0)}</b>`,
            ].join('<br/>');
          }
        : undefined,
    }),
    legend: legend(palette),
    xAxis: baseAxis(palette, recent.map((r) => r.date)),
    yAxis: valueAxis(palette, { axisLabel: { ...institutionalAxisLabel, color: palette.tickMuted } }),
    series: [
      { name: '外資', type: 'bar', stack: 'inst', data: recent.map((r) => r.foreign_net ?? 0), itemStyle: { color: colors.foreign } },
      { name: '投信', type: 'bar', stack: 'inst', data: recent.map((r) => r.investment_trust_net ?? 0), itemStyle: { color: colors.trust } },
      { name: '自營', type: 'bar', stack: 'inst', data: recent.map((r) => r.dealer_net ?? 0), itemStyle: { color: colors.dealer } },
      {
        name: '合計',
        type: 'line',
        data: recent.map((r) => r.total_institutional_net ?? 0),
        symbol: 'none',
        lineStyle: { width: 2, color: palette.text },
        itemStyle: { color: palette.text },
      },
    ],
  };
}

/** 法人累積買賣超（股） */
export function institutionalCumulativeOption(rows: InstitutionalDay[] | null, isDark: boolean): EChartsOption | null {
  if (!rows?.length) return null;
  const palette = getChartPalette(isDark);
  const recent = rows.slice(-RECENT_DAYS);
  let running = 0;
  const points = recent.map((row) => (running += row.total_institutional_net ?? 0));
  return {
    animation: false,
    grid: { left: 52, right: 16, top: 16, bottom: 28 },
    tooltip: tooltip(palette, { valueFormatter: (v: unknown) => fmtInstitutionalAxisLabel(Number(v)) + ' 股' }),
    xAxis: baseAxis(palette, recent.map((r) => r.date)),
    yAxis: valueAxis(palette, { axisLabel: { ...institutionalAxisLabel, color: palette.tickMuted } }),
    series: [
      {
        name: '累積買賣超',
        type: 'line',
        data: points,
        showSymbol: false,
        areaStyle: { opacity: 0.12, color: palette.brand },
        lineStyle: { width: 2, color: palette.brand },
        itemStyle: { color: palette.brand },
      },
    ],
  };
}

/** 收盤價（左軸）＋法人合計柱（右軸，買超紅、賣超綠） */
export function chipsVolumeOption(rows: ChipsVolumeData[] | null, isDark: boolean): EChartsOption | null {
  if (!rows?.length) return null;
  const palette = getChartPalette(isDark);
  const recent = [...rows].sort((a, b) => a.date.localeCompare(b.date)).slice(-RECENT_DAYS);
  return {
    animation: false,
    grid: { left: 52, right: 56, top: 36, bottom: 28 },
    tooltip: tooltip(palette),
    legend: legend(palette),
    xAxis: baseAxis(palette, recent.map((r) => r.date)),
    yAxis: [
      valueAxis(palette, { name: '收盤', position: 'left', nameTextStyle: { color: palette.tickMuted, fontSize: 10 }, scale: true }),
      valueAxis(palette, {
        name: '法人（股）',
        position: 'right',
        nameTextStyle: { color: palette.tickMuted, fontSize: 10 },
        axisLabel: { ...institutionalAxisLabel, color: palette.tickMuted },
        splitLine: { show: false },
      }),
    ],
    series: [
      {
        name: '收盤價',
        type: 'line',
        yAxisIndex: 0,
        data: recent.map((r) => r.close ?? null),
        showSymbol: false,
        lineStyle: { width: 2, color: palette.brand },
        itemStyle: { color: palette.brand },
      },
      {
        name: '法人合計',
        type: 'bar',
        yAxisIndex: 1,
        data: recent.map((r) => {
          const v = r.total_institutional_net ?? 0;
          return { value: v, itemStyle: { color: v > 0 ? palette.up : v < 0 ? palette.down : palette.flat } };
        }),
        itemStyle: { color: palette.up },
      },
    ],
  };
}

const hasValue = (values: Array<number | null>) => values.some((v) => v != null && Number.isFinite(v));

function indicatorBase(palette: ChartPalette, dates: string[], yAxisExtra?: Record<string, unknown>): EChartsOption {
  return {
    animation: false,
    grid: { left: 40, right: 16, top: 28, bottom: 24 },
    tooltip: tooltip(palette),
    legend: legend(palette),
    xAxis: baseAxis(palette, dates),
    yAxis: valueAxis(palette, yAxisExtra),
  };
}

/** RSI（0–100，含 70／30 參考線）與 MACD（柱依正負上色＋DIF／DEA） */
export function rsiMacdOptions(rows: TechnicalDay[], isDark: boolean) {
  const palette = getChartPalette(isDark);
  const ma = getMaColors(isDark);
  const dates = rows.map((r) => r.date);
  const rsi5 = rows.map((r) => r.rsi5);
  const rsi10 = rows.map((r) => r.rsi10);
  const dif = rows.map((r) => r.macd_dif);
  const dea = rows.map((r) => r.macd_dea ?? r.macd_signal);
  const hist = rows.map((r) => r.macd_hist);
  const hasRsiData = hasValue([...rsi5, ...rsi10]);
  const hasMacdData = hasValue(hist);

  const referenceLines = {
    silent: true,
    symbol: 'none',
    lineStyle: { type: 'dashed' as const, color: palette.referenceLine },
    label: { color: palette.tickMuted, fontSize: 10 },
    data: [{ yAxis: 70 }, { yAxis: 30 }],
  };
  const rsiSeries: NonNullable<EChartsOption['series']> = [];
  if (hasValue(rsi5)) {
    rsiSeries.push({ name: 'RSI5', type: 'line', data: rsi5, showSymbol: false, lineStyle: { width: 1.5, color: ma.MA10 }, itemStyle: { color: ma.MA10 } });
  }
  if (hasValue(rsi10)) {
    rsiSeries.push({ name: 'RSI10', type: 'line', data: rsi10, showSymbol: false, lineStyle: { width: 2, color: palette.brand }, itemStyle: { color: palette.brand } });
  }
  // 參考線必須掛在 series 上 ECharts 才會畫（決議 D9-c12）
  if (rsiSeries.length) (rsiSeries[0] as Record<string, unknown>).markLine = referenceLines;

  const macdSeries: NonNullable<EChartsOption['series']> = [
    {
      name: 'MACD',
      type: 'bar',
      data: hist.map((v) => ({ value: v ?? 0, itemStyle: { color: (v ?? 0) > 0 ? palette.up : (v ?? 0) < 0 ? palette.down : palette.flat } })),
      itemStyle: { color: palette.up },
    },
  ];
  if (hasValue(dif)) macdSeries.push({ name: 'DIF', type: 'line', data: dif, showSymbol: false, lineStyle: { width: 1.5, color: palette.brand }, itemStyle: { color: palette.brand } });
  if (hasValue(dea)) macdSeries.push({ name: 'DEA', type: 'line', data: dea, showSymbol: false, lineStyle: { width: 1.5, color: ma.MA20 }, itemStyle: { color: ma.MA20 } });

  return {
    rsiOption: hasRsiData ? { ...indicatorBase(palette, dates, { min: 0, max: 100 }), series: rsiSeries } : null,
    macdOption: hasMacdData ? { ...indicatorBase(palette, dates), series: macdSeries } : null,
    hasRsiData,
    hasMacdData,
  };
}

/** KD（0–100） */
export function kdOption(rows: TechnicalDay[], isDark: boolean): EChartsOption | null {
  const palette = getChartPalette(isDark);
  const ma = getMaColors(isDark);
  const k = rows.map((r) => r.kd_k9);
  const d = rows.map((r) => r.kd_d9);
  if (!hasValue([...k, ...d])) return null;
  return {
    ...indicatorBase(palette, rows.map((r) => r.date), { min: 0, max: 100 }),
    series: [
      { name: 'K', type: 'line', data: k, showSymbol: false, lineStyle: { width: 2, color: palette.brand }, itemStyle: { color: palette.brand } },
      { name: 'D', type: 'line', data: d, showSymbol: false, lineStyle: { width: 2, color: ma.MA10 }, itemStyle: { color: ma.MA10 } },
    ],
  };
}

/** 布林通道（20） */
export function bollOption(rows: TechnicalDay[], isDark: boolean): EChartsOption | null {
  const palette = getChartPalette(isDark);
  const ma = getMaColors(isDark);
  const upper = rows.map((r) => r.boll_upper20);
  const mid = rows.map((r) => r.boll_mid20);
  const lower = rows.map((r) => r.boll_lower20);
  if (!hasValue([...upper, ...mid, ...lower])) return null;
  return {
    ...indicatorBase(palette, rows.map((r) => r.date), { scale: true }),
    series: [
      { name: '上軌', type: 'line', data: upper, showSymbol: false, lineStyle: { width: 1, color: ma.MA20, type: 'dashed' }, itemStyle: { color: ma.MA20 } },
      { name: '中軌', type: 'line', data: mid, showSymbol: false, lineStyle: { width: 2, color: palette.brand }, itemStyle: { color: palette.brand } },
      { name: '下軌', type: 'line', data: lower, showSymbol: false, lineStyle: { width: 1, color: ma.MA10, type: 'dashed' }, itemStyle: { color: ma.MA10 } },
    ],
  };
}

/** 價量小卡：近 30 日收盤面積線，依區間漲跌上色 */
export function recentCloseOption(priceChart: PriceChartData | null, isDark: boolean, days = RECENT_DAYS) {
  if (!priceChart?.candles?.length) return null;
  const palette = getChartPalette(isDark);
  const candles = priceChart.candles.slice(-days);
  const first = candles[0]?.close ?? 0;
  const last = candles[candles.length - 1]?.close ?? 0;
  const pct = first !== 0 ? ((last - first) / first) * 100 : 0;
  const color = pct > 0 ? palette.up : pct < 0 ? palette.down : palette.flat;
  const option: EChartsOption = {
    animation: false,
    grid: { left: 4, right: 4, top: 8, bottom: 8 },
    xAxis: { type: 'category', data: candles.map((c) => c.time), show: false, boundaryGap: false },
    yAxis: { type: 'value', scale: true, show: false },
    tooltip: tooltip(palette, {
      formatter: (params: unknown) => {
        const p = (Array.isArray(params) ? params[0] : params) as { axisValue?: string; data?: number } | undefined;
        return p ? `${p.axisValue ?? ''}<br/>收盤 ${typeof p.data === 'number' ? p.data.toFixed(2) : ''}` : '';
      },
    }),
    series: [
      {
        type: 'line',
        data: candles.map((c) => c.close),
        showSymbol: false,
        smooth: true,
        lineStyle: { width: 2, color },
        itemStyle: { color },
        areaStyle: {
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: `${color}4d` },
              { offset: 1, color: `${color}00` },
            ],
          },
        },
      },
    ],
  };
  return { option, rangeChangePct: pct, days: candles.length };
}

// ── 多股比較 ────────────────────────────────────────────────

type SeriesTooltipItem = { seriesName?: string; value?: unknown; marker?: string; axisValue?: string };

const COMPARE_MODE_FORMAT: Record<CompareChartMode, { axis: (v: number) => string; tooltip: (v: number, name: string) => string }> = {
  price: { axis: (v) => v.toFixed(0), tooltip: (v, name) => `${name}：${v.toFixed(2)} 元` },
  index100: { axis: (v) => v.toFixed(1), tooltip: (v, name) => `${name}（指數）：${v.toFixed(2)}` },
  cumulativeReturn: { axis: (v) => `${v.toFixed(1)}%`, tooltip: (v, name) => `${name}（累積報酬）：${v.toFixed(2)}%` },
};

/** 多股比較主圖：報價／指數化／累積報酬%；圖例在圖表外自己畫（可切換、全顯示、全隱藏） */
export function compareLineOption(
  chart: CompareChartSeries,
  visibleSymbols: string[],
  colors: Record<string, string>,
  mode: CompareChartMode,
  isDark: boolean,
): EChartsOption | null {
  if (chart.dates.length === 0) return null;
  const palette = getChartPalette(isDark);
  const fmt = COMPARE_MODE_FORMAT[mode];
  return {
    animation: false,
    grid: { left: 56, right: 16, top: 16, bottom: 28 },
    tooltip: tooltip(palette, {
      formatter: (params: unknown) => {
        const items = (Array.isArray(params) ? params : [params]) as SeriesTooltipItem[];
        const lines = items
          .filter((p) => typeof p.value === 'number' && Number.isFinite(p.value))
          .map((p) => `${p.marker ?? ''}${fmt.tooltip(p.value as number, p.seriesName ?? '')}`);
        return [`<b>${items[0]?.axisValue ?? ''}</b>`, ...lines].join('<br/>');
      },
    }),
    xAxis: { ...baseAxis(palette, chart.dates), boundaryGap: false },
    yAxis: valueAxis(palette, { scale: true, axisLabel: { color: palette.tickMuted, fontSize: 10, formatter: (v: number) => fmt.axis(Number(v)) } }),
    series: visibleSymbols.map((sym) => ({
      name: sym,
      type: 'line' as const,
      data: chart.values[sym] ?? [],
      showSymbol: false,
      connectNulls: true,
      lineStyle: { width: 2, color: colors[sym] },
      itemStyle: { color: colors[sym] },
    })),
  };
}

/** 依資料推算座標範圍：min/max 外擴，確保資料與（需要時）0 軸都看得到 */
function paddedDomain(values: number[], includeZero: boolean): [number, number] {
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (includeZero) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  const range = max - min;
  const padding = range === 0 ? Math.max(Math.abs(max) * 0.2, 1) : range * 0.18;
  return [min - padding, max + padding];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export interface RiskReturnPoint {
  symbol: string;
  /** 年化波動度 % */
  x: number;
  /** 區間報酬 % */
  y: number;
  color: string;
}

/** 風險報酬散點：以樣本波動中位數與 0% 報酬切四象限 */
export function riskReturnScatterOption(points: RiskReturnPoint[], isDark: boolean): EChartsOption | null {
  if (points.length === 0) return null;
  const palette = getChartPalette(isDark);
  const [xMin, xMax] = paddedDomain(points.map((p) => p.x), false);
  const [yMin, yMax] = paddedDomain(points.map((p) => p.y), true);
  const xMedian = median(points.map((p) => p.x));
  // 象限標籤在冒號後換行，窄螢幕左右兩個標籤才不會疊在一起
  const quadrantLabel = (text: string, position: string) => ({
    show: true,
    position,
    formatter: text.replace('：', '：\n'),
    color: palette.tick,
    fontSize: 11,
    lineHeight: 15,
    align: position.endsWith('Right') ? 'right' : 'left',
  });
  const shaded = { color: palette.gridSubtle };
  const clear = { color: 'transparent' };
  const pct = (v: number) => `${Number(v).toFixed(1)}%`;
  return {
    animation: false,
    grid: { left: 56, right: 24, top: 16, bottom: 32 },
    tooltip: {
      trigger: 'item',
      confine: true,
      backgroundColor: palette.tooltipBg,
      borderColor: palette.tooltipBorder,
      textStyle: { color: palette.tooltipText, fontSize: 12 },
      formatter: (params: unknown) => {
        const p = params as { name?: string; value?: [number, number] };
        if (!Array.isArray(p.value)) return '';
        return `<b>${p.name ?? ''}</b><br/>年化波動度：${p.value[0].toFixed(2)}%<br/>區間報酬：${p.value[1].toFixed(2)}%`;
      },
    },
    xAxis: {
      type: 'value',
      min: xMin,
      max: xMax,
      axisLabel: { color: palette.tickMuted, fontSize: 10, formatter: pct, showMinLabel: false, showMaxLabel: false },
      axisLine: { lineStyle: { color: palette.grid } },
      splitLine: { lineStyle: { color: palette.gridSubtle } },
    },
    yAxis: valueAxis(palette, {
      min: yMin,
      max: yMax,
      axisLabel: { color: palette.tickMuted, fontSize: 10, formatter: pct, showMinLabel: false, showMaxLabel: false },
    }),
    series: [
      {
        type: 'scatter',
        symbolSize: 12,
        data: points.map((p) => ({ name: p.symbol, value: [p.x, p.y], itemStyle: { color: p.color } })),
        label: { show: true, position: 'top', formatter: '{b}', color: palette.tick, fontSize: 11 },
        markArea: {
          silent: true,
          data: [
            [{ xAxis: xMin, yAxis: 0, itemStyle: shaded, label: quadrantLabel('理想：低波動、正報酬', 'insideTopLeft') }, { xAxis: xMedian, yAxis: yMax }],
            [{ xAxis: xMedian, yAxis: 0, itemStyle: clear, label: quadrantLabel('激進：高波動、正報酬', 'insideTopRight') }, { xAxis: xMax, yAxis: yMax }],
            [{ xAxis: xMin, yAxis: yMin, itemStyle: clear, label: quadrantLabel('防禦：低波動、負報酬', 'insideBottomLeft') }, { xAxis: xMedian, yAxis: 0 }],
            [{ xAxis: xMedian, yAxis: yMin, itemStyle: shaded, label: quadrantLabel('落後：高波動、負報酬', 'insideBottomRight') }, { xAxis: xMax, yAxis: 0 }],
          ],
        },
        markLine: {
          silent: true,
          symbol: 'none',
          label: { show: false },
          lineStyle: { color: palette.referenceLine, type: 'dashed', opacity: 0.6 },
          data: [{ yAxis: 0 }, { xAxis: xMedian }],
        },
      },
    ],
  } as EChartsOption;
}

/** 多股三大法人累計買賣超（合計）：每檔一條線，依股票代表色 */
export function institutionalCompareOption(
  chart: CompareChartSeries,
  symbols: string[],
  colors: Record<string, string>,
  isDark: boolean,
): EChartsOption | null {
  if (chart.dates.length === 0) return null;
  const palette = getChartPalette(isDark);
  return {
    animation: false,
    grid: { left: 56, right: 16, top: 16, bottom: 56 },
    tooltip: tooltip(palette, { valueFormatter: (v: unknown) => (typeof v === 'number' ? fmtInstitutionalShares(v) : '—') }),
    legend: { type: 'scroll', bottom: 0, textStyle: { color: palette.tick, fontSize: 11 }, data: symbols },
    xAxis: baseAxis(palette, chart.dates),
    yAxis: valueAxis(palette, { axisLabel: { ...institutionalAxisLabel, color: palette.tickMuted } }),
    series: symbols.map((sym) => ({
      name: sym,
      type: 'line' as const,
      data: chart.values[sym] ?? [],
      showSymbol: false,
      connectNulls: true,
      lineStyle: { width: 2, color: colors[sym] },
      itemStyle: { color: colors[sym] },
    })),
  };
}
