import React, { useMemo } from 'react';
import { EChart } from '@/components/charts/EChart';
import { LedgerPanel } from '@/components/common/Ledger';
import { EmptyState } from '@/components/common/Notice';
import { institutionalCompareOption, plottedSpan, plottedSpanText } from '@/lib/charts/adapters';
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

/** 買賣超依正負上色，所以一律帶正負號（DESIGN.md 第 7 節）；格式化字串已帶負號，只補正號 */
const signedShares = (v: number | null | undefined) => `${v != null && Number.isFinite(v) && v > 0 ? '+' : ''}${fmtInstitutionalShares(v)}`;

const num = 'h-11 px-3 py-2.5 text-right font-mono text-[13.5px] tabular-nums whitespace-nowrap sm:px-4';
const th = 'h-11 px-3 text-right text-[13px] font-medium tracking-[0.04em] whitespace-nowrap text-muted-foreground sm:px-4';

/** 三大法人累計買賣超對比：每檔一條累計線，加期間彙總表 */
export function InstitutionalComparePanel({ symbols, institutionalMap, aggregateMap, symbolColors }: Props) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const hasData = symbols.some((sym) => (institutionalMap[sym]?.length ?? 0) > 0);
  // 圖與圖說用同一份累計序列：圖說的首尾日期與筆數就是圖上畫出的 X 軸
  const cumulative = useMemo(() => (hasData ? buildInstitutionalCumulative(symbols, institutionalMap) : null), [hasData, symbols, institutionalMap]);
  const option = useMemo(
    () => (cumulative ? institutionalCompareOption(cumulative, symbols, symbolColors, isDark) : null),
    [cumulative, symbols, symbolColors, isDark],
  );
  const span = plottedSpanText(plottedSpan(cumulative?.dates));

  return (
      <div className="grid gap-px bg-border">
      {!hasData || !option ? (
        <LedgerPanel>
          <EmptyState>期間內無法人資料；可換股或拉長區間再試。</EmptyState>
        </LedgerPanel>
      ) : (
        <>
          <LedgerPanel title="累計買賣超走勢" className="space-y-3">
            {span ? <p className="characteristic -mt-2" data-plotted-span>圖上 {span}；各檔自第一個有資料日起累計</p> : null}
            <p className="text-[13px] leading-relaxed text-muted-foreground">依有資料日期累計買賣超股數；正值代表累計買超，負值代表累計賣超。未依股票規模或成交量調整，不能直接視為法人偏好程度；缺值保留斷線。</p>
            <EChart title="三大法人累計買賣超" option={option} height={300} />
          </LedgerPanel>
          <LedgerPanel padded={false}>
            <div className="overflow-x-auto overscroll-x-contain">
              <table className="w-full text-sm">
                <caption className="sr-only">各檔股票的期間三大法人買賣超彙總{span ? `（${span}）` : ''}</caption>
                <thead>
                  <tr className="border-b border-border-strong">
                    <th scope="col" className={cn(th, 'text-left')}>股票</th>
                    <th scope="col" className={th}>外資</th>
                    <th scope="col" className={th}>投信</th>
                    <th scope="col" className={th}>自營</th>
                    <th scope="col" className={th}>合計</th>
                    <th scope="col" className={th}>最大單日</th>
                    <th scope="col" className={th} title="自期末日往回計算的連續買超天數，僅反映期末的最新動能">
                      期末連續買超
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {symbols.map((sym) => {
                    const agg = aggregateMap[sym];
                    return (
                      <tr key={sym} className="border-b align-top last:border-b-0">
                        <td className="h-11 px-3 py-2.5 font-mono text-[13.5px] font-medium whitespace-nowrap tabular-nums sm:px-4">
                          <span className="relative inline-flex items-center pl-3">
                            <span className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: symbolColors[sym] }} aria-hidden />
                            {sym}
                          </span>
                        </td>
                        <td className={cn(num, valueToneText(agg?.foreignNet))}>{signedShares(agg?.foreignNet)}</td>
                        <td className={cn(num, valueToneText(agg?.investmentTrustNet))}>{signedShares(agg?.investmentTrustNet)}</td>
                        <td className={cn(num, valueToneText(agg?.dealerNet))}>{signedShares(agg?.dealerNet)}</td>
                        <td className={cn(num, 'font-semibold', valueToneText(agg?.totalNet))}>{signedShares(agg?.totalNet)}</td>
                        <td className={cn(num, valueToneText(agg?.maxDailyTotalNet))}>
                          {signedShares(agg?.maxDailyTotalNet)}
                          {agg?.maxDailyTotalNetDate ? <span className="block text-[11px] text-muted-foreground">{agg.maxDailyTotalNetDate}</span> : null}
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
          </LedgerPanel>
        </>
      )}
      </div>
  );
}
