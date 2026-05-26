import React, { useMemo } from 'react';
import type { ChipsVolumeChartRow } from '../../lib/types';
import { EChartPanel } from '../charts/EChartPanel';
import { useTheme } from '../../lib/ThemeContext';
import { chipsVolumeToChartOption } from '../../lib/utils/chartAdapters';

interface Props {
  rows: ChipsVolumeChartRow[] | null;
  loading?: boolean;
}

export const ChipsVolumeChart: React.FC<Props> = ({ rows, loading }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const option = useMemo(() => chipsVolumeToChartOption(rows ?? [], isDark), [rows, isDark]);

  if (loading) {
    return <div className="h-[300px] rounded-xl bg-[var(--color-bg-elevated)] animate-pulse" aria-hidden />;
  }

  if (!option) {
    return (
      <p className="text-sm text-[var(--color-text-muted)] py-6 text-center">尚無價量籌碼整合資料</p>
    );
  }

  return <EChartPanel title="股價與法人合計" option={option} height={300} />;
};
