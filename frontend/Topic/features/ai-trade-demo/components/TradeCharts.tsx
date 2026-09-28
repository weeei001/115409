import React, { useMemo } from 'react';
import { CandlestickChart, Wallet } from 'lucide-react';
import { EChart } from '@/components/charts/EChart';
import { EmptyState } from '@/components/common/Notice';
import { equityOption, priceActionOption } from '../chartOptions';
import type { SimDayEvent } from '../types';
import { DemoCard } from './DemoCard';

interface Props {
  /** 串流中由 hook 節流更新（約每 300ms 一次），option 跟著重算 */
  days: SimDayEvent[];
  initialCash: number;
  isDark: boolean;
}

export function TradeCharts({ days, initialCash, isDark }: Props) {
  const priceOption = useMemo(() => priceActionOption(days, isDark), [days, isDark]);
  const assetOption = useMemo(() => equityOption(days, initialCash, isDark), [days, initialCash, isDark]);

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
      <DemoCard
        title="股價走勢與買賣點"
        icon={CandlestickChart}
        description="收盤價取自每日結果的 close_price；日期為成交日。持股增加標為買點、減少標為賣點，標記只代表當天有成交，位置不是成交價。"
      >
        {priceOption ? (
          <EChart title="2330 收盤價走勢與 AI 買賣點" option={priceOption} height={300} />
        ) : (
          <EmptyState>尚未收到交易日資料</EmptyState>
        )}
      </DemoCard>
      <DemoCard title="資產淨值" icon={Wallet} description="每日資產淨值（portfolio_value），虛線為初始資金。">
        {assetOption ? (
          <EChart title="AI 模擬下單的資產淨值曲線" option={assetOption} height={300} />
        ) : (
          <EmptyState>尚未收到交易日資料</EmptyState>
        )}
      </DemoCard>
    </div>
  );
}
