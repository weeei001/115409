import { useMemo } from 'react';
import { EChart } from '@/components/charts/EChart';
import { LedgerPanel } from '@/components/common/Ledger';
import { EmptyState } from '@/components/common/Notice';
import { riskReturnScatterOption } from '@/lib/charts/adapters';
import { useTheme } from '@/lib/theme/ThemeContext';
import type { CompareMetricsRow } from '@/lib/types/compare';

/** 風險報酬散點：X 軸年化波動、Y 軸區間報酬。內容放在「延伸分析」索引表的一列裡，打開才掛載 */
export function RiskReturnScatter({ rows, symbolColors }: { rows: CompareMetricsRow[]; symbolColors: Record<string, string> }) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const points = useMemo(
    () =>
      rows
        .filter((r) => r.volatilityPct != null && r.totalReturnPct != null)
        .map((r) => ({ symbol: r.symbol, x: r.volatilityPct as number, y: r.totalReturnPct as number, color: symbolColors[r.symbol] })),
    [rows, symbolColors],
  );
  const option = useMemo(() => riskReturnScatterOption(points, isDark), [points, isDark]);

  if (!option) {
    const missing = rows.filter((r) => r.volatilityPct == null || r.totalReturnPct == null).map((r) => r.symbol);
    return (
      <LedgerPanel className="space-y-1 text-center">
          <EmptyState className="pb-2">資料不足，無法繪製波動與漲跌幅分佈</EmptyState>
          {missing.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              缺少波動度或漲跌幅：<span className="font-mono tabular-nums">{missing.join('、')}</span>
            </p>
          ) : null}
          <p className="pb-4 text-xs text-muted-foreground">下一步：拉長比較區間或換成資料較完整的個股。</p>
      </LedgerPanel>
    );
  }

  return (
      <LedgerPanel className="space-y-3">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          X 軸＝年化波動度（%，越右波動越大），Y 軸＝區間價格漲跌幅（%）。象限以「樣本波動中位數」與「0% 漲跌幅」切分。
        </p>
        <EChart title="波動與漲跌幅散點圖：X 軸波動度、Y 軸區間漲跌幅，四象限以中位波動與 0% 漲跌幅切分" option={option} height={340} />
        <div className="space-y-0.5 border-t pt-3 text-xs leading-relaxed text-muted-foreground">
          <p>上半部為期間價格上漲，下半部為下跌；未計入股息，且除權息、分割等公司行動可能影響價格變化。</p>
          <p>
            注意：象限的「高/低波動」是<strong className="font-medium text-subtle">已選樣本之間的相對位置</strong>，非絕對風險評等。
          </p>
        </div>
      </LedgerPanel>
  );
}
