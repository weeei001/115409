import React, { useMemo } from 'react';
import type { InstitutionalTradeListResponse } from '../../lib/types';
import { EChartPanel } from '../charts/EChartPanel';
import { useTheme } from '../../lib/ThemeContext';
import { institutionalToCumulativeOption } from '../../lib/utils/chartAdapters';

interface Props {
  data: InstitutionalTradeListResponse | null;
  loading?: boolean;
}

export const InstitutionalCumulativeChart: React.FC<Props> = ({ data, loading }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const option = useMemo(
    () => institutionalToCumulativeOption(data, isDark),
    [data, isDark],
  );

  if (loading) {
    return <div className="h-[260px] rounded-xl bg-[var(--color-bg-elevated)] animate-pulse" aria-hidden />;
  }

  if (!option) {
    return (
      <p className="text-sm text-[var(--color-text-muted)] py-6 text-center">尚無累積買賣超資料</p>
    );
  }

  return (
    <EChartPanel title="法人累積買賣超（張）" option={option} height={260} />
  );
};
