import type { EChartsOption } from '@/lib/charts/echarts';
import { getChartPalette, type ChartPalette } from '@/lib/charts/theme';
import { fmtPrice } from '@/lib/utils/format';
import { tradeSides } from './derive';
import { actionLabel, escapeHtml, excerpt, fmtMoney, fmtShares } from './display';
import type { SimDayEvent } from './types';

/*
 * Demo 圖表的 option。軸、tooltip、圖例的樣式照 lib/charts/adapters.ts，
 * 但那些 helper 沒有匯出，這裡另寫一份，demo 刪掉時一起刪。
 */

function categoryAxis(palette: ChartPalette, dates: string[]) {
  return {
    type: 'category' as const,
    data: dates,
    axisLabel: { color: palette.tickMuted, fontSize: 10 },
    axisLine: { lineStyle: { color: palette.grid } },
    axisTick: { show: false },
  };
}

function valueAxis(palette: ChartPalette, formatter: (value: number) => string) {
  return {
    type: 'value' as const,
    scale: true,
    axisLabel: { color: palette.tickMuted, fontSize: 10, formatter },
    splitLine: { lineStyle: { color: palette.gridSubtle } },
  };
}

function tooltip(palette: ChartPalette, formatter: (params: unknown) => string) {
  return {
    trigger: 'axis' as const,
    confine: true,
    backgroundColor: palette.tooltipBg,
    borderColor: palette.tooltipBorder,
    textStyle: { color: palette.tooltipText, fontSize: 12 },
    extraCssText: 'max-width: 280px; white-space: normal;',
    formatter,
  };
}

const legend = (palette: ChartPalette) => ({ top: 0, textStyle: { color: palette.tick, fontSize: 11 } });

const firstIndex = (params: unknown) => (params as Array<{ dataIndex?: number }> | undefined)?.[0]?.dataIndex ?? -1;

/** 點多的時候不畫每個點，免得線被圓點蓋住 */
const showSymbol = (days: SimDayEvent[]) => days.length <= 40;

/** 元 → 萬／億，給資產軸用 */
function fmtWanAxis(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e8) return `${Number((value / 1e8).toFixed(2))}億`;
  if (abs >= 1e4) return `${Number((value / 1e4).toFixed(1))}萬`;
  return String(Math.round(value));
}

/**
 * 收盤價走勢＋買賣點。價格只用 day 事件的 close_price，不呼叫主後端；
 * 買賣點畫在成交日的收盤價上，只標示「哪一天有成交」，不代表成交價。
 */
export function priceActionOption(days: SimDayEvent[], isDark: boolean): EChartsOption | null {
  if (!days.length) return null;
  const palette = getChartPalette(isDark);
  const sides = tradeSides(days);
  const markers = (side: 'buy' | 'sell') => days.map((day, i) => (sides[i] === side ? day.close_price : '-'));

  return {
    animation: false,
    grid: { left: 56, right: 16, top: 32, bottom: 28 },
    legend: legend(palette),
    tooltip: tooltip(palette, (params) => {
      const day = days[firstIndex(params)];
      if (!day) return '';
      const lines = [
        `<b>${escapeHtml(day.date)}</b>（成交日）`,
        `收盤價 <b>${fmtPrice(day.close_price)}</b>`,
        `動作 ${escapeHtml(actionLabel(day.action))}，成交 ${fmtShares(day.executed_shares)} 股`,
      ];
      if (day.decision_date) lines.push(`決策日 ${escapeHtml(day.decision_date)}`);
      if (day.reason.trim()) lines.push(`理由：${escapeHtml(excerpt(day.reason))}`);
      return lines.join('<br/>');
    }),
    xAxis: categoryAxis(palette, days.map((day) => day.date)),
    yAxis: valueAxis(palette, (value) => fmtMoney(value)),
    series: [
      {
        name: '收盤價',
        type: 'line',
        data: days.map((day) => day.close_price),
        showSymbol: showSymbol(days),
        symbolSize: 4,
        lineStyle: { width: 2, color: palette.tick },
        itemStyle: { color: palette.tick },
      },
      {
        name: '買點',
        type: 'scatter',
        data: markers('buy'),
        symbol: 'triangle',
        z: 3,
        symbolSize: 12,
        itemStyle: { color: palette.up },
      },
      {
        name: '賣點',
        type: 'scatter',
        data: markers('sell'),
        symbol: 'triangle',
        z: 3,
        symbolRotate: 180,
        symbolSize: 12,
        itemStyle: { color: palette.down },
      },
    ],
  };
}

/** 資產淨值（portfolio_value）＋初始資金參考線 */
export function equityOption(days: SimDayEvent[], initialCash: number, isDark: boolean): EChartsOption | null {
  if (!days.length) return null;
  const palette = getChartPalette(isDark);

  return {
    animation: false,
    grid: { left: 56, right: 16, top: 32, bottom: 28 },
    legend: legend(palette),
    tooltip: tooltip(palette, (params) => {
      const day = days[firstIndex(params)];
      if (!day) return '';
      return [
        `<b>${escapeHtml(day.date)}</b>`,
        `資產淨值 <b>${fmtMoney(day.portfolio_value)}</b> 元`,
        `現金 ${fmtMoney(day.cash_after)} 元，持股 ${fmtShares(day.shares_after)} 股`,
        `初始資金 ${fmtMoney(initialCash)} 元`,
      ].join('<br/>');
    }),
    xAxis: categoryAxis(palette, days.map((day) => day.date)),
    yAxis: valueAxis(palette, fmtWanAxis),
    series: [
      {
        name: '資產淨值',
        type: 'line',
        data: days.map((day) => day.portfolio_value),
        showSymbol: showSymbol(days),
        symbolSize: 4,
        lineStyle: { width: 2, color: palette.brand },
        itemStyle: { color: palette.brand },
      },
      {
        // 用一條水平線而不是 markLine：scale 軸會把它算進範圍，不會被切到圖外
        name: '初始資金',
        type: 'line',
        data: days.map(() => initialCash),
        showSymbol: false,
        lineStyle: { width: 1, type: 'dashed', color: palette.referenceLine },
        itemStyle: { color: palette.referenceLine },
      },
    ],
  };
}
