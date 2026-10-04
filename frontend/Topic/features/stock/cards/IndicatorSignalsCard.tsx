import { Activity } from 'lucide-react';
import type { TechnicalDay } from '@/lib/types/view';
import { kdSignal, macdSignal, rsiSignal, type Signal } from '@/lib/utils/indicatorSignals';
import { SignalTag } from '@/components/common/SignalTag';
import { signedText } from '@/components/common/LightEntry';
import { CardShell } from './CardShell';
import type { LightState } from '@/components/common/Ledger';

interface Props {
  latest: TechnicalDay | null;
  loading?: boolean;
  /** 燈質記號（Q／F／熄燈） */
  state?: LightState;
  onOpenDetail: () => void;
  className?: string;
}

export function IndicatorSignalsCard({ latest, loading, state, onOpenDetail, className }: Props) {
  const rows: Array<{ label: string; value: string; signal: Signal }> = [
    { label: 'RSI10', value: latest?.rsi10 != null ? latest.rsi10.toFixed(1) : '—', signal: rsiSignal(latest?.rsi10) },
    { label: 'MACD 動能', value: latest?.macd_hist != null ? signedText(latest.macd_hist, 3) : '—', signal: macdSignal(latest?.macd_hist) },
    {
      label: 'KD',
      value: latest?.kd_k9 != null && latest?.kd_d9 != null ? `K ${latest.kd_k9.toFixed(1)} / D ${latest.kd_d9.toFixed(1)}` : '—',
      signal: kdSignal(latest?.kd_k9, latest?.kd_d9),
    },
  ];
  return (
    <CardShell
      icon={Activity}
      title="指標訊號"
      unit="RSI ≥70 超買／≤30 超賣"
      stampDate={latest ? latest.date : undefined}
      stampLabel="指標"
      loading={loading}
      state={state}
      action={{ label: '詳細技術指標', onClick: onOpenDetail }}
      className={className}
    >
      <ul className="flex-1 border-t">
        {rows.map((row) => (
          <li key={row.label} className="flex min-h-14 items-center justify-between gap-2 border-b py-2">
            <span className="min-w-0">
              <span className="block text-[13px] text-subtle">{row.label}</span>
              <span className="block font-mono text-[13.5px] font-medium whitespace-nowrap tabular-nums">{row.value}</span>
            </span>
            <SignalTag signal={row.signal}>{row.signal.value == null ? '無資料' : row.signal.label}</SignalTag>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}
