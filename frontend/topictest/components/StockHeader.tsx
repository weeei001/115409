import React from 'react';
import { motion } from 'motion/react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import type {
  DailyPriceResponse,
  InstitutionalTradeResponse,
  TechnicalIndicatorResponse,
} from '../lib/types';
import { fmt, fmtPrice } from '../lib/utils/format';
import { getStockDisplayName } from '../lib/utils/symbolNames';
import { usePrefersReducedMotionClient } from '../lib/usePrefersReducedMotionClient';
import { ExpandableRegion } from './ExpandableRegion';

interface Props {
  data: DailyPriceResponse;
  stockName?: string | null;
  institutionalSnapshot?: InstitutionalTradeResponse | null;
  technicalSnapshot?: TechnicalIndicatorResponse | null;
  /** Hero 模式：隱藏內部識別＋大價格區塊，由父元件 (StockHeroSection) 自行接管 */
  compact?: boolean;
  /** 當 compact=true 時是否完全省略二級指標的展開區塊 */
  hideSecondary?: boolean;
}

type MetricItem = { label: string; value: string };

function MetricGrid({
  items,
  columns = 'grid-cols-2 sm:grid-cols-4',
}: {
  items: MetricItem[];
  columns?: string;
}) {
  return (
    <div className={`grid gap-3 ${columns}`}>
      {items.map((item) => (
        <div
          key={item.label}
          className="bg-[var(--color-bg-elevated)] rounded-xl px-3 py-3 border border-[var(--color-border)]"
        >
          <div className="text-xs text-[var(--color-text-muted)] mb-1">{item.label}</div>
          <div className="text-sm font-semibold font-mono tabular-nums">{item.value}</div>
        </div>
      ))}
    </div>
  );
}

export const StockHeader: React.FC<Props> = ({
  data,
  stockName,
  institutionalSnapshot,
  technicalSnapshot,
  compact = false,
  hideSecondary = false,
}) => {
  const reduceMotion = usePrefersReducedMotionClient();
  const change = Number(data.change ?? 0);
  const close = Number(data.close ?? 0);
  const prevClose = close - change;
  const validPrev = prevClose > 0;
  const changePct = validPrev ? ((change / prevClose) * 100).toFixed(2) : null;
  const isUp = change >= 0;
  const displayName = stockName ?? getStockDisplayName(data.symbol);

  const primaryMetrics: MetricItem[] = [
    { label: '昨收', value: validPrev ? fmtPrice(String(prevClose)) : '--' },
    { label: '開盤', value: fmtPrice(data.open) },
    { label: '最高', value: fmtPrice(data.high) },
    { label: '最低', value: fmtPrice(data.low) },
  ];

  const secondaryMetrics: MetricItem[] = [
    { label: '成交量', value: fmt(data.volume_shares) },
    { label: '成交金額', value: data.amount != null ? `${(data.amount / 1e8).toFixed(2)} 億` : '--' },
    { label: '成交筆數', value: fmt(data.trades) },
    {
      label: 'RSI10',
      value: technicalSnapshot?.rsi10 != null ? Number(technicalSnapshot.rsi10).toFixed(1) : '--',
    },
    {
      label: '法人合計（股）',
      value:
        institutionalSnapshot?.total_net != null
          ? `${fmt(institutionalSnapshot.total_net)} 股`
          : '--',
    },
  ];

  return (
    <motion.header
      className="w-full"
      initial={reduceMotion ? false : { opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.5 }}
    >
      {!compact ? (
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-4 mb-6">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span>{data.symbol}</span>
              <span className="text-base sm:text-lg font-medium text-[var(--color-text-secondary)]">
                {displayName}
              </span>
              <span className="text-sm text-[var(--color-text-muted)] tabular-nums w-full sm:w-auto">
                {data.date}
              </span>
            </h2>
          </div>
          <div className="sm:text-right">
            <p className="text-xs text-[var(--color-text-muted)] mb-0.5 sm:text-right">收盤價</p>
            <div className="text-2xl sm:text-4xl font-mono font-bold tabular-nums">{fmtPrice(data.close)}</div>
            <div
              className={`flex items-center sm:justify-end gap-1 text-sm font-medium font-mono tabular-nums ${isUp ? 'text-up' : 'text-down'}`}
            >
              {isUp ? <TrendingUp size={16} aria-hidden /> : <TrendingDown size={16} aria-hidden />}
              <span>
                {isUp ? '+' : ''}
                {change.toFixed(2)}
              </span>
              <span>({changePct != null ? `${isUp ? '+' : ''}${changePct}%` : '--'})</span>
            </div>
          </div>
        </div>
      ) : null}

      <MetricGrid items={primaryMetrics} />

      {!hideSecondary ? (
        <ExpandableRegion
          expandLabel={`顯示更多報價與籌碼指標（${secondaryMetrics.length}）`}
          collapseLabel="收合更多報價與籌碼指標"
          defaultExpandedOnDesktop
          panelClassName="pt-3"
        >
          <MetricGrid items={secondaryMetrics} columns="grid-cols-2 sm:grid-cols-3 lg:grid-cols-5" />
        </ExpandableRegion>
      ) : null}
    </motion.header>
  );
};
