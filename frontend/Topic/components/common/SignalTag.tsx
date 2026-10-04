import { Badge } from '@/components/ui/badge';
import type { Signal } from '@/lib/utils/indicatorSignals';

/** 技術指標的判讀徽章（RSI、KD、MACD、均線位置）：個股頁、觀測台、多股比較共用同一個樣式 */
export function SignalTag({ signal, children, className }: { signal: Pick<Signal, 'tone' | 'label'>; children?: React.ReactNode; className?: string }) {
  return (
    <Badge tone={signal.tone} emphasis className={className}>
      {children ?? signal.label}
    </Badge>
  );
}
