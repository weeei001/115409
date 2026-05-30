import React from 'react';
import type { PriceChangeResponse } from '../../lib/types';
import { fmtPercent, fmtPrice } from '../../lib/utils/format';
import { getValueToneClass } from '../../lib/utils/valueToneClass';
import { CollapsibleTableSection } from '../CollapsibleTableSection';
import { TableScrollHint } from '../TableScrollHint';

interface Props {
  data: PriceChangeResponse | null;
  loading?: boolean;
}

export const PriceChangePanel: React.FC<Props> = ({ data, loading }) => {
  if (loading) {
    return <div className="h-40 rounded-xl bg-[var(--color-bg-elevated)] animate-pulse" aria-hidden />;
  }

  if (!data?.data?.length) {
    return (
      <p className="text-sm text-[var(--color-text-muted)] py-4 text-center">尚無漲跌明細資料</p>
    );
  }

  const rows = [...data.data].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15);

  return (
    <CollapsibleTableSection
      title="漲跌明細"
      rowCount={rows.length}
      expandLabel={`顯示漲跌明細（${rows.length} 筆）`}
      collapseLabel="收合漲跌明細"
    >
      <TableScrollHint />
      <div className="overflow-x-auto rounded-xl border border-[var(--color-border)] touch-pan-x overscroll-x-contain">
        <table className="w-full text-sm min-w-[400px]">
          <thead>
            <tr className="bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] text-xs">
              <th className="text-left px-3 py-2 font-medium">日期</th>
              <th className="text-right px-3 py-2 font-medium">收盤</th>
              <th className="text-right px-3 py-2 font-medium">漲跌</th>
              <th className="text-right px-3 py-2 font-medium">漲跌幅</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const change = Number(row.change ?? 0);
              const pct = Number(row.change_percent ?? 0);
              return (
                <tr key={row.date} className="border-t border-[var(--color-border)]">
                  <td className="px-3 py-2 tabular-nums">{row.date}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtPrice(String(row.close))}</td>
                  <td className={`px-3 py-2 text-right font-mono tabular-nums ${getValueToneClass(change)}`}>
                    {change > 0 ? '+' : ''}
                    {fmtPrice(String(change))}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono tabular-nums ${getValueToneClass(pct)}`}>
                    {fmtPercent(pct, { sign: true })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </CollapsibleTableSection>
  );
};
