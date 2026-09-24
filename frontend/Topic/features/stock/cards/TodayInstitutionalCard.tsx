import React from 'react';
import { Landmark } from 'lucide-react';
import type { InstitutionalDay } from '@/lib/types/view';
import { fmtInstitutionalShares } from '@/lib/utils/format';
import { valueToneText } from '@/lib/utils/tone';
import { CardShell } from './CardShell';
import { cn } from '@/lib/cn';

interface Props {
  latest: InstitutionalDay | null;
  loading?: boolean;
  onOpenDetail: () => void;
}

export function TodayInstitutionalCard({ latest, loading, onOpenDetail }: Props) {
  const rows = [
    { label: '外資', value: latest?.foreign_net },
    { label: '投信', value: latest?.investment_trust_net },
    { label: '自營', value: latest?.dealer_net },
    { label: '法人合計', value: latest?.total_institutional_net, emphasis: true },
  ];
  return (
    <CardShell
      icon={Landmark}
      title="今日法人"
      rightSlot={latest?.date ? <span className="text-[11px] text-muted-foreground tabular-nums">{latest.date}</span> : null}
      loading={loading}
      loadingRows={4}
      isEmpty={!latest}
      emptyText="尚無今日法人資料"
      action={{ label: '詳細籌碼分析', onClick: onOpenDetail }}
    >
      <ul className="flex flex-1 flex-col gap-2">
        {rows.map((row) => (
          <li
            key={row.label}
            className={cn(
              'flex items-center justify-between gap-2 rounded-lg border px-3 py-2',
              row.emphasis ? 'border-brand/25 bg-muted' : 'bg-muted/40',
            )}
          >
            <span className={cn('text-xs', row.emphasis ? 'font-semibold' : 'text-subtle')}>{row.label}</span>
            <span className={cn('font-mono text-sm font-semibold tabular-nums', valueToneText(row.value))}>{fmtInstitutionalShares(row.value)}</span>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}
