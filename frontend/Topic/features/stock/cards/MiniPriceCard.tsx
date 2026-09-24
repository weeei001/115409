import React, { useMemo } from 'react';
import { CandlestickChart } from 'lucide-react';
import type { PriceChartData } from '@/lib/types/view';
import { recentCloseOption } from '@/lib/charts/adapters';
import { EChart } from '@/components/charts/EChart';
import { useTheme } from '@/lib/theme/ThemeContext';
import { fmtPercent } from '@/lib/utils/format';
import { valueToneText } from '@/lib/utils/tone';
import { CardShell } from './CardShell';
import { cn } from '@/lib/cn';

export function MiniPriceCard({ priceChart, onOpenDetail }: { priceChart: PriceChartData | null; onOpenDetail: () => void }) {
  const { theme } = useTheme();
  const chart = useMemo(() => recentCloseOption(priceChart, theme === 'dark'), [priceChart, theme]);

  return (
    <CardShell
      icon={CandlestickChart}
      title="價量走勢"
      rightSlot={
        chart ? (
          <span className={cn('font-mono text-sm font-semibold tabular-nums', valueToneText(chart.rangeChangePct))}>
            {fmtPercent(chart.rangeChangePct, { sign: true })}
          </span>
        ) : null
      }
      action={{ label: '詳細 K 線與量能', onClick: onOpenDetail }}
    >
      <p className="-mt-1 text-[11px] text-muted-foreground">近 {chart?.days ?? 0} 個交易日收盤</p>
      <div className="min-h-[140px] flex-1">
        {chart ? <EChart title="近期收盤走勢" option={chart.option} height={140} /> : <p className="py-8 text-center text-sm text-muted-foreground">尚無 K 線資料</p>}
      </div>
    </CardShell>
  );
}
