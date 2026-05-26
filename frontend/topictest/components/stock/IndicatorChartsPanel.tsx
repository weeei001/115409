import React, { useMemo } from 'react';
import type { TechnicalIndicatorListResponse } from '../../lib/types';
import { useTheme } from '../../lib/ThemeContext';
import {
  indicatorsToBollOptions,
  indicatorsToKdOptions,
  indicatorsToRsiMacdOptions,
} from '../../lib/utils/chartAdapters';
import { IndicatorChartEmptyState } from './IndicatorChartEmptyState';
import { IndicatorBentoCell } from './IndicatorBentoCell';

interface Props {
  data: TechnicalIndicatorListResponse | null;
  loading?: boolean;
  onRetry?: () => void;
  onWidenRange?: () => void;
}

type Tone = 'up' | 'down' | 'neutral';

function pickNumber(value: number | null | undefined): number | null {
  if (value == null) return null;
  return Number.isFinite(value) ? value : null;
}

export const IndicatorChartsPanel: React.FC<Props> = ({
  data,
  loading,
  onRetry,
  onWidenRange,
}) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const charts = useMemo(() => {
    if (!data?.data?.length) {
      return {
        rsiOption: null,
        macdOption: null,
        hasRsiData: false,
        hasMacdData: false,
        kd: { option: null, hasData: false },
        boll: { option: null, hasData: false },
        hasAny: false,
        latest: null,
      };
    }
    const sorted = [...data.data].sort((a, b) => a.date.localeCompare(b.date));
    const rsiMacd = indicatorsToRsiMacdOptions(sorted, isDark);
    const kd = indicatorsToKdOptions(sorted, isDark);
    const boll = indicatorsToBollOptions(sorted, isDark);
    const latest = sorted[sorted.length - 1] ?? null;
    return {
      ...rsiMacd,
      kd,
      boll,
      hasAny: Boolean(rsiMacd.hasRsiData || rsiMacd.hasMacdData || kd.hasData || boll.hasData),
      latest,
    };
  }, [data, isDark]);

  const rsiBadge = useMemo<{ value: string; tone: Tone } | null>(() => {
    const value = pickNumber(charts.latest?.rsi10 ?? null);
    if (value == null) return null;
    const tone: Tone = value >= 70 ? 'up' : value <= 30 ? 'down' : 'neutral';
    return { value: value.toFixed(1), tone };
  }, [charts.latest]);

  const macdBadge = useMemo<{ value: string; tone: Tone } | null>(() => {
    const value = pickNumber(charts.latest?.macd_hist ?? null);
    if (value == null) return null;
    const tone: Tone = value > 0 ? 'up' : value < 0 ? 'down' : 'neutral';
    return { value: value.toFixed(3), tone };
  }, [charts.latest]);

  const kdBadge = useMemo<{ value: string; tone: Tone } | null>(() => {
    const k = pickNumber(charts.latest?.kd_k9 ?? null);
    const d = pickNumber(charts.latest?.kd_d9 ?? null);
    if (k == null || d == null) return null;
    const tone: Tone = k > d ? 'up' : k < d ? 'down' : 'neutral';
    return { value: `K ${k.toFixed(1)} / D ${d.toFixed(1)}`, tone };
  }, [charts.latest]);

  const bollBadge = useMemo<{ value: string; tone: Tone } | null>(() => {
    const upper = pickNumber(charts.latest?.boll_upper20 ?? null);
    const lower = pickNumber(charts.latest?.boll_lower20 ?? null);
    const mid = pickNumber(charts.latest?.boll_mid20 ?? null);
    if (upper == null || lower == null || mid == null) return null;
    return { value: `中 ${mid.toFixed(1)}`, tone: 'neutral' };
  }, [charts.latest]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[280px] rounded-xl bg-[var(--color-bg-elevated)] animate-pulse" />
        ))}
      </div>
    );
  }

  if (!charts.hasAny) {
    return (
      <IndicatorChartEmptyState
        title="技術指標"
        message="尚無技術指標資料，請調整日期區間或稍後重試。"
        onRetry={onRetry}
        onWidenRange={onWidenRange}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <IndicatorBentoCell
        title="RSI"
        option={charts.rsiOption}
        hasData={charts.hasRsiData}
        height={220}
        latestLabel="RSI10"
        latestValue={rsiBadge?.value}
        latestTone={rsiBadge?.tone}
        onRetry={onRetry}
        onWidenRange={onWidenRange}
      />
      <IndicatorBentoCell
        title="MACD"
        option={charts.macdOption}
        hasData={charts.hasMacdData}
        height={220}
        latestLabel="Hist"
        latestValue={macdBadge?.value}
        latestTone={macdBadge?.tone}
        onRetry={onRetry}
        onWidenRange={onWidenRange}
      />
      <IndicatorBentoCell
        title="KD"
        option={charts.kd.option}
        hasData={charts.kd.hasData}
        height={220}
        latestValue={kdBadge?.value}
        latestTone={kdBadge?.tone}
        onRetry={onRetry}
        onWidenRange={onWidenRange}
      />
      <IndicatorBentoCell
        title="布林通道 (20)"
        option={charts.boll.option}
        hasData={charts.boll.hasData}
        height={220}
        latestValue={bollBadge?.value}
        latestTone={bollBadge?.tone}
        onRetry={onRetry}
        onWidenRange={onWidenRange}
      />
    </div>
  );
};
