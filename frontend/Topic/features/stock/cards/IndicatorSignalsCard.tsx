import { Activity, RefreshCw } from 'lucide-react';
import type { TechnicalDay } from '@/lib/types/view';
import { fmtIndicator, INDICATOR_LABELS, kdSignal, MACD_DECIMALS, macdSignal, rsiSignal, type Signal } from '@/lib/utils/indicatorSignals';
import { SignalTag } from '@/components/common/SignalTag';
import { Button } from '@/components/ui/button';
import { signedText } from '@/lib/utils/format';
import { CardShell } from './CardShell';
import type { LightState } from '@/components/common/Ledger';

interface Props {
  latest: TechnicalDay | null;
  loading?: boolean;
  /** 燈質記號（Q／F／熄燈） */
  state?: LightState;
  onOpenDetail: () => void;
  /** /technical-indicators 載入失敗的訊息；有值時顯示錯誤與重試，不顯示「無資料」 */
  error?: string | null;
  onRetry?: () => void;
  className?: string;
}

export function IndicatorSignalsCard({ latest, loading, state, onOpenDetail, error, onRetry, className }: Props) {
  const rows: Array<{ label: string; value: string; signal: Signal }> = [
    // 指標名稱帶參數；小數位全站個股頁一致：RSI、KD 1 位，MACD 柱 3 位（04-U7）
    { label: INDICATOR_LABELS.rsi, value: latest?.rsi10 != null ? fmtIndicator(latest.rsi10) : '--', signal: rsiSignal(latest?.rsi10) },
    { label: INDICATOR_LABELS.macdHist, value: latest?.macd_hist != null ? signedText(latest.macd_hist, MACD_DECIMALS) : '--', signal: macdSignal(latest?.macd_hist) },
    {
      label: INDICATOR_LABELS.kd,
      value: latest?.kd_k9 != null && latest?.kd_d9 != null ? `K ${fmtIndicator(latest.kd_k9)} / D ${fmtIndicator(latest.kd_d9)}` : '--',
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
      error={error}
      errorAction={onRetry ? <Button type="button" size="sm" variant="outline" onClick={onRetry} className="min-h-11"><RefreshCw aria-hidden />重試</Button> : undefined}
      action={{ label: '技術指標明細', onClick: onOpenDetail }}
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
