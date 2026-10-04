import { Landmark } from 'lucide-react';
import type { InstitutionalDay } from '@/lib/types/view';
import { valueToneText } from '@/lib/utils/tone';
import { Button } from '@/components/ui/button';
import { signedShares } from '../signedShares';
import { CardShell } from './CardShell';
import type { LightState } from '@/components/common/Ledger';
import { cn } from '@/lib/cn';

interface Props {
  latest: InstitutionalDay | null;
  loading?: boolean;
  /** 燈質記號（Q／F／熄燈） */
  state?: LightState;
  onOpenDetail: () => void;
  /** 沒有資料時的「重新載入」 */
  onRetry?: () => void;
  className?: string;
}

/** 最近交易日（最近一筆已儲存資料）的三大法人買賣超；資料不是即時，所以不叫「今日」 */
export function LatestInstitutionalCard({ latest, loading, state, onOpenDetail, onRetry, className }: Props) {
  const rows = [
    { label: '外資', value: latest?.foreign_net },
    { label: '投信', value: latest?.investment_trust_net },
    { label: '自營', value: latest?.dealer_net },
  ];
  const total = latest?.total_institutional_net;
  return (
    <CardShell
      icon={Landmark}
      title="最近交易日法人"
      unit="萬股"
      stampDate={latest ? latest.date : undefined}
      stampLabel="法人"
      loading={loading}
      state={state}
      loadingRows={4}
      isEmpty={!latest}
      emptyText="尚無最近交易日的法人資料"
      emptyAction={onRetry ? <Button type="button" size="sm" variant="outline" onClick={onRetry} className="min-h-11">重新載入</Button> : undefined}
      action={{ label: '詳細籌碼分析', onClick: onOpenDetail }}
      className={className}
    >
      {/* 讀數：法人合計；底下三列明細用細線分隔，只有淨額上漲跌色 */}
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={cn('font-mono text-2xl leading-none font-semibold whitespace-nowrap tabular-nums', valueToneText(total))}>{signedShares(total)}</span>
        <span className="text-[13px] text-muted-foreground">三大法人合計買賣超</span>
      </p>
      <dl className="mt-4 flex-1 border-t">
        {rows.map((row) => (
          <div key={row.label} className="flex min-h-11 items-center justify-between gap-2 border-b">
            <dt className="text-[13px] text-subtle">{row.label}</dt>
            <dd className={cn('font-mono text-[13.5px] font-medium whitespace-nowrap tabular-nums', valueToneText(row.value))}>{signedShares(row.value)}</dd>
          </div>
        ))}
      </dl>
    </CardShell>
  );
}
