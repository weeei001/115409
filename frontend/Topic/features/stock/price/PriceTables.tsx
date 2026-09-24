import React from 'react';
import { ArrowDownRight, ArrowUpRight, BarChart3, Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import type { PriceChangeResponse, VolumeAnalysisResponse } from '@/lib/types/api';
import type { PriceStats } from '@/lib/types/view';
import type { HistoryPage } from '@/lib/hooks/useStockDashboard';
import { fmtAmount, fmtNum, fmtPercent, fmtPrice, fmtSigned, fmtVolume } from '@/lib/utils/format';
import { valueToneText } from '@/lib/utils/tone';
import { CollapsibleTableSection, TableScrollHint } from '@/components/common/CollapsibleSection';
import { EmptyState } from '@/components/common/Notice';
import { cn } from '@/lib/cn';

const RECENT_ROWS = 15;
const th = 'px-3 py-2 text-right font-medium';
const td = 'px-3 py-2 text-right font-mono tabular-nums';

function TableFrame({ minWidth, children }: { minWidth: string; children: React.ReactNode }) {
  return (
    <>
      <TableScrollHint />
      <div className="overflow-x-auto overscroll-x-contain rounded-lg border">
        <table className={cn('w-full text-sm', minWidth)}>{children}</table>
      </div>
    </>
  );
}

/** 區間量能統計：最近 15 筆 */
export function VolumeTable({ data }: { data: VolumeAnalysisResponse | null }) {
  if (!data?.data?.length) return null;
  const rows = [...data.data].sort((a, b) => b.date.localeCompare(a.date)).slice(0, RECENT_ROWS);
  return (
    <CollapsibleTableSection
      title="區間量能統計"
      subtitle="與 K 線成交量來源相同區間，含成交金額與漲跌。"
      expandLabel={`顯示量能明細（${rows.length} 筆）`}
      collapseLabel="收合量能明細"
    >
      <TableFrame minWidth="min-w-[520px]">
        <thead>
          <tr className="bg-muted text-xs text-muted-foreground">
            <th className="px-3 py-2 text-left font-medium">日期</th>
            <th className={th}>成交量</th>
            <th className={th}>成交金額</th>
            <th className={th}>收盤</th>
            <th className={th}>漲跌</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.date} className="border-t">
              <td className="px-3 py-2 tabular-nums">{row.date}</td>
              <td className={td}>{fmtVolume(row.volume)}</td>
              <td className={td}>{fmtAmount(row.amount)}</td>
              <td className={td}>{fmtPrice(row.close)}</td>
              <td className={cn(td, valueToneText(row.change))}>{fmtSigned(row.change)}</td>
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
    <CollapsibleTableSection title="漲跌明細" expandLabel={`顯示漲跌明細（${rows.length} 筆）`} collapseLabel="收合漲跌明細">
      <TableFrame minWidth="min-w-[400px]">
        <thead>
          <tr className="bg-muted text-xs text-muted-foreground">
            <th className="px-3 py-2 text-left font-medium">日期</th>
            <th className={th}>收盤</th>
            <th className={th}>漲跌</th>
            <th className={th}>漲跌幅</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.date} className="border-t">
              <td className="px-3 py-2 tabular-nums">{row.date}</td>
              <td className={td}>{fmtPrice(row.close)}</td>
              <td className={cn(td, valueToneText(row.change))}>{fmtSigned(row.change)}</td>
              <td className={cn(td, valueToneText(row.change_percent))}>{fmtPercent(row.change_percent, { sign: true })}</td>
            </tr>
          ))}
        </tbody>
      </TableFrame>
    </CollapsibleTableSection>
  );
}

/** 區間統計 6 格；最高／最低是價格不是漲跌，不上漲跌色（決議 D8-c6） */
export function StatisticsPanel({ stats }: { stats: PriceStats }) {
  const items = [
    { label: '最高價', value: fmtPrice(stats.highest_price), icon: ArrowUpRight },
    { label: '最低價', value: fmtPrice(stats.lowest_price), icon: ArrowDownRight },
    { label: '平均收盤價', value: fmtPrice(stats.average_close), icon: BarChart3 },
    { label: '總成交量', value: fmtVolume(stats.total_volume), icon: BarChart3 },
    { label: '總成交金額', value: fmtAmount(stats.total_amount), icon: BarChart3 },
    { label: '交易天數', value: `${stats.trading_days} 天`, icon: Calendar },
  ];
  return (
    <section aria-labelledby="stats-heading" className="rounded-xl border bg-card p-4 shadow-card sm:p-5">
      <h3 id="stats-heading" className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold">
        <BarChart3 size={16} className="text-brand" aria-hidden />
        區間統計
        <span className="text-xs font-normal text-muted-foreground tabular-nums">
          （{stats.start_date} ~ {stats.end_date}）
        </span>
      </h3>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {items.map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-lg border bg-muted/50 p-3">
            <Icon size={16} className="mb-2 text-muted-foreground" aria-hidden />
            <dt className="mb-1 text-xs text-muted-foreground">{label}</dt>
            <dd className="font-mono text-sm font-bold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

interface HistoryProps {
  data: HistoryPage;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

/** 歷史股價（全部歷史，依頁數往回翻；決議 c23 移到價量抽屜） */
export function HistoryTable({ data, page, pageSize, onPageChange }: HistoryProps) {
  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
  const pageButton = 'inline-flex size-11 items-center justify-center rounded-lg border transition-colors hover:border-brand hover:text-brand-text disabled:cursor-not-allowed disabled:opacity-30';
  return (
    <CollapsibleTableSection
      title={`歷史股價（共 ${data.total} 筆）`}
      expandLabel={`顯示歷史股價表（第 ${page}/${totalPages} 頁）`}
      collapseLabel="收合歷史股價表"
    >
      <nav className="flex items-center justify-end gap-2" aria-label="歷史股價分頁">
        <button type="button" onClick={() => onPageChange(page - 1)} disabled={page <= 1} aria-label="上一頁歷史股價" className={pageButton}>
          <ChevronLeft size={16} aria-hidden />
        </button>
        <span className="text-xs text-muted-foreground tabular-nums">
          {page} / {totalPages}
        </span>
        <button type="button" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} aria-label="下一頁歷史股價" className={pageButton}>
          <ChevronRight size={16} aria-hidden />
        </button>
      </nav>
      <TableFrame minWidth="min-w-[640px]">
        <thead>
          <tr className="bg-muted text-xs text-muted-foreground">
            <th scope="col" className="px-4 py-3 text-left font-medium">日期</th>
            {['開盤', '最高', '最低', '收盤', '漲跌', '成交量', '成交金額'].map((h) => (
              <th key={h} scope="col" className="px-4 py-3 text-right font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, i) => (
            <tr key={`${row.date}-${i}`} className="border-t transition-colors hover:bg-muted/50">
              <td className="px-4 py-2.5 font-mono text-muted-foreground">{row.date}</td>
              <td className="px-4 py-2.5 text-right font-mono">{fmtPrice(row.open)}</td>
              <td className="px-4 py-2.5 text-right font-mono">{fmtPrice(row.high)}</td>
              <td className="px-4 py-2.5 text-right font-mono">{fmtPrice(row.low)}</td>
              <td className="px-4 py-2.5 text-right font-mono font-semibold">{fmtPrice(row.close)}</td>
              <td className={cn('px-4 py-2.5 text-right font-mono', valueToneText(row.change))}>{fmtSigned(row.change)}</td>
              <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">{fmtNum(row.volume_shares)}</td>
              <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">
                {row.amount != null ? `${(row.amount / 1e8).toFixed(2)} 億` : '--'}
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
      </TableFrame>
    </CollapsibleTableSection>
  );
}
