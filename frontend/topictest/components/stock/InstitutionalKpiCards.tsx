import React from 'react';
import type { InstitutionalTradeResponse } from '../../lib/types';
import { fmt } from '../../lib/utils/format';
import { getValueToneClass } from '../../lib/utils/valueToneClass';

interface Props {
  latest: InstitutionalTradeResponse | null;
  loading?: boolean;
}

const ITEMS = [
  { key: 'foreign_excl_dealer_net' as const, label: '外資（股）' },
  { key: 'investment_trust_net' as const, label: '投信（股）' },
  { key: 'dealer_net_total' as const, label: '自營（股）' },
  { key: 'total_net' as const, label: '合計（股）' },
];

export const InstitutionalKpiCards: React.FC<Props> = ({ latest, loading }) => {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 rounded-xl bg-[var(--color-bg-elevated)] animate-pulse" />
        ))}
      </div>
    );
  }

  if (!latest) {
    return (
      <p className="text-sm text-[var(--color-text-muted)] py-6 text-center">暫無法人籌碼資料</p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--color-text-muted)] tabular-nums">最新：{latest.date}</p>
      <div className="grid grid-cols-2 gap-3">
        {ITEMS.map(({ key, label }) => {
          const v = latest[key];
          return (
            <div
              key={key}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-3"
            >
              <div className="text-xs text-[var(--color-text-muted)] mb-1">{label}</div>
              <div className={`text-sm font-semibold font-mono tabular-nums ${getValueToneClass(v)}`}>
                {fmt(v)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
