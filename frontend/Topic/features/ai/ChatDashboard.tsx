import React, { useMemo } from 'react';
import Link from 'next/link';
import type { EChartsOption } from '@/lib/charts/echarts';
import { getChartPalette, SERIES_PALETTE } from '@/lib/charts/theme';
import { useTheme } from '@/lib/theme/ThemeContext';
import type { ChatDashboard as ChatDashboardData, ChatDashboardBlock, DashboardChart } from '@/lib/types/chatDashboard';
import { safeHttpUrl } from '@/lib/utils/url';
import { EChart } from '@/components/charts/EChart';

const numberFormat = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 4 });

function formatValue(value: number | null | undefined, unit = ''): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '無資料';
  return `${numberFormat.format(value)}${unit ? ` ${unit}` : ''}`;
}

function DataTable({ title, columns, rows }: { title: string; columns: string[]; rows: string[][] }) {
  if (!columns.length || !rows.length) return <p className="text-sm text-muted-foreground">無資料</p>;
  return (
    <div className="overflow-x-auto rounded-lg border" role="region" aria-label={`${title}資料表`} tabIndex={0}>
      <table className="w-full text-left text-xs sm:text-sm">
        <caption className="sr-only">{title}</caption>
        <thead className="bg-muted">
          <tr>
            {columns.map((column, index) => (
              <th key={index} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t">
              {columns.map((_, column) => (
                <td key={column} className="px-3 py-2 whitespace-nowrap tabular-nums">
                  {row[column]?.trim() || '無資料'}
                </td>
              ))}
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
      color: [...SERIES_PALETTE],
      grid: { left: 12, right: 18, top: 32, bottom: 56, containLabel: true },
      tooltip: {
        trigger: 'axis',
        renderMode: 'richText',
        confine: true,
        backgroundColor: palette.tooltipBg,
        borderColor: palette.tooltipBorder,
        textStyle: { color: palette.tooltipText, fontSize: 12 },
        valueFormatter: (value) => formatValue(typeof value === 'number' ? value : null, block.unit),
      },
      legend: { type: 'scroll', bottom: 0, textStyle: { color: palette.tick, fontSize: 11 } },
      xAxis: {
        type: 'category',
        data: block.dates,
        axisLine: { lineStyle: { color: palette.grid } },
        axisLabel: { color: palette.tick, fontSize: 11, hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        name: block.unit,
        scale: true,
        nameTextStyle: { color: palette.tick },
        axisLabel: { color: palette.tick, fontSize: 11 },
        splitLine: { lineStyle: { color: palette.gridSubtle } },
      },
      series: block.series.map((series) => ({
        name: series.name,
        type: 'line',
        smooth: false,
        connectNulls: false,
        showSymbol: true,
        symbolSize: 4,
        data: block.dates.map((_, index) => {
          const value = series.values[index];
          return typeof value === 'number' && Number.isFinite(value) ? value : null;
        }),
      })),
    };
  }, [block, theme]);
  const hasData = block.dates.some((_, index) => block.series.some((series) => typeof series.values[index] === 'number' && Number.isFinite(series.values[index])));

  return (
    <div className="min-w-0 space-y-3">
      <p className="text-xs text-muted-foreground">
        {block.dates.length ? `${block.dates[0]} 至 ${block.dates[block.dates.length - 1]}` : '無日期資料'}
        {block.unit ? ` · 單位：${block.unit}` : ''}
      </p>
      {hasData ? <EChart title={block.title} option={option} height={280} /> : <p className="py-5 text-sm text-muted-foreground">此區間無可繪製資料</p>}
      <details className="text-sm">
        <summary className="min-h-11 cursor-pointer py-3 text-brand-text">查看圖表資料</summary>
        <DataTable
          title={block.title}
          columns={['日期', ...block.series.map((series) => series.name)]}
          rows={block.dates.map((date, index) => [date, ...block.series.map((series) => formatValue(series.values[index], block.unit))])}
        />
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
            <div key={index} className="min-w-0 rounded-lg bg-muted px-3 py-3">
              <dt className="text-xs text-muted-foreground">
                {item.label}
                {item.unit ? `（${item.unit}）` : ''}
              </dt>
              <dd className="mt-1 text-lg font-semibold break-words text-foreground tabular-nums">{formatValue(item.value)}</dd>
              {item.date ? <dd className="mt-1 text-[11px] text-muted-foreground">資料日期：{item.date}</dd> : null}
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">無資料</p>
      );
    case 'chart':
      return <ChartBlock block={block} />;
    case 'table':
      return <DataTable title={block.title} columns={block.columns} rows={block.rows} />;
    case 'news':
      return block.items.length ? (
        <ul className="divide-y">
          {block.items.map((item, index) => {
            const url = safeHttpUrl(item.url);
            const newsPath = item.article_id?.trim() ? `/news/${encodeURIComponent(item.article_id)}` : '';
            const linkClass = 'text-brand-text underline-offset-4 hover:underline';
            return (
              <li key={`${item.source_id}-${index}`} className="space-y-2 py-3 first:pt-0 last:pb-0">
                <p className="text-sm leading-relaxed font-medium break-words">
                  {newsPath ? (
                    <Link href={newsPath} className={linkClass}>
                      {item.title}
                    </Link>
                  ) : url ? (
                    <a href={url} target="_blank" rel="noopener noreferrer" className={linkClass}>
                      {item.title}
                    </a>
                  ) : (
                    item.title
                  )}
                </p>
                <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {item.publisher ? <span>{item.publisher}</span> : null}
                  {item.published_at ? <span>{item.published_at}</span> : null}
                  <span>[{item.source_id}]</span>
                </p>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">無相關新聞資料</p>
      );
  }
}

/** AI 回覆的資料面板：指標、折線圖、表格、新聞；每區塊列出資料來源 */
export function ChatDashboard({ dashboard }: { dashboard: ChatDashboardData }) {
  return (
    <section className="min-w-0 space-y-4" aria-label={dashboard.title}>
      <h3 className="text-base font-semibold">{dashboard.title}</h3>
      {dashboard.blocks.map((block, index) => (
        <section key={`${block.kind}-${index}`} className="min-w-0 space-y-3 rounded-lg border bg-card p-3 sm:p-4" aria-label={block.title}>
          <header className="space-y-1">
            <h4 className="text-sm font-semibold">{block.title}</h4>
            {block.description ? <p className="text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">{block.description}</p> : null}
          </header>
          <BlockContent block={block} />
          {block.source_ids.length > 0 ? (
            <p className="border-t pt-2 text-[11px] break-words text-muted-foreground">資料來源：{block.source_ids.map((id) => `[${id}]`).join(' ')}</p>
          ) : null}
        </section>
      ))}
    </section>
  );
}
