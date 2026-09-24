import React from 'react';
import { Activity } from 'lucide-react';
import type { TechnicalDay } from '@/lib/types/view';
import { kdSignal, macdSignal, rsiSignal, signalBadgeClass, type Signal } from '@/lib/utils/indicatorSignals';
import { CardShell } from './CardShell';
import { cn } from '@/lib/cn';

interface Props {
  latest: TechnicalDay | null;
  loading?: boolean;
  onOpenDetail: () => void;
}

export function IndicatorSignalsCard({ latest, loading, onOpenDetail }: Props) {
  const rows: Array<{ label: string; value: string; signal: Signal }> = [
    { label: 'RSI10', value: latest?.rsi10 != null ? latest.rsi10.toFixed(1) : '—', signal: rsiSignal(latest?.rsi10) },
    { label: 'MACD 動能', value: latest?.macd_hist != null ? latest.macd_hist.toFixed(3) : '—', signal: macdSignal(latest?.macd_hist) },
    {
      label: 'KD',
      value: latest?.kd_k9 != null && latest?.kd_d9 != null ? `K ${latest.kd_k9.toFixed(1)} / D ${latest.kd_d9.toFixed(1)}` : '—',
      signal: kdSignal(latest?.kd_k9, latest?.kd_d9),
    },
  ];
  return (
    <CardShell icon={Activity} title="指標訊號" loading={loading} action={{ label: '詳細技術指標', onClick: onOpenDetail }}>
      <p className="-mt-1 text-[11px] text-muted-foreground">最新一日讀數與偏向</p>
      <ul className="flex flex-1 flex-col gap-2">
        {rows.map((row) => (
          <li key={row.label} className="rounded-lg border bg-muted/50 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">{row.label}</span>
              <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium', signalBadgeClass(row.signal.tone))}>
                {row.signal.value == null ? '無資料' : row.signal.label}
              </span>
            </div>
            <p className="mt-1 font-mono text-sm font-semibold tabular-nums">{row.value}</p>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}
