import React, { useMemo } from 'react';
import { Landmark } from 'lucide-react';
import { EChart } from '@/components/charts/EChart';
import { EmptyState } from '@/components/common/Notice';
import { Panel } from '@/components/common/Panel';
import { institutionalCompareOption } from '@/lib/charts/adapters';
import { useTheme } from '@/lib/theme/ThemeContext';
import type { InstitutionalAggregate } from '@/lib/types/compare';
import type { InstitutionalDay } from '@/lib/types/view';
import { buildInstitutionalCumulative } from '@/lib/utils/compare';
import { fmtInstitutionalShares } from '@/lib/utils/format';
import { valueToneText } from '@/lib/utils/tone';
import { cn } from '@/lib/cn';

interface Props {
  symbols: string[];
  institutionalMap: Record<string, InstitutionalDay[] | null>;
  aggregateMap: Record<string, InstitutionalAggregate>;
  symbolColors: Record<string, string>;
}

const num = 'px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap';

/** 三大法人累計買賣超對比：每檔一條累計線，加期間彙總表 */
export function InstitutionalComparePanel({ symbols, institutionalMap, aggregateMap, symbolColors }: Props) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const hasData = symbols.some((sym) => (institutionalMap[sym]?.length ?? 0) > 0);
  const option = useMemo(
    () => (hasData ? institutionalCompareOption(buildInstitutionalCumulative(symbols, institutionalMap), symbols, symbolColors, isDark) : null),
    [hasData, symbols, institutionalMap, symbolColors, isDark],
  );

  return (
    <Panel icon={Landmark} title="三大法人累計買賣超對比" className="rounded-2xl">
      {!hasData || !option ? (
        <EmptyState>期間內無法人資料；可換股或拉長區間再試。</EmptyState>
      ) : (
        <div className="space-y-3">
          <p className="text-[11px] text-muted-foreground">曲線越往上代表期間累計買超越多；負值代表累計賣超。</p>
          <EChart title="三大法人累計買賣超" option={option} height={300} />
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-xs">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left">股票</th>
                  <th scope="col" className="px-3 py-2 text-right">外資</th>
                  <th scope="col" className="px-3 py-2 text-right">投信</th>
                  <th scope="col" className="px-3 py-2 text-right">自營</th>
                  <th scope="col" className="px-3 py-2 text-right">合計</th>
                  <th scope="col" className="px-3 py-2 text-right">最大單日</th>
                  <th scope="col" className="px-3 py-2 text-right whitespace-nowrap" title="自期末日往回計算的連續買超天數，僅反映期末的最新動能">
                    期末連續買超
                  </th>
                </tr>
              </thead>
              <tbody>
                {symbols.map((sym) => {
                  const agg = aggregateMap[sym];
                  return (
                    <tr key={sym} className="border-t">
                      <td className="px-3 py-2 font-mono whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="inline-block size-2 rounded-full" style={{ backgroundColor: symbolColors[sym] }} aria-hidden />
                          {sym}
                        </span>
                      </td>
                      <td className={cn(num, valueToneText(agg?.foreignNet))}>{fmtInstitutionalShares(agg?.foreignNet)}</td>
                      <td className={cn(num, valueToneText(agg?.investmentTrustNet))}>{fmtInstitutionalShares(agg?.investmentTrustNet)}</td>
                      <td className={cn(num, valueToneText(agg?.dealerNet))}>{fmtInstitutionalShares(agg?.dealerNet)}</td>
                      <td className={cn(num, 'font-semibold', valueToneText(agg?.totalNet))}>{fmtInstitutionalShares(agg?.totalNet)}</td>
                      <td className={cn(num, valueToneText(agg?.maxDailyTotalNet))}>
                        {fmtInstitutionalShares(agg?.maxDailyTotalNet)}
                        {agg?.maxDailyTotalNetDate ? <span className="block text-[10px] text-muted-foreground">{agg.maxDailyTotalNetDate}</span> : null}
                      </td>
                      <td className={num} title="自期末日往回計算的連續買超天數">
                        {agg && agg.consecutiveBuyDays > 0 ? `${agg.consecutiveBuyDays} 天` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  );
}
