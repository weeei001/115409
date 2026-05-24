import React from 'react';
import type { VolumeAnalysisResponse } from '../../lib/types';
import { fmtAmount, fmtPrice, fmtVolume } from '../../lib/utils/format';
import { CollapsibleTableSection } from '../CollapsibleTableSection';
import { TableScrollHint } from '../TableScrollHint';

interface Props {
  data: VolumeAnalysisResponse | null;
  loading?: boolean;
}

function changeClass(v: number): string {
  if (v > 0) return 'text-up';
  if (v < 0) return 'text-down';
  return 'text-[var(--color-text-muted)]';
}

const Box = 'div' as const;

export const VolumeAnalysisPanel: React.FC<Props> = ({ data, loading }) => {
  if (loading) {
    return <Box className="h-40 rounded-xl bg-[var(--color-bg-elevated)] animate-pulse" aria-hidden />;
  }

  if (!data?.data?.length) {
    return null;
  }

  const rows = [...data.data].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15);

  return (
    <CollapsibleTableSection
      title="區間量能統計"
      subtitle="與 K 線成交量來源相同區間，含成交金額與漲跌。"
      rowCount={rows.length}
      expandLabel={`顯示量能明細（${rows.length} 筆）`}
      collapseLabel="收合量能明細"
    >
      <TableScrollHint />
      <Box className="overflow-x-auto rounded-xl border border-[var(--color-border)] touch-pan-x overscroll-x-contain">
        <table className="w-full text-sm min-w-[520px]">
          <thead>
            <tr className="bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] text-xs">
              <th className="text-left px-3 py-2 font-medium">日期</th>
              <th className="text-right px-3 py-2 font-medium">成交量</th>
              <th className="text-right px-3 py-2 font-medium">成交金額</th>
              <th className="text-right px-3 py-2 font-medium">收盤</th>
              <th className="text-right px-3 py-2 font-medium">漲跌</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const change = Number(row.change ?? 0);
              return (
                <tr key={row.date} className="border-t border-[var(--color-border)]">
                  <td className="px-3 py-2 tabular-nums">{row.date}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtVolume(row.volume)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtAmount(row.amount)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtPrice(String(row.close))}</td>
                  <td className={`px-3 py-2 text-right font-mono tabular-nums ${changeClass(change)}`}>
                    {change > 0 ? '+' : ''}
                    {fmtPrice(String(change))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Box>
    </CollapsibleTableSection>
  );
};
