import React, { useMemo } from 'react';
import type { InstitutionalTradeListResponse } from '../../lib/types';
import { EChartPanel } from '../charts/EChartPanel';
import { useTheme } from '../../lib/ThemeContext';
import { institutionalToFlowChartOption } from '../../lib/utils/chartAdapters';
import { ChartLegendBar } from '../charts/ChartLegendBar';
import { getChartPalette } from '../../lib/chartTheme';

interface Props {
  data: InstitutionalTradeListResponse | null;
  loading?: boolean;
  error?: string | null;
}

export const InstitutionalFlowChart: React.FC<Props> = ({ data, loading, error }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const option = useMemo(
    () => institutionalToFlowChartOption(data, isDark),
    [data, isDark]
  );

  if (loading) {
    return <div className="h-[300px] rounded-xl bg-[var(--color-bg-elevated)] animate-pulse" aria-hidden />;
  }

  if (error) {
    return (
      <p className="text-sm text-[var(--color-text-muted)] py-8 text-center">{error}</p>
    );
  }

  if (!option) {
    return (
      <p className="text-sm text-[var(--color-text-muted)] py-8 text-center">尚無法人買賣超資料</p>
    );
  }

  const palette = getChartPalette(isDark);

  return (
    <div className="space-y-2">
      <ChartLegendBar
        items={[
          { label: '外資', color: palette.brand },
          { label: '投信', color: palette.tickMuted },
          { label: '自營', color: palette.referenceLine },
          { label: '合計', color: palette.tick },
        ]}
      />
      <EChartPanel title="三大法人買賣超（股）" option={option} height={280} />
    </div>
  );
};
