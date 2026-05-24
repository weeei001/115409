import React, { useState } from 'react';
import type { InstitutionalTradeListResponse } from '../../lib/types';
import { fmt } from '../../lib/utils/format';
import { CollapsibleTableSection } from '../CollapsibleTableSection';
import { TableScrollHint } from '../TableScrollHint';

interface Props {
  data: InstitutionalTradeListResponse | null;
  loading?: boolean;
}

function netClass(v: number | null | undefined): string {
  if (v == null) return 'text-[var(--color-text-muted)]';
  if (v > 0) return 'text-up';
  if (v < 0) return 'text-down';
  return 'text-[var(--color-text-secondary)]';
}

const Box = 'div' as const;

function LoadingSkeleton() {
  return <Box className="h-48 rounded-xl bg-[var(--color-bg-elevated)] animate-pulse" aria-hidden />;
}

type ViewMode = 'net' | 'detail';

export const InstitutionalHistoryTable: React.FC<Props> = ({ data, loading }) => {
  const [viewMode, setViewMode] = useState<ViewMode>('net');

  if (loading) {
    return <LoadingSkeleton />;
  }
  if (!data?.data?.length) {
    return (
      <p className="text-sm text-[var(--color-text-muted)] py-6 text-center">尚無法人歷史明細</p>
    );
  }

  const rows = [...data.data].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
  const hasBuySellData = rows.some(
    (r) => r.foreign_buy != null || r.foreign_sell != null
  );

  return (
    <CollapsibleTableSection
      title="法人歷史明細"
      subtitle="外資、投信、自營每日買賣超（股）"
      rowCount={rows.length}
      expandLabel={`顯示法人明細（${rows.length} 筆）`}
      collapseLabel="收合法人明細"
    >
      {hasBuySellData && (
        <div className="flex gap-1 mb-2">
          <button
            onClick={() => setViewMode('net')}
            className={`px-3 py-1 text-xs rounded-lg transition-colors ${
              viewMode === 'net'
                ? 'bg-brand/20 text-brand font-semibold'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
            }`}
          >
            淨額
          </button>
          <button
            onClick={() => setViewMode('detail')}
            className={`px-3 py-1 text-xs rounded-lg transition-colors ${
              viewMode === 'detail'
                ? 'bg-brand/20 text-brand font-semibold'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
            }`}
          >
            買賣明細
          </button>
        </div>
      )}
      <TableScrollHint />
      <Box className="overflow-x-auto rounded-xl border border-[var(--color-border)] touch-pan-x overscroll-x-contain">
        {viewMode === 'net' ? (
          <table className="w-full text-sm min-w-[520px]">
            <thead>
              <tr className="bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] text-xs">
                <th className="text-left px-3 py-2 font-medium">日期</th>
                <th className="text-right px-3 py-2 font-medium">外資（股）</th>
                <th className="text-right px-3 py-2 font-medium">投信（股）</th>
                <th className="text-right px-3 py-2 font-medium">自營（股）</th>
                <th className="text-right px-3 py-2 font-medium">合計（股）</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.date} className="border-t border-[var(--color-border)]">
                  <td className="px-3 py-2 tabular-nums">{row.date}</td>
                  <td className={`px-3 py-2 text-right font-mono tabular-nums ${netClass(row.foreign_excl_dealer_net)}`}>
                    {fmt(row.foreign_excl_dealer_net)}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono tabular-nums ${netClass(row.investment_trust_net)}`}>
                    {fmt(row.investment_trust_net)}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono tabular-nums ${netClass(row.dealer_net_total)}`}>
                    {fmt(row.dealer_net_total)}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono font-semibold tabular-nums ${netClass(row.total_net)}`}>
                    {fmt(row.total_net)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm min-w-[860px]">
            <thead>
              <tr className="bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] text-xs">
                <th className="text-left px-3 py-2 font-medium" rowSpan={2}>日期</th>
                <th className="text-center px-1 py-1 font-medium border-b border-[var(--color-border)]" colSpan={3}>外資</th>
                <th className="text-center px-1 py-1 font-medium border-b border-[var(--color-border)]" colSpan={3}>投信</th>
                <th className="text-center px-1 py-1 font-medium border-b border-[var(--color-border)]" colSpan={3}>自營</th>
                <th className="text-right px-3 py-2 font-medium" rowSpan={2}>合計</th>
              </tr>
              <tr className="bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] text-xs">
                <th className="text-right px-2 py-1 font-normal">買進</th>
                <th className="text-right px-2 py-1 font-normal">賣出</th>
                <th className="text-right px-2 py-1 font-normal">淨額</th>
                <th className="text-right px-2 py-1 font-normal">買進</th>
                <th className="text-right px-2 py-1 font-normal">賣出</th>
                <th className="text-right px-2 py-1 font-normal">淨額</th>
                <th className="text-right px-2 py-1 font-normal">買進</th>
                <th className="text-right px-2 py-1 font-normal">賣出</th>
                <th className="text-right px-2 py-1 font-normal">淨額</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.date} className="border-t border-[var(--color-border)]">
                  <td className="px-3 py-2 tabular-nums">{row.date}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-up">{fmt(row.foreign_buy)}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-down">{fmt(row.foreign_sell)}</td>
                  <td className={`px-2 py-2 text-right font-mono font-semibold tabular-nums ${netClass(row.foreign_excl_dealer_net)}`}>
                    {fmt(row.foreign_excl_dealer_net)}
                  </td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-up">{fmt(row.investment_trust_buy)}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-down">{fmt(row.investment_trust_sell)}</td>
                  <td className={`px-2 py-2 text-right font-mono font-semibold tabular-nums ${netClass(row.investment_trust_net)}`}>
                    {fmt(row.investment_trust_net)}
                  </td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-up">{fmt(row.dealer_buy)}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-down">{fmt(row.dealer_sell)}</td>
                  <td className={`px-2 py-2 text-right font-mono font-semibold tabular-nums ${netClass(row.dealer_net_total)}`}>
                    {fmt(row.dealer_net_total)}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono font-semibold tabular-nums ${netClass(row.total_net)}`}>
                    {fmt(row.total_net)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Box>
    </CollapsibleTableSection>
  );
};
