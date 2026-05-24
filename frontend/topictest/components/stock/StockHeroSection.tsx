import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import type { DailyPriceResponse } from '../../lib/types';
import type {
  InstitutionalTradeResponse,
  TechnicalIndicatorResponse,
} from '../../lib/types/stockDashboard';
import type { PriceChartData } from '../../lib/types/priceChart';
import { fmtPrice } from '../../lib/utils/format';
import { usePrefersReducedMotionClient } from '../../lib/usePrefersReducedMotionClient';
import { StockHeader } from '../StockHeader';
import { StockSparkline, type SparklineTrend } from '../StockSparkline';
import { StockQuickActions } from './StockQuickActions';
import { AIVerdictHeroCard } from './AIVerdictHeroCard';
import type { UseAdvisorVerdictResult } from '../../lib/hooks/useAdvisorVerdict';

interface Props {
  symbol: string;
  stockName: string;
  latest: DailyPriceResponse;
  institutionalLatest: InstitutionalTradeResponse | null;
  indicatorLatest: TechnicalIndicatorResponse | null;
  priceChart: PriceChartData | null;
  endDate: string | null;
  verdict: UseAdvisorVerdictResult;
  onOpenAI?: () => void;
}

const SPARKLINE_POINTS = 60;
const SPARKLINE_CONTAINER_CLASSES = 'rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/60 px-3 py-1.5';

export const StockHeroSection: React.FC<Props> = ({
  symbol,
  stockName,
  latest,
  institutionalLatest,
  indicatorLatest,
  priceChart,
  endDate,
  verdict,
  onOpenAI,
}) => {
  const reduceMotion = usePrefersReducedMotionClient();
  const change = Number(latest.change ?? 0);
  const close = Number(latest.close ?? 0);
  const prevClose = close - change;
  const validPrev = prevClose > 0;
  const changePct = validPrev ? ((change / prevClose) * 100).toFixed(2) : null;
  const isUp = change >= 0;

  const sparklineValues = useMemo(() => {
    if (!priceChart?.candles?.length) return [];
    const tail = priceChart.candles.slice(-SPARKLINE_POINTS);
    return tail.map((candle) => candle.close).filter((value) => Number.isFinite(value));
  }, [priceChart]);

  const sparklineTrend: SparklineTrend = useMemo(() => {
    if (sparklineValues.length < 2) return 'flat';
    const first = sparklineValues[0];
    const last = sparklineValues[sparklineValues.length - 1];
    if (!Number.isFinite(first) || !Number.isFinite(last)) return 'flat';
    if (last > first) return 'up';
    if (last < first) return 'down';
    return 'flat';
  }, [sparklineValues]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 items-stretch">
      <motion.div
        className="lg:col-span-8 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] shadow-[var(--shadow-card)] p-4 sm:p-5 flex flex-col gap-3"
        initial={reduceMotion ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.4, ease: 'easeOut' }}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-xl sm:text-2xl font-bold flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="tabular-nums">{symbol}</span>
              <span className="text-sm sm:text-base font-medium text-[var(--color-text-secondary)]">
                {stockName}
              </span>
            </h2>
            <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)] tabular-nums">
              收盤日 {latest.date}
            </p>
          </div>
          <div className="sm:text-right">
            <p className="text-[11px] text-[var(--color-text-muted)] mb-0 sm:text-right">收盤價</p>
            <div className="text-3xl sm:text-4xl font-mono font-bold tabular-nums leading-none">
              {fmtPrice(latest.close)}
            </div>
            <div
              className={`mt-1.5 inline-flex sm:justify-end items-center gap-1 text-xs sm:text-sm font-medium font-mono tabular-nums ${
                isUp ? 'text-up' : 'text-down'
              }`}
            >
              {isUp ? <TrendingUp size={14} aria-hidden /> : <TrendingDown size={14} aria-hidden />}
              <span>
                {isUp ? '+' : ''}
                {change.toFixed(2)}
              </span>
              <span>({changePct != null ? `${isUp ? '+' : ''}${changePct}%` : '--'})</span>
            </div>
          </div>
        </div>

        {sparklineValues.length >= 2 ? (
          <div className={SPARKLINE_CONTAINER_CLASSES}>
            <div className="flex items-center justify-between gap-2 mb-0.5">
              <span className="text-[10px] font-medium text-[var(--color-text-muted)]">
                近 {sparklineValues.length} 日收盤
              </span>
              <span className="text-[10px] text-[var(--color-text-muted)] tabular-nums">
                {sparklineValues[0].toFixed(2)} → {sparklineValues[sparklineValues.length - 1].toFixed(2)}
              </span>
            </div>
            <StockSparkline values={sparklineValues} trend={sparklineTrend} />
          </div>
        ) : null}

        <StockHeader
          data={latest}
          stockName={stockName}
          institutionalSnapshot={institutionalLatest}
          technicalSnapshot={indicatorLatest}
          compact
          hideSecondary
        />

        <div className="mt-auto">
          <StockQuickActions symbol={symbol} onOpenAI={onOpenAI} />
        </div>
      </motion.div>

      <motion.div
        className="lg:col-span-4"
        initial={reduceMotion ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.4, ease: 'easeOut', delay: 0.08 }}
      >
        <AIVerdictHeroCard symbol={symbol} endDate={endDate} verdict={verdict} onOpenDetail={onOpenAI} />
      </motion.div>
    </div>
  );
};
