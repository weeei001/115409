import React, { useMemo } from 'react';
import Link from 'next/link';
import type { EChartsOption } from '@/lib/charts/echarts';
import { getChartPalette, AI_SERIES_PALETTE } from '@/lib/charts/theme';
import { baseAxis, chartGrid, legend, lineLook, tooltip, valueAxis } from '@/lib/charts/adapters';
import { getValueTone, toneText, type ValueTone } from '@/lib/utils/tone';
import { useTheme } from '@/lib/theme/ThemeContext';
import type { ChatDashboard as ChatDashboardData, ChatDashboardBlock, DashboardChart } from '@/lib/types/chatDashboard';
import { safeHttpUrl } from '@/lib/utils/url';
import { EChart } from '@/components/charts/EChart';
import { EmptyState } from '@/components/common/Notice';
import { cn } from '@/lib/cn';

const numberFormat = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 4 });

function formatValue(value: number | null | undefined, unit = ''): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '無資料';
  return `${numberFormat.format(value)}${unit ? ` ${unit}` : ''}`;
}

/**
 * 帶方向的指標（報酬、漲跌、買賣超、增減）：依正負上漲跌色，並一律帶正負號（DESIGN.md 第 7 節，負號同 signedText 用 U+2212）。
 * 其餘指標（收盤、量、比率）維持中性。只看標籤文字，不改數值。
 */
const DIRECTIONAL_LABEL = /報酬|漲跌|漲幅|跌幅|買賣超|淨買|淨賣|增減/;

function isDirectional(label: string): boolean {
  return DIRECTIONAL_LABEL.test(label);
}

function formatSignedValue(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '無資料';
  const body = numberFormat.format(Math.abs(value));
  return value > 0 ? `+${body}` : value < 0 ? `−${body}` : body;
}

/**
 * 表格格子是後端給的字串。帶方向的欄位（欄名含報酬、漲跌…）裡、只有一個數字（可帶 %）的格子，
 * 和指標格同一套寫法：依正負上漲跌色、一律帶正負號、負號用 U+2212。其餘格子原樣顯示。
 */
const SIGNED_CELL = /^([+\-−]?)\s*(\d[\d,]*(?:\.\d+)?)\s*(%?)$/;

function directionalCell(text: string): { text: string; tone: ValueTone } | null {
  const match = text.match(SIGNED_CELL);
  if (!match) return null;
  const magnitude = Number(match[2].replace(/,/g, ''));
  if (!Number.isFinite(magnitude)) return null;
  const negative = match[1] === '-' || match[1] === '−';
  const value = magnitude === 0 ? 0 : negative ? -magnitude : magnitude;
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return { text: `${sign}${match[2]}${match[3]}`, tone: getValueTone(value) };
}

/** 最後一格補滿該列，避免 gap-px 的底色露出成灰塊（手機 2 欄、sm 以上 3 欄） */
function lastCellSpan(count: number): string {
  const base = count % 2 === 1 ? 'col-span-2' : 'col-span-1';
  const sm = { 0: 'sm:col-span-1', 1: 'sm:col-span-3', 2: 'sm:col-span-2' }[count % 3];
  return `${base} ${sm}`;
}

function DataTable({ title, columns, rows }: { title: string; columns: string[]; rows: string[][] }) {
  if (!columns.length || !rows.length) return <EmptyState className="py-5">無資料</EmptyState>;
  return (
    <div className="overflow-x-auto border" role="region" aria-label={`${title}資料表`} tabIndex={0}>
      <table className="w-full text-left text-[13px]">
        <caption className="sr-only">{title}</caption>
        <thead className="border-b border-border-strong bg-muted">
          <tr>
            {columns.map((column, index) => (
              <th key={index} scope="col" className="h-10 px-3 text-xs font-medium tracking-[0.06em] whitespace-nowrap text-muted-foreground">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t first:border-t-0">
              {columns.map((name, column) => {
                const raw = row[column]?.trim() || '';
                const signed = raw && isDirectional(name) ? directionalCell(raw) : null;
                return (
                  <td key={column} className={cn('h-11 px-3 font-mono whitespace-nowrap tabular-nums', signed && signed.tone !== 'neutral' && toneText(signed.tone))}>
                    {signed ? signed.text : raw || '無資料'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * AI 圖表的類別色：取 AI_SERIES_PALETTE，但跳過橘、琥珀、褐（會被看成燈色）與桃紅（會被看成漲色），
 * 讓燈色只留給選取列與送出鈕（DESIGN.md 第 1 節第 3 點）。
 */
const AI_SERIES_COLORS = AI_SERIES_PALETTE;

/**
 * 序列水準相差超過這個倍數，就改畫「以第一筆為 100」（同多股比較的航跡圖）。
 * 1.5 倍時共用一個價格軸，每條線只佔軸高的一小段、看起來是平線，比較不出走勢。
 */
const REBASE_RATIO = 1.5;

/**
 * 要不要指數化：兩條以上、每個數值都是正數（價格類），而且在第一個共同有值的日期，最高與最低相差超過 1.5 倍。
 * 回傳那個共同日期的索引；不需要時回傳 null。只用面板裡已有的數值，不另外抓資料。
 */
export function chatChartRebaseIndex(block: DashboardChart): number | null {
  const plotted = block.series.filter((s) => s.values.some(isFiniteNumber));
  if (plotted.length < 2) return null;
  if (!plotted.every((s) => s.values.every((v) => v === null || v === undefined || (isFiniteNumber(v) && v > 0)))) return null;
  const index = block.dates.findIndex((_, i) => plotted.every((s) => isFiniteNumber(s.values[i])));
  if (index < 0) return null;
  const levels = plotted.map((s) => s.values[index] as number);
  return Math.max(...levels) / Math.min(...levels) > REBASE_RATIO ? index : null;
}

export interface ChatChartView {
  option: EChartsOption;
  /** 指數化的基準日索引；null 表示畫原始數值 */
  rebaseIndex: number | null;
  /** 有畫出來（也列在圖例）的序列 */
  plotted: string[];
  /** 整段都沒有數值、沒畫也不列在圖例的序列 */
  missing: string[];
}

/**
 * AI 回覆的折線圖 option。圖例只列真的有畫線的序列；數值軸 scale: true 自動涵蓋所有序列，不設固定 min/max。
 * 與站內其他圖同一套語法（lib/charts/adapters 的共用軸、圖例、tooltip、折線樣式）。
 */
export function buildChatChartOption(block: DashboardChart, isDark: boolean): ChatChartView {
  const palette = getChartPalette(isDark);
  const rebaseIndex = chatChartRebaseIndex(block);
  const plottedSeries = block.series.filter((s) => s.values.some(isFiniteNumber));
  const series = plottedSeries.map((s, i) => {
    const base = rebaseIndex === null ? null : (s.values[rebaseIndex] as number);
    return {
      ...lineLook(AI_SERIES_COLORS[i % AI_SERIES_COLORS.length], 2),
      name: s.name,
      connectNulls: false,
      data: block.dates.map((_, index) => {
        const value = s.values[index];
        if (!isFiniteNumber(value)) return null;
        return base === null ? value : Math.round((value / base) * 10000) / 100;
      }),
    };
  });
  const unit = rebaseIndex === null ? block.unit : '';
  const option = {
    animation: false,
    grid: chartGrid({ top: unit ? 24 : 30, outerBoundsContain: 'all' }),
    tooltip: tooltip(palette, rebaseIndex === null
      ? { renderMode: 'richText', valueFormatter: (value: unknown) => formatValue(isFiniteNumber(value) ? value : null, block.unit) }
      : {
        renderMode: 'richText',
        // 指數化時同時寫出原始數值，tooltip 不只剩相對值
        formatter: (params: unknown) => {
          const items = (Array.isArray(params) ? params : [params]) as Array<{ seriesIndex?: number; dataIndex?: number; seriesName?: string; value?: unknown; axisValue?: string }>;
          const lines = items.map((item) => {
            const raw = plottedSeries[item.seriesIndex ?? -1]?.values[item.dataIndex ?? -1];
            return `${item.seriesName ?? ''}  ${isFiniteNumber(item.value) ? item.value.toFixed(2) : '無資料'}（${formatValue(raw, block.unit)}）`;
          });
          return [items[0]?.axisValue ?? '', ...lines].join('\n');
        },
      }),
    legend: legend(palette, series, { type: 'scroll' }),
    xAxis: { ...baseAxis(palette, block.dates), boundaryGap: false },
    yAxis: valueAxis(palette, { name: unit, nameGap: 8, nameTextStyle: { align: 'left' }, scale: true }),
    series,
  } as EChartsOption;
  return {
    option,
    rebaseIndex,
    plotted: plottedSeries.map((s) => s.name),
    missing: block.series.filter((s) => !s.values.some(isFiniteNumber)).map((s) => s.name),
  };
}

function ChartBlock({ block }: { block: DashboardChart }) {
  const { theme } = useTheme();
  const view = useMemo(() => buildChatChartOption(block, theme === 'dark'), [block, theme]);
  const hasData = view.plotted.length > 0;
  const range = block.dates.length ? `${block.dates[0]} 至 ${block.dates[block.dates.length - 1]}` : '無日期資料';
  // 燈質列分段不斷行：日期區間、刻度說明、缺資料的序列
  const parts = [
    range,
    view.rebaseIndex === null
      ? (block.unit ? `單位：${block.unit}` : '')
      : `${view.rebaseIndex === 0 ? '以第一筆為 100' : `以 ${block.dates[view.rebaseIndex]} 為 100`}${block.unit ? `（原始單位：${block.unit}）` : ''}`,
    hasData && view.missing.length ? `${view.missing.join('、')} 無可繪製資料` : '',
  ].filter(Boolean);

  return (
    <div className="min-w-0 space-y-3">
      <p className="characteristic flex flex-wrap gap-x-2">
        {parts.map((part, index) => (
          <span key={index} className="whitespace-nowrap">{index > 0 ? `· ${part}` : part}</span>
        ))}
      </p>
      {hasData ? <EChart title={block.title} option={view.option} height={280} className="min-h-[280px]" /> : <EmptyState className="border py-5">此區間無可繪製資料；可展開下方「查看圖表資料」核對原始數值。</EmptyState>}
      <details className="border-t text-sm">
        <summary className="flex min-h-11 cursor-pointer items-center text-subtle hover:text-foreground">查看圖表資料</summary>
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
        <dl className="grid grid-cols-2 gap-px border bg-border sm:grid-cols-3">
          {block.items.map((item, index) => (
            <div key={index} className={cn('min-w-0 bg-card px-3 py-2.5', index === block.items.length - 1 && lastCellSpan(block.items.length))}>
              <dt className="text-xs leading-relaxed text-muted-foreground">
                {item.label}
                {item.unit ? `（${item.unit}）` : ''}
              </dt>
              {isDirectional(item.label) ? (
                <dd className={cn('mt-1 font-mono text-lg font-semibold break-words tabular-nums', getValueTone(item.value) === 'neutral' ? 'text-foreground' : toneText(getValueTone(item.value)))}>
                  {formatSignedValue(item.value)}
                </dd>
              ) : (
                <dd className="mt-1 font-mono text-lg font-semibold break-words text-foreground tabular-nums">{formatValue(item.value)}</dd>
              )}
              {item.date ? <dd className="characteristic mt-1">資料日期：{item.date}</dd> : null}
            </div>
          ))}
        </dl>
      ) : (
        <EmptyState className="py-5">無資料</EmptyState>
      );
    case 'chart':
      return <ChartBlock block={block} />;
    case 'table':
      return <DataTable title={block.title} columns={block.columns} rows={block.rows} />;
    case 'news':
      return block.items.length ? (
        <ul className="divide-y border-t">
          {block.items.map((item, index) => {
            const url = safeHttpUrl(item.url);
            const newsPath = item.article_id?.trim() ? `/news/${encodeURIComponent(item.article_id)}` : '';
            const linkClass = 'text-foreground underline decoration-input underline-offset-4 hover:decoration-foreground';
            return (
              <li key={`${item.source_id}-${index}`} className="space-y-1 py-3">
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
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {item.publisher ? <span>{item.publisher}</span> : null}
                  {item.published_at ? <span className="font-mono tabular-nums">{item.published_at}</span> : null}
                  <SourceChip id={item.source_id} />
                </p>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState className="py-5">無相關新聞資料</EmptyState>
      );
  }
}

/** 來源編號：等寬小字、沒有框（不是連結，所以也不畫底線） */
function SourceChip({ id }: { id: string }) {
  return <span className="font-mono text-[11px] leading-5 text-subtle tabular-nums">[{id}]</span>;
}

/** AI 回覆的資料面板：指標、折線圖、表格、新聞；每區塊列出資料來源。帳頁語法：區塊之間 1px 線分隔 */
export function ChatDashboard({ dashboard }: { dashboard: ChatDashboardData }) {
  return (
    <section className="min-w-0" aria-label={dashboard.title}>
      <h3 className="border-b border-border-strong pb-2 font-serif text-lg leading-snug font-black tracking-[0.06em]">{dashboard.title}</h3>
      <div className="grid gap-px border-x border-b bg-border">
        {dashboard.blocks.map((block, index) => (
          <section key={`${block.kind}-${index}`} className="min-w-0 space-y-3 bg-card p-3 sm:p-4" aria-label={block.title}>
            <header className="space-y-1">
              <h4 className="text-[13px] font-medium tracking-[0.04em] text-muted-foreground">{block.title}</h4>
              {block.description ? <p className="text-xs leading-relaxed whitespace-pre-wrap text-subtle">{block.description}</p> : null}
            </header>
            <BlockContent block={block} />
            {block.source_ids.length > 0 ? (
              <p className="flex flex-wrap items-center gap-x-2 border-t pt-2 text-[11px] break-words text-muted-foreground">
                <span>資料來源：</span>
                {block.source_ids.map((id, i) => <SourceChip key={`${id}-${i}`} id={id} />)}
              </p>
            ) : null}
          </section>
        ))}
      </div>
    </section>
  );
}
