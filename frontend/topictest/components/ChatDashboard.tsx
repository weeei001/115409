import React, { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import { getChartPalette, MA_LINE_COLORS } from '../lib/chartTheme';
import { useTheme } from '../lib/ThemeContext';
import {
  safeDashboardUrl,
  type ChatDashboard as ChatDashboardData,
  type ChatDashboardBlock,
  type DashboardChart,
} from '../lib/types/chatDashboard';
import { EChartPanel } from './charts/EChartPanel';

const numberFormat = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 4 });

function formatValue(value: number | null | undefined, unit = ''): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '無資料';
  return `${numberFormat.format(value)}${unit ? ` ${unit}` : ''}`;
}

function DataTable({ title, columns, rows }: { title: string; columns: string[]; rows: string[][] }) {
  if (!columns.length || !rows.length) return <p className="text-sm text-[var(--color-text-muted)]">無資料</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--color-border)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand" role="region" aria-label={`${title}資料表`} tabIndex={0}>
      <table className="w-full text-left text-xs sm:text-sm">
        <caption className="sr-only">{title}</caption>
        <thead className="bg-[var(--color-bg-elevated)]">
          <tr>{columns.map((column, index) => <th key={index} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">{column}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-[var(--color-border)]">
              {columns.map((_, column) => <td key={column} className="whitespace-nowrap px-3 py-2 tabular-nums">{row[column]?.trim() || '無資料'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChartBlock({ block }: { block: DashboardChart }) {
  const { theme } = useTheme();
  const option = useMemo<EChartsOption>(() => {
    const palette = getChartPalette(theme === 'dark');
    return {
      animation: false,
      color: Object.values(MA_LINE_COLORS),
      grid: { left: 12, right: 18, top: 32, bottom: 56, containLabel: true },
      tooltip: {
        trigger: 'axis', renderMode: 'richText', confine: true,
        backgroundColor: palette.tooltipBg, borderColor: palette.grid,
        textStyle: { color: palette.tooltipText, fontSize: 12 },
        valueFormatter: (value) => formatValue(typeof value === 'number' ? value : null, block.unit),
      },
      legend: { type: 'scroll', bottom: 0, textStyle: { color: palette.tick, fontSize: 11 } },
      xAxis: {
        type: 'category', data: block.dates,
        axisLine: { lineStyle: { color: palette.grid } },
        axisLabel: { color: palette.tick, fontSize: 11, hideOverlap: true },
      },
      yAxis: {
        type: 'value', name: block.unit, scale: true,
        nameTextStyle: { color: palette.tick },
        axisLabel: { color: palette.tick, fontSize: 11 },
        splitLine: { lineStyle: { color: palette.grid } },
      },
      series: block.series.map((series) => ({
        name: series.name, type: 'line', smooth: false, connectNulls: false,
        showSymbol: true, symbolSize: 4,
        data: block.dates.map((_, index) => {
          const value = series.values[index];
          return typeof value === 'number' && Number.isFinite(value) ? value : null;
        }),
      })),
    };
  }, [block, theme]);
  const hasData = block.dates.some((_, index) => block.series.some((series) =>
    typeof series.values[index] === 'number' && Number.isFinite(series.values[index])));

  return (
    <div className="min-w-0 space-y-3">
      <p className="text-xs text-[var(--color-text-muted)]">
        {block.dates.length ? `${block.dates[0]} 至 ${block.dates[block.dates.length - 1]}` : '無日期資料'}
        {block.unit ? ` · 單位：${block.unit}` : ''}
      </p>
      {hasData ? <EChartPanel title={block.title} option={option} height={280} bare /> :
        <p className="py-5 text-sm text-[var(--color-text-muted)]">此區間無可繪製資料</p>}
      <details className="text-sm">
        <summary className="min-h-[44px] cursor-pointer py-3 text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">查看圖表資料</summary>
        <DataTable title={block.title} columns={['日期', ...block.series.map((series) => series.name)]}
          rows={block.dates.map((date, index) => [date, ...block.series.map((series) => formatValue(series.values[index], block.unit))])} />
      </details>
    </div>
  );
}

function BlockContent({ block }: { block: ChatDashboardBlock }) {
  switch (block.kind) {
    case 'metrics':
      return block.items.length ? (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {block.items.map((item, index) => (
            <div key={index} className="min-w-0 rounded-xl bg-[var(--color-bg-elevated)] px-3 py-3">
              <dt className="text-xs text-[var(--color-text-muted)]">{item.label}{item.unit ? `（${item.unit}）` : ''}</dt>
              <dd className="mt-1 break-words text-lg font-semibold tabular-nums text-[var(--color-text-primary)]">{formatValue(item.value)}</dd>
              {item.date && <dd className="mt-1 text-[11px] text-[var(--color-text-muted)]">資料日期：{item.date}</dd>}
            </div>
          ))}
        </dl>
      ) : <p className="text-sm text-[var(--color-text-muted)]">無資料</p>;
    case 'chart':
      return <ChartBlock block={block} />;
    case 'table':
      return <DataTable title={block.title} columns={block.columns} rows={block.rows} />;
    case 'news':
      return block.items.length ? (
        <ul className="divide-y divide-[var(--color-border)]">
          {block.items.map((item, index) => {
            const url = safeDashboardUrl(item.url);
            return (
              <li key={`${item.source_id}-${index}`} className="space-y-2 py-3 first:pt-0 last:pb-0">
                <p className="break-words text-sm font-medium leading-relaxed">
                  {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="text-brand underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">{item.title}</a> : item.title}
                </p>
                <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--color-text-muted)]">
                  {item.publisher && <span>{item.publisher}</span>}
                  {item.published_at && <span>{item.published_at}</span>}
                  <span>[{item.source_id}]</span>
                </p>
              </li>
            );
          })}
        </ul>
      ) : <p className="text-sm text-[var(--color-text-muted)]">無相關新聞資料</p>;
  }
}

export const ChatDashboard: React.FC<{ dashboard: ChatDashboardData }> = ({ dashboard }) => (
  <section className="min-w-0 space-y-4" aria-label={dashboard.title}>
    <h3 className="text-base font-semibold text-[var(--color-text-primary)]">{dashboard.title}</h3>
    {dashboard.blocks.map((block, index) => (
      <section key={`${block.kind}-${index}`} className="min-w-0 space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-3 sm:p-4" aria-label={block.title}>
        <header className="space-y-1">
          <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">{block.title}</h4>
          {block.description && <p className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--color-text-muted)]">{block.description}</p>}
        </header>
        <BlockContent block={block} />
        {block.source_ids.length > 0 && <p className="break-words border-t border-[var(--color-border)] pt-2 text-[11px] text-[var(--color-text-muted)]">資料來源：{block.source_ids.map((id) => `[${id}]`).join(' ')}</p>}
      </section>
    ))}
  </section>
);
