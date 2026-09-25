import React, { useMemo } from 'react';
import { EChart } from '@/components/charts/EChart';
import { riskReturnScatterOption } from '@/lib/charts/adapters';
import { useTheme } from '@/lib/theme/ThemeContext';
import type { CompareMetricsRow } from '@/lib/types/compare';

/** 風險報酬散點：X 軸年化波動、Y 軸區間報酬 */
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
      <section className="space-y-1.5 rounded-2xl border bg-card px-5 py-10 text-center shadow-card">
        <p className="text-sm font-medium">資料不足，無法繪製波動與漲跌幅分佈</p>
        {missing.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            缺少波動度或漲跌幅：<span className="font-mono">{missing.join('、')}</span>
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">下一步：拉長比較區間或換成資料較完整的個股。</p>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-card">
      <div className="space-y-1 border-b px-5 py-4">
        <h2 className="text-base font-bold">波動與漲跌幅分佈</h2>
        <p className="text-xs text-muted-foreground">
          X 軸＝年化波動度（%，越右波動越大），Y 軸＝區間價格漲跌幅（%）。象限以「樣本波動中位數」與「0% 漲跌幅」切分。
        </p>
      </div>
      <div className="p-4">
        <EChart title="波動與漲跌幅散點圖：X 軸波動度、Y 軸區間漲跌幅，四象限以中位波動與 0% 漲跌幅切分" option={option} height={340} />
      </div>
      <div className="-mt-1 space-y-0.5 px-5 pb-4 text-[11px] leading-relaxed text-muted-foreground">
        <p>上半部為期間價格上漲，下半部為下跌；未計入股息，且除權息、分割等公司行動可能影響價格變化。</p>
        <p>
          注意：象限的「高/低波動」是<strong>已選樣本之間的相對位置</strong>，非絕對風險評等。
        </p>
      </div>
    </section>
  );
}
