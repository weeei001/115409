import type { EChartsOption } from './echarts';
import type { AIBacktestResult, ChipsVolumeData } from '../types/api';
import type { InstitutionalDay, TechnicalDay } from '../types/view';
import type { CompareChartMode } from '../types/compare';
import type { CompareChartSeries } from '../utils/compare';
import { LESS_THAN_ONE_LOT, fmtInstitutionalShares, fmtLotsAxisLabel, isUnderOneLot, lotsNumber, sharesToLots, withSign } from '../utils/format';
import { AI_SERIES_PALETTE, getChartPalette, getInstitutionColors, getMaColors, type ChartPalette } from './theme';

/** 自訂 tooltip 是 HTML 字串（ECharts renderMode 'html' 會當 innerHTML）：拼進去的 API 值一律先跳脫（02-F5） */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── 圖說的日期範圍 ──────────────────────────────────────────
// 圖旁的日期與筆數一律取自「圖上實際畫出的資料列」，不是查詢的日期區間。
// 下面兩個切片函式同時餵給 option 與圖說，兩邊不會各算各的。

/** 圖上實際畫出的第一天、最後一天與點數 */
export interface PlottedSpan {
  first: string;
  last: string;
  count: number;
}

/** 依畫出的日期算範圍（日期不必先排序）；沒有資料回傳 null */
export function plottedSpan(dates: readonly string[] | null | undefined): PlottedSpan | null {
  const valid = (dates ?? []).filter(Boolean);
  if (!valid.length) return null;
  const sorted = [...valid].sort();
  return { first: sorted[0], last: sorted[sorted.length - 1], count: sorted.length };
}

/** 「2026-08-18 → 2026-10-01，共 30 個交易日」 */
export function plottedSpanText(span: PlottedSpan | null): string | null {
  return span ? `${span.first} → ${span.last}，共 ${span.count} 個交易日` : null;
}

/**
 * 法人每日流向與累計圖畫的列：頁面期間內的每一天（rows 由舊到新）。
 * 以前固定只畫最近 30 個交易日，和同頁 K 線、指標的 63 日對不上（04-S3）；現在跟著同一段期間。
 */
export function recentInstitutionalRows(rows: InstitutionalDay[] | null | undefined): InstitutionalDay[] {
  return [...(rows ?? [])];
}

/** 價量籌碼圖畫的列：依日期排序後，頁面期間內的每一天 */
export function recentChipsRows(rows: ChipsVolumeData[] | null | undefined): ChipsVolumeData[] {
  return [...(rows ?? [])].sort((a, b) => a.date.localeCompare(b.date));
}

// ── 印刷圖表的共同語法 ──────────────────────────────────────
// 全站的 ECharts 都從這裡取軸、圖例、tooltip、格線與線條樣式，讀起來像同一套印刷圖：
// 等寬字的刻度、細線軸、方角 tooltip、色條圖例（線＝細條、柱＝方塊）、線上不畫點（滑過才出現）、柱子不做圓角。

/** 數字與刻度用等寬字（DESIGN.md 第 2 節）；IBM Plex Mono 沒有中文字，中文退到 Noto Sans TC */
export const CHART_MONO = "'IBM Plex Mono', 'Noto Sans TC', monospace";
export const CHART_SANS = "'Noto Sans TC', sans-serif";

/** 圖例色樣：線是 14×2 的細條、虛線是兩段、柱是 14×8 的方塊（legend.symbolKeepAspect 預設 true，路徑不會被拉高） */
const LEGEND_LINE = 'path://M0 0H14V2H0Z';
const LEGEND_DASH = 'path://M0 0H5V2H0ZM9 0H14V2H9Z';

/** 日期軸只寫 MM-DD（年份在面板標題與 tooltip），首尾標籤才不會被畫布切掉 */
export function shortDateLabel(value: string | number): string {
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(5, 10) : text;
}

function tickLabel(palette: ChartPalette, extra?: Record<string, unknown>) {
  return { color: palette.tickMuted, fontSize: 11, fontFamily: CHART_MONO, ...extra };
}

/**
 * 繪圖區：外框內縮到 grid 的範圍，刻度標籤（contain='all' 時連軸名）都算在框內，不會超出畫布被切掉。
 * top 預留圖例那一列。
 */
export function chartGrid(extra?: Record<string, unknown>) {
  return { left: 2, right: 10, top: 30, bottom: 2, outerBoundsMode: 'same' as const, outerBoundsContain: 'axisLabel' as const, ...extra };
}

/** 日期類別軸：MM-DD、首標籤靠左、尾標籤靠右、重疊就隱藏 */
export function baseAxis(palette: ChartPalette, dates: string[]) {
  return {
    type: 'category' as const,
    data: dates,
    axisLabel: tickLabel(palette, {
      formatter: shortDateLabel,
      hideOverlap: true,
      showMinLabel: true,
      showMaxLabel: true,
      alignMinLabel: 'left' as const,
      alignMaxLabel: 'right' as const,
    }),
    axisLine: { lineStyle: { color: palette.grid } },
    axisTick: { show: false },
  };
}

/** 數值軸：等寬刻度、極淡的橫格線、不畫軸線；extra.axisLabel 會併入而不是整個取代 */
export function valueAxis(palette: ChartPalette, extra?: Record<string, unknown>) {
  const { axisLabel, nameTextStyle, ...rest } = (extra ?? {}) as { axisLabel?: Record<string, unknown>; nameTextStyle?: Record<string, unknown> } & Record<string, unknown>;
  return {
    type: 'value' as const,
    axisLabel: tickLabel(palette, axisLabel),
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: palette.gridSubtle } },
    nameTextStyle: { color: palette.tickMuted, fontSize: 11, fontFamily: CHART_SANS, ...nameTextStyle },
    ...rest,
  };
}

/** tooltip：方角、1px 邊、無陰影；十字線是細虛線（燈色不拿來畫資料輔助線） */
export function tooltip(palette: ChartPalette, extra?: Record<string, unknown>) {
  return {
    trigger: 'axis' as const,
    confine: true,
    backgroundColor: palette.tooltipBg,
    borderColor: palette.tooltipBorder,
    borderWidth: 1,
    borderRadius: 0,
    padding: [6, 10],
    extraCssText: 'box-shadow:none;border-radius:0;',
    textStyle: { color: palette.tooltipText, fontSize: 12, fontFamily: CHART_MONO },
    axisPointer: { type: 'line' as const, lineStyle: { color: palette.referenceLine, width: 1, type: 'dashed' as const } },
    ...extra,
  };
}

type LegendSeries = { name?: unknown; type?: unknown; lineStyle?: { type?: unknown } };

/** 圖例：靠左上、可點擊切換；色樣依序列型別給細條／虛線／方塊，不用預設的圓點壓線 */
export function legend(palette: ChartPalette, series: readonly LegendSeries[], extra?: Record<string, unknown>) {
  return {
    top: 0,
    left: 0,
    itemWidth: 14,
    itemHeight: 8,
    itemGap: 14,
    itemStyle: { borderWidth: 0 },
    inactiveColor: palette.referenceLine,
    textStyle: { color: palette.tick, fontSize: 11, fontFamily: CHART_SANS },
    data: series
      .filter((s) => typeof s.name === 'string' && s.name)
      .map((s) => ({
        name: s.name as string,
        icon: s.type === 'bar' ? 'rect' : s.lineStyle?.type === 'dashed' ? LEGEND_DASH : LEGEND_LINE,
      })),
    ...extra,
  };
}

/** 折線：直線段、不畫點；滑過時才在該點出現 5px 實心點 */
export function lineLook(color: string | undefined, width = 1.5, dashed = false) {
  return {
    type: 'line' as const,
    smooth: false,
    showSymbol: false,
    symbol: 'circle',
    symbolSize: 5,
    lineStyle: { width, ...(color ? { color } : {}), ...(dashed ? { type: 'dashed' as const } : {}) },
    ...(color ? { itemStyle: { color } } : {}),
    emphasis: { scale: false, lineStyle: { width } },
  };
}

/** 柱：方角，最寬 14px */
const barLook = { type: 'bar' as const, barMaxWidth: 14, itemStyle: { borderRadius: 0 } };

/** 自訂 tooltip 用的方形色樣（取代預設圓點） */
function swatch(color: unknown): string {
  return typeof color === 'string' ? `<span style="display:inline-block;width:10px;height:2px;margin:0 6px 3px 0;vertical-align:middle;background:${color}"></span>` : '';
}

/*
 * 法人圖的資料點一律換成張（P1-21）：刻度才會是整齊的張數。tooltip 也寫張，不滿 1 張寫「不到 1」。
 */
const institutionalAxisLabel = { formatter: (value: number) => fmtLotsAxisLabel(Number(value)) };
const lotsPoint = (shares: number | null | undefined): number | null =>
  shares == null || !Number.isFinite(shares) ? null : sharesToLots(shares);
/** 資料點（張）→「1,234 張」，負號 U+2212 */
const lotsValueFormatter = (v: unknown): string => (typeof v === 'number' ? fmtInstitutionalShares(v * 1000) : '--');

/**
 * 法人 tooltip 的股數 → 整數張，和法人明細表一樣（lib/utils/format.ts 的 lots／signedLots）。
 * 買、賣、淨各自四捨五入到整數張，相減最多差 1 張（04-S5 原本是 8萬／5萬／淨 4萬那種整數萬的落差）。
 * 淨額帶正負號（U+2212）；不滿 1 張的非零值寫「不到 1」（標頭已寫「張」）。
 */
export function institutionalTooltipLots(value: number | null | undefined, signed = false): string {
  if (value == null || !Number.isFinite(value)) return '--';
  if (isUnderOneLot(value)) return LESS_THAN_ONE_LOT.replace(/ 張$/, '');
  const abs = lotsNumber(value);
  return signed ? withSign(value, abs) : abs;
}

/**
 * 價格的數字文法和 DOM 的 fmtPrice 一致：不加千分位（ECharts 預設會寫成 2,550）。
 * 刻度的小數位依刻度間距：整數刻度不補 .00，非整數最多兩位；tooltip 一律兩位。
 * 張數、股數這類計數維持各自的格式。
 */
export function priceAxisLabel(value: number): string {
  if (!Number.isFinite(value)) return '';
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}
export const priceTooltipValue = (value: unknown): string =>
  typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '—';
const priceAxis = { formatter: (value: number) => priceAxisLabel(Number(value)) };
const priceTooltip = { valueFormatter: priceTooltipValue };

/** 正負上色的柱（MACD、法人合計）：圖例色樣用中性色，因為顏色依每根柱的正負而定 */
function signedBarColor(palette: ChartPalette, v: number) {
  return v > 0 ? palette.up : v < 0 ? palette.down : palette.flat;
}

/** 三大法人每日買賣超：外資／投信／自營堆疊柱（依法人上色）＋合計線 */
export function institutionalFlowOption(rows: InstitutionalDay[] | null, isDark: boolean): EChartsOption | null {
  if (!rows?.length) return null;
  const palette = getChartPalette(isDark);
  const colors = getInstitutionColors(isDark);
  const recent = recentInstitutionalRows(rows);
  const hasBuySell = recent.some((r) => r.foreign_buy != null || r.foreign_sell != null);
  const f = institutionalTooltipLots;
  const series = [
    { ...barLook, name: '外資', stack: 'inst', data: recent.map((r) => lotsPoint(r.foreign_net ?? 0)), itemStyle: { ...barLook.itemStyle, color: colors.foreign } },
    { ...barLook, name: '投信', stack: 'inst', data: recent.map((r) => lotsPoint(r.investment_trust_net ?? 0)), itemStyle: { ...barLook.itemStyle, color: colors.trust } },
    { ...barLook, name: '自營', stack: 'inst', data: recent.map((r) => lotsPoint(r.dealer_net ?? 0)), itemStyle: { ...barLook.itemStyle, color: colors.dealer } },
    { ...lineLook(palette.text, 2), name: '合計', data: recent.map((r) => lotsPoint(r.total_institutional_net ?? 0)) },
  ];
  return {
    animation: false,
    grid: chartGrid(),
    tooltip: tooltip(palette, {
      formatter: hasBuySell
        ? (params: unknown) => {
            const items = params as Array<{ dataIndex: number }>;
            const row = recent[items?.[0]?.dataIndex ?? -1];
            if (!row) return '';
            return [
              `<b>${escapeHtml(row.date)}</b>（張）`,
              `外資：買 ${f(row.foreign_buy)} / 賣 ${f(row.foreign_sell)} / 淨 <b>${f(row.foreign_net, true)}</b>`,
              `投信：買 ${f(row.investment_trust_buy)} / 賣 ${f(row.investment_trust_sell)} / 淨 <b>${f(row.investment_trust_net, true)}</b>`,
              `自營：買 ${f(row.dealer_buy)} / 賣 ${f(row.dealer_sell)} / 淨 <b>${f(row.dealer_net, true)}</b>`,
              `合計：<b>${f(row.total_institutional_net, true)}</b>`,
            ].join('<br/>');
          }
        : undefined,
    }),
    legend: legend(palette, series),
    xAxis: baseAxis(palette, recent.map((r) => r.date)),
    yAxis: valueAxis(palette, { axisLabel: institutionalAxisLabel }),
    series,
  };
}

/** 法人累積買賣超（張） */
export function institutionalCumulativeOption(rows: InstitutionalDay[] | null, isDark: boolean): EChartsOption | null {
  if (!rows?.length) return null;
  const palette = getChartPalette(isDark);
  const recent = recentInstitutionalRows(rows);
  let running = 0;
  const points = recent.map((row) => lotsPoint(running += row.total_institutional_net ?? 0));
  return {
    animation: false,
    grid: chartGrid({ top: 12 }),
    tooltip: tooltip(palette, { valueFormatter: lotsValueFormatter }),
    xAxis: baseAxis(palette, recent.map((r) => r.date)),
    yAxis: valueAxis(palette, { axisLabel: institutionalAxisLabel }),
    series: [
      {
        ...lineLook(palette.text, 2),
        name: '累積買賣超',
        data: points,
        // 平塗的極淡底色，不做漸層
        areaStyle: { opacity: 0.08, color: palette.text },
      },
    ],
  };
}

/** 收盤價（左軸）＋法人合計柱（右軸，買超紅、賣超綠） */
export function chipsVolumeOption(rows: ChipsVolumeData[] | null, isDark: boolean): EChartsOption | null {
  if (!rows?.length) return null;
  const palette = getChartPalette(isDark);
  const recent = recentChipsRows(rows);
  const series = [
    { ...lineLook(palette.text, 2), name: '收盤價', yAxisIndex: 0, data: recent.map((r) => r.close ?? null), tooltip: priceTooltip },
    {
      ...barLook,
      name: '法人合計',
      yAxisIndex: 1,
      data: recent.map((r) => {
        const v = r.total_institutional_net ?? 0;
        return { value: lotsPoint(v), itemStyle: { color: signedBarColor(palette, v) } };
      }),
      tooltip: { valueFormatter: lotsValueFormatter },
      itemStyle: { ...barLook.itemStyle, color: palette.flat },
    },
  ];
  return {
    animation: false,
    // 圖例一列（0–14px）、軸名一列，兩者分開；軸名也算進外框（contain='all'），不會壓到圖例
    grid: chartGrid({ top: 24, outerBoundsContain: 'all' }),
    tooltip: tooltip(palette),
    legend: legend(palette, series),
    xAxis: baseAxis(palette, recent.map((r) => r.date)),
    yAxis: [
      valueAxis(palette, { name: '收盤', position: 'left', nameGap: 8, nameTextStyle: { align: 'left' }, scale: true, axisLabel: priceAxis }),
      valueAxis(palette, {
        name: '法人（張）',
        position: 'right',
        nameGap: 8,
        nameTextStyle: { align: 'right' },
        axisLabel: institutionalAxisLabel,
        splitLine: { show: false },
      }),
    ],
    series,
  };
}

const hasValue = (values: Array<number | null>) => values.some((v) => v != null && Number.isFinite(v));

function indicatorBase(
  palette: ChartPalette,
  dates: string[],
  series: readonly LegendSeries[],
  yAxisExtra?: Record<string, unknown>,
  tooltipExtra?: Record<string, unknown>,
): EChartsOption {
  return {
    animation: false,
    grid: chartGrid(),
    tooltip: tooltip(palette, tooltipExtra),
    legend: legend(palette, series),
    xAxis: baseAxis(palette, dates),
    yAxis: valueAxis(palette, yAxisExtra),
  };
}

const fixedTooltip = (digits: number) => ({
  valueFormatter: (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '--'),
});
/** RSI、KD 1 位，MACD 柱 3 位（和 lib/utils/indicatorSignals 的 fmtIndicator、MACD_DECIMALS 一致） */
const indicatorTooltip = fixedTooltip(1);
const macdHistTooltip = fixedTooltip(3);
const macdLineTooltip = fixedTooltip(2);

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
    lineStyle: { type: 'dashed' as const, color: palette.referenceLine, width: 1 },
    // 標籤放在線內側上方，不佔右邊界
    label: { position: 'insideEndTop', color: palette.tickMuted, fontSize: 10, fontFamily: CHART_MONO },
    data: [{ yAxis: 70 }, { yAxis: 30 }],
  };
  const rsiSeries: Array<Record<string, unknown>> = [];
  if (hasValue(rsi5)) rsiSeries.push({ ...lineLook(ma.MA10, 1.5), name: 'RSI5', data: rsi5, tooltip: indicatorTooltip });
  if (hasValue(rsi10)) rsiSeries.push({ ...lineLook(palette.text, 2), name: 'RSI10', data: rsi10, tooltip: indicatorTooltip });
  // 參考線必須掛在 series 上 ECharts 才會畫（決議 D9-c12）
  if (rsiSeries.length) rsiSeries[0].markLine = referenceLines;

  const macdSeries: Array<Record<string, unknown>> = [
    {
      ...barLook,
      name: 'MACD 柱',
      data: hist.map((v) => ({ value: v ?? 0, itemStyle: { color: signedBarColor(palette, v ?? 0) } })),
      itemStyle: { ...barLook.itemStyle, color: palette.flat },
      tooltip: macdHistTooltip,
    },
  ];
  if (hasValue(dif)) macdSeries.push({ ...lineLook(palette.text, 1.5), name: 'DIF', data: dif, tooltip: macdLineTooltip });
  if (hasValue(dea)) macdSeries.push({ ...lineLook(ma.MA20, 1.5), name: 'DEA', data: dea, tooltip: macdLineTooltip });

  return {
    rsiOption: hasRsiData ? ({ ...indicatorBase(palette, dates, rsiSeries, { min: 0, max: 100 }), series: rsiSeries } as EChartsOption) : null,
    macdOption: hasMacdData ? ({ ...indicatorBase(palette, dates, macdSeries), series: macdSeries } as EChartsOption) : null,
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
  const series = [
    { ...lineLook(palette.text, 2), name: 'K', data: k, tooltip: indicatorTooltip },
    { ...lineLook(ma.MA10, 2), name: 'D', data: d, tooltip: indicatorTooltip },
  ];
  return { ...indicatorBase(palette, rows.map((r) => r.date), series, { min: 0, max: 100 }), series };
}

/** 布林通道（20） */
export function bollOption(rows: TechnicalDay[], isDark: boolean): EChartsOption | null {
  const palette = getChartPalette(isDark);
  const ma = getMaColors(isDark);
  const upper = rows.map((r) => r.boll_upper20);
  const mid = rows.map((r) => r.boll_mid20);
  const lower = rows.map((r) => r.boll_lower20);
  if (!hasValue([...upper, ...mid, ...lower])) return null;
  const series = [
    { ...lineLook(ma.MA20, 1, true), name: '上軌', data: upper },
    { ...lineLook(palette.text, 2), name: '中軌', data: mid },
    { ...lineLook(ma.MA10, 1, true), name: '下軌', data: lower },
  ];
  // 布林通道是價格：刻度與 tooltip 不加千分位，和 K 線、DOM 的價格寫法一致
  return { ...indicatorBase(palette, rows.map((r) => r.date), series, { scale: true, axisLabel: priceAxis }, priceTooltip), series };
}

// ── 多股比較 ────────────────────────────────────────────────

type SeriesTooltipItem = { seriesName?: string; value?: unknown; color?: unknown; axisValue?: string };

const COMPARE_MODE_FORMAT: Record<CompareChartMode, { axis: (v: number) => string; tooltip: (v: number, name: string) => string }> = {
  price: { axis: (v) => priceAxisLabel(v), tooltip: (v, name) => `${name}：${priceTooltipValue(v)} 元` },
  index100: { axis: (v) => v.toFixed(1), tooltip: (v, name) => `${name}（指數）：${v.toFixed(2)}` },
  cumulativeReturn: { axis: (v) => `${v.toFixed(1)}%`, tooltip: (v, name) => `${name}（區間漲跌幅）：${v.toFixed(2)}%` },
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
    grid: chartGrid({ top: 12 }),
    tooltip: tooltip(palette, {
      formatter: (params: unknown) => {
        const items = (Array.isArray(params) ? params : [params]) as SeriesTooltipItem[];
        const lines = items
          .filter((p) => typeof p.value === 'number' && Number.isFinite(p.value))
          .map((p) => `${swatch(p.color)}${fmt.tooltip(p.value as number, escapeHtml(p.seriesName))}`);
        return [`<b>${escapeHtml(items[0]?.axisValue)}</b>`, ...lines].join('<br/>');
      },
    }),
    xAxis: { ...baseAxis(palette, chart.dates), boundaryGap: false },
    yAxis: valueAxis(palette, { scale: true, axisLabel: { formatter: (v: number) => fmt.axis(Number(v)) } }),
    series: visibleSymbols.map((sym) => ({
      ...lineLook(colors[sym], 2),
      name: sym,
      data: chart.values[sym] ?? [],
      connectNulls: false,
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

/** 象限說明列在繪圖區外：上半部兩則寫在圖框上緣之上，下半部兩則寫在 X 軸刻度之下，點永遠不會壓到 */
const QUADRANT_ABOVE = 18;
const QUADRANT_BELOW = 30;

/** 風險報酬散點：以樣本波動中位數與 0% 報酬切四象限 */
export function riskReturnScatterOption(points: RiskReturnPoint[], isDark: boolean): EChartsOption | null {
  if (points.length === 0) return null;
  const palette = getChartPalette(isDark);
  const [xMin, xMax] = paddedDomain(points.map((p) => p.x), false);
  const [yMin, yMax] = paddedDomain(points.map((p) => p.y), true);
  const xMedian = median(points.map((p) => p.x));
  const quadrantLabel = (text: string, side: 'left' | 'right', edge: 'above' | 'below') => ({
    show: true,
    position: [side === 'left' ? 0 : '100%', edge === 'above' ? 0 : '100%'],
    formatter: text,
    align: side,
    verticalAlign: edge === 'above' ? 'bottom' : 'top',
    padding: edge === 'above' ? [0, 0, 6, 0] : [QUADRANT_BELOW - 8, 0, 0, 0],
    color: palette.tickMuted,
    fontSize: 11,
    fontFamily: CHART_SANS,
  });
  const shaded = { color: palette.gridSubtle };
  const clear = { color: 'transparent' };
  const pct = (v: number) => `${Number(v).toFixed(1)}%`;
  return {
    animation: false,
    grid: chartGrid({ left: 2, right: 10, top: QUADRANT_ABOVE + 6, bottom: QUADRANT_BELOW - 6 }),
    tooltip: tooltip(palette, {
      trigger: 'item',
      axisPointer: undefined,
      formatter: (params: unknown) => {
        const p = params as { name?: string; value?: [number, number] };
        if (!Array.isArray(p.value)) return '';
        return `<b>${escapeHtml(p.name)}</b><br/>年化波動度：${p.value[0].toFixed(2)}%<br/>區間漲跌幅：${p.value[1].toFixed(2)}%`;
      },
    }),
    xAxis: {
      type: 'value',
      min: xMin,
      max: xMax,
      axisLabel: tickLabel(palette, { formatter: pct, showMinLabel: false, showMaxLabel: false }),
      axisLine: { lineStyle: { color: palette.grid } },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: palette.gridSubtle } },
    },
    yAxis: valueAxis(palette, {
      min: yMin,
      max: yMax,
      axisLabel: { formatter: pct, showMinLabel: false, showMaxLabel: false },
    }),
    series: [
      {
        type: 'scatter',
        symbolSize: 10,
        data: points.map((p) => ({ name: p.symbol, value: [p.x, p.y], itemStyle: { color: p.color } })),
        label: { show: true, position: 'top', distance: 4, formatter: '{b}', color: palette.tick, fontSize: 11, fontFamily: CHART_MONO },
        // 點的標籤互相或與邊界重疊時先上下錯開，仍重疊才隱藏（滑過仍看得到 tooltip）
        labelLayout: { moveOverlap: 'shiftY', hideOverlap: true },
        emphasis: { scale: false },
        markArea: {
          silent: true,
          data: [
            [{ xAxis: xMin, yAxis: 0, itemStyle: shaded, label: quadrantLabel('相對低波動：價格上漲', 'left', 'above') }, { xAxis: xMedian, yAxis: yMax }],
            [{ xAxis: xMedian, yAxis: 0, itemStyle: clear, label: quadrantLabel('相對高波動：價格上漲', 'right', 'above') }, { xAxis: xMax, yAxis: yMax }],
            [{ xAxis: xMin, yAxis: yMin, itemStyle: clear, label: quadrantLabel('相對低波動：價格下跌', 'left', 'below') }, { xAxis: xMedian, yAxis: 0 }],
            [{ xAxis: xMedian, yAxis: yMin, itemStyle: shaded, label: quadrantLabel('相對高波動：價格下跌', 'right', 'below') }, { xAxis: xMax, yAxis: 0 }],
          ],
        },
        markLine: {
          silent: true,
          symbol: 'none',
          label: { show: false },
          lineStyle: { color: palette.referenceLine, type: 'dashed', width: 1, opacity: 0.8 },
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
  const series = symbols.map((sym) => ({
    ...lineLook(colors[sym], 2),
    name: sym,
    data: (chart.values[sym] ?? []).map(lotsPoint),
    connectNulls: false,
  }));
  return {
    animation: false,
    grid: chartGrid(),
    tooltip: tooltip(palette, { valueFormatter: lotsValueFormatter }),
    legend: legend(palette, series, { type: 'scroll', pageTextStyle: { color: palette.tickMuted, fontFamily: CHART_MONO } }),
    xAxis: baseAxis(palette, chart.dates),
    yAxis: valueAxis(palette, { axisLabel: institutionalAxisLabel }),
    series,
  };
}

/** AI 回測三組的線色：類別色、不帶漲跌意義；兩條基準用墨色與參考線色的虛線 */
export const BACKTEST_GROUP_COLORS = { rule: AI_SERIES_PALETTE[2], ai_plain: AI_SERIES_PALETTE[1], ai_signals: AI_SERIES_PALETTE[0] } as const;

const moneyAxisLabel = (value: number) => (Math.abs(value) >= 10_000 ? `${Math.round(value / 10_000)} 萬` : String(Math.round(value)));

/** AI 回測的資產曲線：三組加買進持有、加權指數（換算成同樣的起始資金）；用內建圖例切換 */
export function aiBacktestOption(result: AIBacktestResult, isDark: boolean): EChartsOption | null {
  if (!result.dates.length) return null;
  const palette = getChartPalette(isDark);
  const series = [
    ...result.groups.map((group) => ({ ...lineLook(BACKTEST_GROUP_COLORS[group.key], 2), name: group.label, data: group.equity })),
    { ...lineLook(palette.text, 1.5, true), name: '買進持有', data: result.buy_and_hold },
    { ...lineLook(palette.referenceLine, 1.5, true), name: '加權指數', data: result.market_index },
  ];
  return {
    animation: false,
    grid: chartGrid({ top: 34 }),
    // 五條線在手機寬度會換行壓到刻度，單行可捲動
    legend: legend(palette, series, { type: 'scroll', pageTextStyle: { color: palette.tickMuted, fontFamily: CHART_MONO } }),
    tooltip: tooltip(palette, {
      formatter: (params: unknown) => {
        const items = (Array.isArray(params) ? params : [params]) as SeriesTooltipItem[];
        const lines = items
          .filter((item) => typeof item.value === 'number' && Number.isFinite(item.value))
          .map((item) => `${swatch(item.color)}${escapeHtml(item.seriesName)}：${Math.round(item.value as number).toLocaleString('zh-TW')} 元`);
        return [`<b>${escapeHtml(items[0]?.axisValue)}</b>`, ...lines].join('<br/>');
      },
    }),
    xAxis: { ...baseAxis(palette, result.dates), boundaryGap: false },
    yAxis: valueAxis(palette, { scale: true, axisLabel: { formatter: (value: number) => moneyAxisLabel(Number(value)) } }),
    series,
  };
}
