import React from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { HistoricalPriceList } from '../lib/types';
import { fmtPrice, fmtNum } from '../lib/utils/format';
import { CollapsibleTableSection } from './CollapsibleTableSection';
import { TableScrollHint } from './TableScrollHint';

interface Props {
  data: HistoricalPriceList;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

export const HistoryTable: React.FC<Props> = ({ data, page, pageSize, onPageChange }) => {
  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
  const backendCapNote =
    data.total < pageSize ? `後端目前最多回傳 ${data.total} 筆` : undefined;

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.4 }}
    >
      <CollapsibleTableSection
        title={`歷史股價（共 ${data.total} 筆）`}
        subtitle={backendCapNote}
        rowCount={data.data.length}
        expandLabel={`顯示歷史股價表（第 ${page}/${totalPages} 頁）`}
        collapseLabel="收合歷史股價表"
      >
        <div className="flex items-center justify-end gap-2">
          <nav className="flex items-center gap-2" aria-label="歷史股價分頁">
            <button
              type="button"
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              aria-label="上一頁歷史股價"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-[var(--color-border)] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[var(--color-bg-elevated)] hover:border-brand hover:text-brand transition-colors cursor-pointer"
            >
              <ChevronLeft size={16} aria-hidden />
            </button>
            <span className="text-xs text-[var(--color-text-muted)]">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              aria-label="下一頁歷史股價"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-[var(--color-border)] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[var(--color-bg-elevated)] hover:border-brand hover:text-brand transition-colors cursor-pointer"
            >
              <ChevronRight size={16} aria-hidden />
            </button>
          </nav>
        </div>
        <TableScrollHint />
        <div className="overflow-x-auto rounded-xl border border-[var(--color-border)] overscroll-x-contain">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] text-xs">
                <th scope="col" className="text-left px-4 py-3 font-medium">
                  日期
                </th>
                <th scope="col" className="text-right px-4 py-3 font-medium">
                  開盤
                </th>
                <th scope="col" className="text-right px-4 py-3 font-medium">
                  最高
                </th>
                <th scope="col" className="text-right px-4 py-3 font-medium">
                  最低
                </th>
                <th scope="col" className="text-right px-4 py-3 font-medium">
                  收盤
                </th>
                <th scope="col" className="text-right px-4 py-3 font-medium">
                  漲跌
                </th>
                <th scope="col" className="text-right px-4 py-3 font-medium">
                  成交量
                </th>
                <th scope="col" className="text-right px-4 py-3 font-medium">
                  成交金額
                </th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((row, rowIdx) => {
                const change = Number(row.change ?? 0);
                const isUp = change > 0;
                const isDown = change < 0;
                const changeColorClass = isUp
                  ? 'text-up'
                  : isDown
                    ? 'text-down'
                    : 'text-[var(--color-text-muted)]';
                return (
                  <tr
                    key={`${row.date}-${row.close}-${row.volume_shares ?? ''}-${rowIdx}`}
                    className="border-t border-[var(--color-border)] hover:bg-[var(--color-bg-elevated)]/50 transition-colors"
                  >
                    <td className="px-4 py-2.5 font-mono text-[var(--color-text-muted)]">{row.date}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{fmtPrice(row.open)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-up">{fmtPrice(row.high)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-down">{fmtPrice(row.low)}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold">{fmtPrice(row.close)}</td>
                    <td className={`px-4 py-2.5 text-right font-mono ${changeColorClass}`}>
                      {isUp ? '+' : ''}
                      {fmtPrice(row.change)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-[var(--color-text-muted)]">
                      {fmtNum(row.volume_shares)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-[var(--color-text-muted)]">
                      {row.amount != null ? `${(row.amount / 1e8).toFixed(2)} 億` : '--'}
                    </td>
                  </tr>
                );
              })}
              {data.data.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center text-[var(--color-text-muted)] py-8">
                    無歷史資料
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CollapsibleTableSection>
    </motion.section>
  );
};
