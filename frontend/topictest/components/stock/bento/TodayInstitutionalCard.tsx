import React from 'react';
import { Landmark } from 'lucide-react';
import type { InstitutionalTradeResponse } from '../../../lib/types/stockDashboard';
import { fmtInstitutionalShares } from '../../../lib/utils/format';
import { getValueToneClass } from '../../../lib/utils/valueToneClass';
import { BentoCardShell } from './BentoCardShell';

interface Props {
  latest: InstitutionalTradeResponse | null;
  loading?: boolean;
  onOpenDetail: () => void;
}

export const TodayInstitutionalCard: React.FC<Props> = ({ latest, loading, onOpenDetail }) => {
  const rows: Array<{ label: string; value: number | null | undefined; emphasis?: boolean }> = [
    { label: '外資', value: latest?.foreign_excl_dealer_net },
    { label: '投信', value: latest?.investment_trust_net },
    { label: '自營', value: latest?.dealer_net_total },
    { label: '法人合計', value: latest?.total_net, emphasis: true },
  ];

  const loadingSkeleton = (
    <div className="space-y-2" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-9 rounded-lg bg-[var(--color-bg-elevated)] animate-pulse" />
      ))}
    </div>
  );

  return (
    <BentoCardShell
      icon={Landmark}
      title="今日法人"
      rightSlot={
        latest?.date ? (
          <span className="text-[11px] text-[var(--color-text-muted)] tabular-nums">{latest.date}</span>
        ) : null
      }
      loading={loading}
      loadingSkeleton={loadingSkeleton}
      isEmpty={!latest}
      emptyText="尚無今日法人資料"
      action={{ label: '詳細籌碼分析', onClick: onOpenDetail }}
    >
      <ul className="flex-1 flex flex-col gap-2">
        {rows.map((row) => (
          <li
            key={row.label}
            className={`flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 ${
              row.emphasis
                ? 'bg-[var(--color-bg-elevated)] border-brand/25'
                : 'bg-[var(--color-bg-elevated)]/40'
            }`}
          >
            <span className={`text-xs ${row.emphasis ? 'font-semibold text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'}`}>
              {row.label}
            </span>
            <span className={`font-mono text-sm font-semibold tabular-nums ${getValueToneClass(row.value)}`}>
              {fmtInstitutionalShares(row.value)}
            </span>
          </li>
        ))}
      </ul>
    </BentoCardShell>
  );
};
