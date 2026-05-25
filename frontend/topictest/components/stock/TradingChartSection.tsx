import React from 'react';
import { Loader2 } from 'lucide-react';
import type { PriceChartData } from '../../lib/types/priceChart';
import type { VolumeAnalysisResponse, PriceChangeResponse } from '../../lib/types';
import { PriceChart } from '../charts/PriceChart';
import { DateRangePicker } from '../DateRangePicker';
import { MaPeriodSelector } from './MaPeriodSelector';
import { VolumeAnalysisPanel } from './VolumeAnalysisPanel';
import { PriceChangePanel } from './PriceChangePanel';

interface Props {
  chart: PriceChartData | null;
  loading?: boolean;
  startDate: string;
  endDate: string;
  onStartChange: (d: string) => void;
  onEndChange: (d: string) => void;
  maPeriods: string;
  onMaPeriodsChange: (p: string) => void;
  maSelectorDisabled?: boolean;
  compactChart?: boolean;
  volumeData: VolumeAnalysisResponse | null;
  priceChangeData: PriceChangeResponse | null;
  showPriceChange: boolean;
  onShowPriceChangeChange: (v: boolean) => void;
}

const Box = 'div' as const;

export const TradingChartSection: React.FC<Props> = ({
  chart,
  loading,
  startDate,
  endDate,
  onStartChange,
  onEndChange,
  maPeriods,
  onMaPeriodsChange,
  maSelectorDisabled,
  compactChart = false,
  volumeData,
  priceChangeData,
  showPriceChange,
  onShowPriceChangeChange,
}) => {
  return (
    <Box className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 sm:p-5 shadow-[var(--shadow-card)]">
      <Box className="flex flex-col gap-4 mb-4 md:flex-row md:items-center md:justify-between">
        <Box>
          <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">價量走勢</h2>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            資料截至前一交易日；展示用途，非投資建議。
          </p>
        </Box>
        <Box className="flex w-full flex-col gap-3 md:w-auto md:items-end">
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            onStartChange={onStartChange}
            onEndChange={onEndChange}
          />
          <MaPeriodSelector
            value={maPeriods}
            onChange={onMaPeriodsChange}
            disabled={maSelectorDisabled || loading}
          />
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-[var(--color-text-secondary)]">
            <input
              type="checkbox"
              checked={showPriceChange}
              onChange={(e) => onShowPriceChangeChange(e.target.checked)}
              className="h-4 w-4 rounded border-[var(--color-border)] accent-[var(--brand-primary)]"
            />
            顯示漲跌明細
          </label>
        </Box>
      </Box>

      {loading && (
        <Box className="flex min-h-[280px] h-[50dvh] max-h-[420px] items-center justify-center gap-2 text-sm text-[var(--color-text-muted)]">
          <Loader2 size={20} className="animate-spin text-brand" aria-hidden />
          載入圖表中…
        </Box>
      )}

      {!loading && chart && <PriceChart data={chart} compact={compactChart} />}

      {!loading && !chart && (
        <p className="text-sm text-[var(--color-text-muted)] py-16 text-center">尚無 K 線資料</p>
      )}

      {!loading && (
        <Box className="mt-6 space-y-6 border-t border-[var(--color-border)] pt-6">
          <VolumeAnalysisPanel data={volumeData} loading={false} />
          {showPriceChange ? <PriceChangePanel data={priceChangeData} loading={false} /> : null}
        </Box>
      )}
    </Box>
  );
};
