import React from 'react';
import type { PriceChangeResponse, VolumeAnalysisResponse } from '@/lib/types/api';
import type { PriceStats } from '@/lib/types/view';
import type { HistoryPage } from '@/lib/hooks/useStockDashboard';
import { fmtAmount, fmtNum, fmtPrice, fmtVolume } from '@/lib/utils/format';
import { signedText } from '@/components/common/LightEntry';
import { valueToneText } from '@/lib/utils/tone';
import { CollapsibleTableSection, TableScrollHint } from '@/components/common/CollapsibleSection';
import { Ledger } from '@/components/common/Ledger';
import { EmptyState, LoadingRows, Notice } from '@/components/common/Notice';
import { Pagination } from '@/components/common/Pagination';
import { cn } from '@/lib/cn';

const RECENT_ROWS = 15;
const th = 'h-11 px-3 py-2.5 text-right font-medium';
const td = 'h-11 px-3 py-2 text-right font-mono text-[13.5px] tabular-nums';
const tdDate = 'h-11 px-3 py-2 font-mono text-[13.5px] tabular-nums';
const headRow = 'border-b border-border-strong bg-muted text-xs text-muted-foreground';

/** 表格的圖說：用表上實際列出的列（最多最近 15 筆）寫首尾日期與筆數；rows 由新到舊 */
function rowsSpan(rows: Array<{ date: string }>): string {
  if (!rows.length) return '無資料';
  return `${rows[rows.length - 1].date} → ${rows[0].date}，共 ${rows.length} 個交易日`;
}

function TableFrame({ minWidth, children }: { minWidth: string; children: React.ReactNode }) {
  return (
    <>
      <TableScrollHint />
      <div className="overflow-x-auto overscroll-x-contain border">
        <table className={cn('w-full text-sm', minWidth)}>{children}</table>
      </div>
    </>
  );
}

/** 量能統計（所選日期區間）：最近 15 筆 */
export function VolumeTable({ data }: { data: VolumeAnalysisResponse | null }) {
  if (!data?.data?.length) return null;
  const rows = [...data.data].sort((a, b) => b.date.localeCompare(a.date)).slice(0, RECENT_ROWS);
  return (
    <CollapsibleTableSection
      title="量能統計（所選日期區間）"
      subtitle={`表列 ${rowsSpan(rows)}；含成交金額與漲跌。`}
      expandLabel={`顯示量能明細（${rows.length} 筆）`}
      collapseLabel="收合量能明細"
    >
      <TableFrame minWidth="min-w-[520px]">
        <thead>
          <tr className={headRow}>
            <th className="h-11 px-3 py-2.5 text-left font-medium">日期</th>
            <th className={th}>成交量</th>
            <th className={th}>成交金額</th>
            <th className={th}>收盤</th>
            <th className={th}>漲跌</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.date} className="border-t">
              <td className={tdDate}>{row.date}</td>
              <td className={td}>{fmtVolume(row.volume)}</td>
              <td className={td}>{fmtAmount(row.amount)}</td>
              <td className={td}>{fmtPrice(row.close)}</td>
              <td className={cn(td, valueToneText(row.change))}>{signedText(row.change)}</td>
            </tr>
          ))}
        </tbody>
      </TableFrame>
    </CollapsibleTableSection>
  );
}

/** 漲跌明細：最近 15 筆 */
export function PriceChangeTable({ data }: { data: PriceChangeResponse | null }) {
  if (!data?.data?.length) return <EmptyState className="py-4">尚無漲跌明細資料</EmptyState>;
  const rows = [...data.data].sort((a, b) => b.date.localeCompare(a.date)).slice(0, RECENT_ROWS);
  return (
    <CollapsibleTableSection title="漲跌明細" subtitle={`表列 ${rowsSpan(rows)}`} expandLabel={`顯示漲跌明細（${rows.length} 筆）`} collapseLabel="收合漲跌明細">
      <TableFrame minWidth="min-w-[400px]">
        <thead>
          <tr className={headRow}>
            <th className="h-11 px-3 py-2.5 text-left font-medium">日期</th>
            <th className={th}>收盤</th>
            <th className={th}>漲跌</th>
            <th className={th}>漲跌幅</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.date} className="border-t">
              <td className={tdDate}>{row.date}</td>
              <td className={td}>{fmtPrice(row.close)}</td>
              <td className={cn(td, valueToneText(row.change))}>{signedText(row.change)}</td>
              <td className={cn(td, valueToneText(row.change_percent))}>{signedText(row.change_percent, 2, '%')}</td>
            </tr>
          ))}
        </tbody>
      </TableFrame>
    </CollapsibleTableSection>
  );
}

/** 所選日期區間的統計 6 格；最高／最低是價格不是漲跌，不上漲跌色（決議 D8-c6）。數字與單位不拆行 */
export function StatisticsPanel({ stats }: { stats: PriceStats }) {
  const items = [
    { label: '最高價', value: fmtPrice(stats.highest_price) },
    { label: '最低價', value: fmtPrice(stats.lowest_price) },
    { label: '平均收盤價', value: fmtPrice(stats.average_close) },
    { label: '總成交量', value: fmtVolume(stats.total_volume) },
    { label: '總成交金額', value: fmtAmount(stats.total_amount) },
    { label: '交易天數', value: `${stats.trading_days} 天` },
  ];
  return (
    <Ledger
      as="h3"
      aria-label="所選日期區間統計"
      title="所選日期區間統計"
      stamp={`查詢 ${stats.start_date} → ${stats.end_date} · ${stats.trading_days} 個交易日`}
      cols="grid-cols-2 lg:grid-cols-3"
    >
      {items.map(({ label, value }) => (
        <dl key={label} data-stagger className="flex min-h-11 min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-0.5 bg-card px-4 py-2.5">
          <dt className="text-[13px] text-subtle">{label}</dt>
          <dd className="ml-auto font-mono text-[15px] font-semibold whitespace-nowrap tabular-nums">{value}</dd>
        </dl>
      ))}
    </Ledger>
  );
}

interface HistoryProps {
  data: HistoryPage | null;
  loading?: boolean;
  error?: string | null;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

/** 歷史股價（全部歷史，依頁數往回翻；決議 c23 移到價量抽屜） */
export function HistoryTable({ data, loading = false, error, page, pageSize, onPageChange }: HistoryProps) {
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
  return (
    <CollapsibleTableSection
      title={data ? `歷史股價（共 ${data.total} 筆）` : '歷史股價'}
      expandLabel={data ? `顯示歷史股價表（第 ${page}/${totalPages} 頁）` : '顯示歷史股價表'}
      collapseLabel="收合歷史股價表"
    >
      {data ? <Pagination label="歷史股價分頁" page={page} totalPages={totalPages} onPageChange={onPageChange} disabled={loading} /> : null}
      {loading ? <LoadingRows label="讀取歷史股價中…" className="h-[132px] border-y" />
        : error ? <Notice tone="danger">{error}</Notice>
        : data ? <TableFrame minWidth="min-w-[640px]">
        <thead>
          <tr className={headRow}>
            <th scope="col" className="h-11 px-4 py-3 text-left font-medium">日期</th>
            {['開盤', '最高', '最低', '收盤', '漲跌', '成交量（股）', '成交金額'].map((h) => (
              <th key={h} scope="col" className="px-4 py-3 text-right font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, i) => (
            <tr key={`${row.date}-${i}`} className="h-11 border-t transition-colors duration-(--dur-flash) hover:bg-accent">
              <td className="px-4 py-2.5 font-mono text-muted-foreground">{row.date}</td>
              <td className="px-4 py-2.5 text-right font-mono">{fmtPrice(row.open)}</td>
              <td className="px-4 py-2.5 text-right font-mono">{fmtPrice(row.high)}</td>
              <td className="px-4 py-2.5 text-right font-mono">{fmtPrice(row.low)}</td>
              <td className="px-4 py-2.5 text-right font-mono font-semibold">{fmtPrice(row.close)}</td>
              <td className={cn('px-4 py-2.5 text-right font-mono', valueToneText(row.change))}>{signedText(row.change)}</td>
              <td className="px-4 py-2.5 text-right font-mono text-muted-foreground tabular-nums">{fmtNum(row.volume_shares)}</td>
              <td className="px-4 py-2.5 text-right font-mono text-muted-foreground tabular-nums">
                {row.amount != null ? `${(row.amount / 1e8).toFixed(2)} 億元` : '--'}
              </td>
            </tr>
          ))}
          {data.rows.length === 0 ? (
            <tr>
              <td colSpan={8} className="py-8 text-center text-muted-foreground">
                無歷史資料
              </td>
            </tr>
          ) : null}
        </tbody>
      </TableFrame> : <EmptyState className="py-8">無歷史資料</EmptyState>}
    </CollapsibleTableSection>
  );
}
