import type { EChartsOption } from 'echarts';
import type { CandlestickWithMAResponse } from '../types';
import type { ChartCandle, PriceChartData } from '../types/priceChart';
import type { InstitutionalTradeListResponse, TechnicalIndicatorDayRow } from '../types/stockDashboard';
import { CHART_DOWN, CHART_UP, getChartPalette } from '../chartTheme';
import { fmtInstitutionalAxisLabel } from './format';

const institutionalYAxisLabel = {
  fontSize: 10,
  formatter: (value: number) => fmtInstitutionalAxisLabel(Number(value)),
};

export function candlestickMaToPriceChart(data: CandlestickWithMAResponse): PriceChartData | null {
  if (!data.candlestick?.length) return null;

  const candles: ChartCandle[] = data.candlestick.map((row) => ({
    time: row.date,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
  }));

  const volume = data.candlestick.map((row) => {
    const up = row.change >= 0;
    return {
      time: row.date,
      value: row.volume,
      color: up ? CHART_UP : CHART_DOWN,
    };
  });

  const ma = data.moving_averages ?? {};
  const dates = data.dates?.length ? data.dates : data.candlestick.map((c) => c.date);

  const toOverlay = (key: string) =>
    dates.map((date, i) => {
      const series = ma[key];
      const value = series?.[i] ?? null;
      return { time: date, value: value != null && Number.isFinite(Number(value)) ? Number(value) : null };
    });

  return {
    candles,
    volume,
    overlays: {
      MA5: toOverlay('MA5'),
      MA10: toOverlay('MA10'),
      MA20: toOverlay('MA20'),
      MA60: toOverlay('MA60'),
    },
    markers: [],
  };
}

export function institutionalToFlowChartOption(
  data: InstitutionalTradeListResponse | null,
  isDark: boolean
): EChartsOption | null {
  if (!data?.data?.length) return null;

  const palette = getChartPalette(isDark);
  const sorted = [...data.data].sort((a, b) => a.date.localeCompare(b.date)).slice(-30);
  const dates = sorted.map((r) => r.date);

  const hasBuySellData = sorted.some(
    (r) => r.foreign_buy != null || r.foreign_sell != null
  );

  return {
    animation: false,
    grid: { left: 48, right: 16, top: 24, bottom: 28 },
    tooltip: {
      trigger: 'axis',
      formatter: hasBuySellData
        ? (params: unknown) => {
            const items = params as Array<{ axisValue: string; dataIndex: number }>;
            if (!items?.length) return '';
            const idx = items[0].dataIndex;
            const row = sorted[idx];
            if (!row) return '';
            const f = fmtInstitutionalAxisLabel;
            let html = `<b>${row.date}</b><br/>`;
            html += `外資：買 ${f(row.foreign_buy ?? 0)} / 賣 ${f(row.foreign_sell ?? 0)} / 淨 <b>${f(row.foreign_excl_dealer_net ?? 0)}</b><br/>`;
            html += `投信：買 ${f(row.investment_trust_buy ?? 0)} / 賣 ${f(row.investment_trust_sell ?? 0)} / 淨 <b>${f(row.investment_trust_net ?? 0)}</b><br/>`;
            html += `自營：買 ${f(row.dealer_buy ?? 0)} / 賣 ${f(row.dealer_sell ?? 0)} / 淨 <b>${f(row.dealer_net_total ?? 0)}</b><br/>`;
            html += `合計：<b>${f(row.total_net ?? 0)}</b>`;
            return html;
          }
        : undefined,
    },
    legend: { top: 0, textStyle: { color: palette.tick } },
    xAxis: {
      type: 'category',
      data: dates,
      axisLabel: { color: palette.tickMuted, fontSize: 10 },
      axisLine: { lineStyle: { color: palette.grid } },
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        ...institutionalYAxisLabel,
        color: palette.tickMuted,
      },
      splitLine: { lineStyle: { color: palette.gridSubtle } },
    },
    series: [
      {
        name: '外資',
        type: 'bar',
        stack: 'inst',
        data: sorted.map((r) => r.foreign_excl_dealer_net ?? 0),
        itemStyle: { color: palette.brand },
      },
      {
        name: '投信',
        type: 'bar',
        stack: 'inst',
        data: sorted.map((r) => r.investment_trust_net ?? 0),
        itemStyle: { color: palette.tickMuted },
      },
      {
        name: '自營',
        type: 'bar',
        stack: 'inst',
        data: sorted.map((r) => r.dealer_net_total ?? 0),
        itemStyle: { color: palette.referenceLine },
      },
      {
        name: '合計',
        type: 'line',
        data: sorted.map((r) => r.total_net ?? 0),
        symbol: 'none',
        lineStyle: { width: 2, color: palette.tick },
      },
    ],
  };
}

export function indicatorsToRsiMacdOptions(
  rows: TechnicalIndicatorDayRow[],
  isDark: boolean
): {
  rsiOption: EChartsOption | null;
  macdOption: EChartsOption | null;
  hasRsiData: boolean;
  hasMacdData: boolean;
} {
  if (!rows.length) {
    return { rsiOption: null, macdOption: null, hasRsiData: false, hasMacdData: false };
  }

  const palette = getChartPalette(isDark);
  const dates = rows.map((r) => r.date);

  const rsi5 = rows.map((r) => (r.rsi5 != null ? Number(r.rsi5) : null));
  const rsi10 = rows.map((r) => (r.rsi10 != null ? Number(r.rsi10) : null));
  const hasRsiData = [...rsi5, ...rsi10].some((v) => v != null && Number.isFinite(v));

  const macdDif = rows.map((r) => (r.macd_dif != null ? Number(r.macd_dif) : null));
  const macdDea = rows.map((r) => {
    if (r.macd_dea != null) return Number(r.macd_dea);
    if (r.macd_signal != null) return Number(r.macd_signal);
    return null;
  });
  const macdHist = rows.map((r) => (r.macd_hist != null ? Number(r.macd_hist) : null));
  const hasMacdData = macdHist.some((v) => v != null && Number.isFinite(v));

  const rsiSeries: EChartsOption['series'] = [];
  if (rsi5.some((v) => v != null && Number.isFinite(v))) {
    rsiSeries.push({
      name: 'RSI5',
      type: 'line',
      data: rsi5,
      showSymbol: false,
      lineStyle: { width: 1.5, color: palette.up },
    });
  }
  if (rsi10.some((v) => v != null && Number.isFinite(v))) {
    rsiSeries.push({
      name: 'RSI10',
      type: 'line',
      data: rsi10,
      showSymbol: false,
      lineStyle: { width: 2, color: palette.brand },
    });
  }

  const rsiOption: EChartsOption = {
    animation: false,
    grid: { left: 40, right: 16, top: 24, bottom: 24 },
    tooltip: { trigger: 'axis' },
    legend: { top: 0, textStyle: { color: palette.tick, fontSize: 10 } },
    xAxis: {
      type: 'category',
      data: dates,
      axisLabel: { color: palette.tickMuted, fontSize: 10 },
      axisLine: { lineStyle: { color: palette.grid } },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      axisLabel: { color: palette.tickMuted, fontSize: 10 },
      splitLine: { lineStyle: { color: palette.gridSubtle } },
    },
    series: rsiSeries,
    markLine: {
      silent: true,
      symbol: 'none',
      lineStyle: { type: 'dashed', color: palette.referenceLine },
      data: [{ yAxis: 70 }, { yAxis: 30 }],
    },
  };

  const macdSeries: EChartsOption['series'] = [
    {
      name: 'MACD',
      type: 'bar',
      data: macdHist.map((v) => ({
        value: v ?? 0,
        itemStyle: { color: (v ?? 0) >= 0 ? palette.up : palette.down },
      })),
    },
  ];
  if (macdDif.some((v) => v != null && Number.isFinite(v))) {
    macdSeries.push({
      name: 'DIF',
      type: 'line',
      data: macdDif,
      showSymbol: false,
      lineStyle: { width: 1.5, color: palette.brand },
    });
  }
  if (macdDea.some((v) => v != null && Number.isFinite(v))) {
    macdSeries.push({
      name: 'DEA',
      type: 'line',
      data: macdDea,
      showSymbol: false,
      lineStyle: { width: 1.5, color: palette.tickMuted },
    });
  }

  const macdOption: EChartsOption | null = hasMacdData
    ? {
        animation: false,
        grid: { left: 40, right: 16, top: 24, bottom: 24 },
        tooltip: { trigger: 'axis' },
        legend: { top: 0, textStyle: { color: palette.tick, fontSize: 10 } },
        xAxis: {
          type: 'category',
          data: dates,
          axisLabel: { color: palette.tickMuted, fontSize: 10 },
          axisLine: { lineStyle: { color: palette.grid } },
        },
        yAxis: {
          type: 'value',
          axisLabel: { color: palette.tickMuted, fontSize: 10 },
          splitLine: { lineStyle: { color: palette.gridSubtle } },
        },
        series: macdSeries,
      }
    : null;

  return {
    rsiOption: hasRsiData ? rsiOption : null,
    macdOption,
    hasRsiData,
    hasMacdData,
  };
}

export function indicatorsToKdOptions(
  rows: TechnicalIndicatorDayRow[],
  isDark: boolean,
): { option: EChartsOption | null; hasData: boolean } {
  if (!rows.length) return { option: null, hasData: false };
  const palette = getChartPalette(isDark);
  const dates = rows.map((r) => r.date);
  const k = rows.map((r) => r.kd_k9 ?? null);
  const d = rows.map((r) => r.kd_d9 ?? null);
  const hasData = [...k, ...d].some((v) => v != null && Number.isFinite(v));
  if (!hasData) return { option: null, hasData: false };

  return {
    hasData: true,
    option: {
      animation: false,
      grid: { left: 40, right: 16, top: 24, bottom: 24 },
      tooltip: { trigger: 'axis' },
      legend: { top: 0, textStyle: { color: palette.tick, fontSize: 10 } },
      xAxis: {
        type: 'category',
        data: dates,
        axisLabel: { color: palette.tickMuted, fontSize: 10 },
        axisLine: { lineStyle: { color: palette.grid } },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        axisLabel: { color: palette.tickMuted, fontSize: 10 },
        splitLine: { lineStyle: { color: palette.gridSubtle } },
      },
      series: [
        {
          name: 'K',
          type: 'line',
          data: k,
          showSymbol: false,
          lineStyle: { width: 2, color: palette.up },
        },
        {
          name: 'D',
          type: 'line',
          data: d,
          showSymbol: false,
          lineStyle: { width: 2, color: palette.brand },
        },
      ],
    },
  };
}

export function indicatorsToBollOptions(
  rows: TechnicalIndicatorDayRow[],
  isDark: boolean,
): { option: EChartsOption | null; hasData: boolean } {
  if (!rows.length) return { option: null, hasData: false };
  const palette = getChartPalette(isDark);
  const dates = rows.map((r) => r.date);
  const upper = rows.map((r) => r.boll_upper20 ?? null);
  const mid = rows.map((r) => r.boll_mid20 ?? null);
  const lower = rows.map((r) => r.boll_lower20 ?? null);
  const hasData = [...upper, ...mid, ...lower].some((v) => v != null && Number.isFinite(v));
  if (!hasData) return { option: null, hasData: false };

  return {
    hasData: true,
    option: {
      animation: false,
      grid: { left: 40, right: 16, top: 24, bottom: 24 },
      tooltip: { trigger: 'axis' },
      legend: { top: 0, textStyle: { color: palette.tick, fontSize: 10 } },
      xAxis: {
        type: 'category',
        data: dates,
        axisLabel: { color: palette.tickMuted, fontSize: 10 },
        axisLine: { lineStyle: { color: palette.grid } },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: palette.tickMuted, fontSize: 10 },
        splitLine: { lineStyle: { color: palette.gridSubtle } },
      },
      series: [
        {
          name: '上軌',
          type: 'line',
          data: upper,
          showSymbol: false,
          lineStyle: { width: 1, color: palette.up, type: 'dashed' },
        },
        {
          name: '中軌',
          type: 'line',
          data: mid,
          showSymbol: false,
          lineStyle: { width: 2, color: palette.brand },
        },
        {
          name: '下軌',
          type: 'line',
          data: lower,
          showSymbol: false,
          lineStyle: { width: 1, color: palette.down, type: 'dashed' },
        },
      ],
    },
  };
}

export function institutionalToCumulativeOption(
  data: InstitutionalTradeListResponse | null,
  isDark: boolean,
): EChartsOption | null {
  if (!data?.data?.length) return null;
  const palette = getChartPalette(isDark);
  const sorted = [...data.data].sort((a, b) => a.date.localeCompare(b.date)).slice(-30);
  let cumulative = 0;
  const points = sorted.map((row) => {
    cumulative += row.total_net ?? 0;
    return cumulative;
  });

  return {
    animation: false,
    grid: { left: 48, right: 16, top: 24, bottom: 28 },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: sorted.map((r) => r.date),
      axisLabel: { color: palette.tickMuted, fontSize: 10 },
      axisLine: { lineStyle: { color: palette.grid } },
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        ...institutionalYAxisLabel,
        color: palette.tickMuted,
      },
      splitLine: { lineStyle: { color: palette.gridSubtle } },
    },
    series: [
      {
        name: '累積買賣超',
        type: 'line',
        data: points,
        showSymbol: false,
        areaStyle: { opacity: 0.12, color: palette.brand },
        lineStyle: { width: 2, color: palette.brand },
      },
    ],
  };
}

export function chipsVolumeToChartOption(
  rows: import('../types').ChipsVolumeChartRow[],
  isDark: boolean,
): EChartsOption | null {
  if (!rows.length) return null;
  const palette = getChartPalette(isDark);
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date)).slice(-30);
  const dates = sorted.map((r) => r.date);

  return {
    animation: false,
    grid: { left: 48, right: 48, top: 32, bottom: 28 },
    tooltip: { trigger: 'axis' },
    legend: { top: 0, textStyle: { color: palette.tick, fontSize: 10 } },
    xAxis: {
      type: 'category',
      data: dates,
      axisLabel: { color: palette.tickMuted, fontSize: 10 },
      axisLine: { lineStyle: { color: palette.grid } },
    },
    yAxis: [
      {
        type: 'value',
        name: '收盤',
        position: 'left',
        axisLabel: { color: palette.tickMuted, fontSize: 10 },
        splitLine: { lineStyle: { color: palette.gridSubtle } },
      },
      {
        type: 'value',
        name: '法人（股）',
        position: 'right',
        axisLabel: {
          ...institutionalYAxisLabel,
          color: palette.tickMuted,
        },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: '收盤價',
        type: 'line',
        yAxisIndex: 0,
        data: sorted.map((r) => r.close ?? null),
        showSymbol: false,
        lineStyle: { width: 2, color: palette.brand },
      },
      {
        name: '法人合計',
        type: 'bar',
        yAxisIndex: 1,
        data: sorted.map((r) => {
          const v = r.total_institutional_net ?? 0;
          return {
            value: v,
            itemStyle: { color: v >= 0 ? palette.up : palette.down },
          };
        }),
      },
    ],
  };
}
