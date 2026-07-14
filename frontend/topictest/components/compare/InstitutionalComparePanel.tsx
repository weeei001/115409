import React, { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import { Landmark } from 'lucide-react';
import type { InstitutionalTradeListResponse } from '../../lib/types/stockDashboard';
import {
  buildInstitutionalCumulativeChart,
  COMPARE_COLOR_PALETTE,
  type InstitutionalAggregate,
} from '../../lib/utils/compare';
import { useTheme } from '../../lib/ThemeContext';
import { getChartPalette } from '../../lib/chartTheme';
import {
  fmtInstitutionalAxisLabel,
  fmtInstitutionalShares,
} from '../../lib/utils/format';
import { getValueToneClass } from '../../lib/utils/valueToneClass';
import { EChartPanel } from '../charts/EChartPanel';
import { BentoCardShell } from '../stock/bento/BentoCardShell';

interface Props {
  symbols: string[];
  institutionalMap: Record<string, InstitutionalTradeListResponse | null>;
  aggregateMap: Record<string, InstitutionalAggregate>;
  symbolColors: Record<string, string>;
}

function fallbackColor(symbol: string): string {
  let hash = 0;
  for (let i = 0; i < symbol.length; i += 1) {
    hash = (hash << 5) - hash + symbol.charCodeAt(i);
    hash |= 0;
  }
  return COMPARE_COLOR_PALETTE[Math.abs(hash) % COMPARE_COLOR_PALETTE.length];
}

export const InstitutionalComparePanel: React.FC<Props> = ({
  symbols,
  institutionalMap,
  aggregateMap,
  symbolColors,
}) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const cumulative = useMemo(
    () => buildInstitutionalCumulativeChart(symbols, institutionalMap),
    [symbols, institutionalMap],
  );

  const hasData = symbols.some((sym) => (institutionalMap[sym]?.data?.length ?? 0) > 0);

  const option: EChartsOption | null = useMemo(() => {
    if (!hasData) return null;
    const palette = getChartPalette(isDark);

    const dates = cumulative.map((row) => row.date);
    const series = symbols.map((sym) => ({
      name: sym,
      type: 'line' as const,
      showSymbol: false,
      smooth: false,
      connectNulls: true,
      lineStyle: { width: 2, color: symbolColors[sym] ?? fallbackColor(sym) },
      itemStyle: { color: symbolColors[sym] ?? fallbackColor(sym) },
      data: cumulative.map((row) => (typeof row[sym] === 'number' ? (row[sym] as number) : null)),
    }));

    return {
      animation: false,
      grid: { left: 60, right: 16, top: 28, bottom: 56 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: palette.tooltipBg,
        borderColor: palette.grid,
        textStyle: { color: palette.tooltipText, fontSize: 12 },
        valueFormatter: (v) =>
          typeof v === 'number' ? fmtInstitutionalShares(v) : '—',
      },
      legend: {
        type: 'scroll',
        bottom: 0,
        textStyle: { color: palette.tick, fontSize: 11 },
        data: symbols,
      },
      xAxis: {
        type: 'category',
        data: dates,
        axisLine: { lineStyle: { color: palette.grid } },
        axisLabel: { color: palette.tick, fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        splitLine: { lineStyle: { color: palette.grid } },
        axisLabel: {
          color: palette.tick,
          fontSize: 11,
          formatter: (v: number) => fmtInstitutionalAxisLabel(v),
        },
      },
      series,
    };
  }, [hasData, symbols, cumulative, symbolColors, isDark]);

  const tableRows = symbols.map((sym) => {
    const agg = aggregateMap[sym];
    return {
      symbol: sym,
      color: symbolColors[sym] ?? fallbackColor(sym),
      foreignNet: agg?.foreignNet ?? null,
      investmentTrustNet: agg?.investmentTrustNet ?? null,
      dealerNet: agg?.dealerNet ?? null,
      totalNet: agg?.totalNet ?? null,
      maxDailyTotalNet: agg?.maxDailyTotalNet ?? null,
      maxDailyTotalNetDate: agg?.maxDailyTotalNetDate ?? null,
      consecutiveBuyDays: agg?.consecutiveBuyDays ?? 0,
    };
  });

  return (
    <BentoCardShell
      icon={Landmark}
      title="三大法人累計買賣超對比"
      isEmpty={!hasData}
      emptyText="期間內無法人資料；可換股或拉長區間再試。"
    >
      <p className="text-[11px] text-[var(--color-text-muted)] -mt-1">
        曲線越往上代表期間累計買超越多；負值代表累計賣超。
      </p>

      <div className="min-h-[260px]">
        {option ? <EChartPanel title="三大法人累計買賣超" option={option} height={300} bare /> : null}
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--color-border)] mt-1">
        <table className="w-full text-xs">
          <thead className="bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)]">
            <tr>
              <th className="px-3 py-2 text-left">股票</th>
              <th className="px-3 py-2 text-right">外資</th>
              <th className="px-3 py-2 text-right">投信</th>
              <th className="px-3 py-2 text-right">自營</th>
              <th className="px-3 py-2 text-right">合計</th>
              <th className="px-3 py-2 text-right">最大單日</th>
              <th
                className="px-3 py-2 text-right"
                title="自期末日往回計算的連續買超天數，僅反映期末的最新動能"
              >
                期末連續買超
              </th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row) => (
              <tr
                key={row.symbol}
                className="border-t border-[var(--color-border)]"
              >
                <td className="px-3 py-2 font-mono whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: row.color }}
                      aria-hidden
                    />
                    {row.symbol}
                  </span>
                </td>
                <td className={`px-3 py-2 text-right font-mono tabular-nums ${getValueToneClass(row.foreignNet)}`}>
                  {fmtInstitutionalShares(row.foreignNet)}
                </td>
                <td className={`px-3 py-2 text-right font-mono tabular-nums ${getValueToneClass(row.investmentTrustNet)}`}>
                  {fmtInstitutionalShares(row.investmentTrustNet)}
                </td>
                <td className={`px-3 py-2 text-right font-mono tabular-nums ${getValueToneClass(row.dealerNet)}`}>
                  {fmtInstitutionalShares(row.dealerNet)}
                </td>
                <td className={`px-3 py-2 text-right font-mono tabular-nums font-semibold ${getValueToneClass(row.totalNet)}`}>
                  {fmtInstitutionalShares(row.totalNet)}
                </td>
                <td className={`px-3 py-2 text-right font-mono tabular-nums ${getValueToneClass(row.maxDailyTotalNet)}`}>
                  {fmtInstitutionalShares(row.maxDailyTotalNet)}
                  {row.maxDailyTotalNetDate ? (
                    <span className="block text-[10px] text-[var(--color-text-muted)]">
                      {row.maxDailyTotalNetDate}
                    </span>
                  ) : null}
                </td>
                <td
                  className="px-3 py-2 text-right font-mono tabular-nums text-[var(--color-text-primary)]"
                  title="自期末日往回計算的連續買超天數"
                >
                  {row.consecutiveBuyDays > 0 ? `${row.consecutiveBuyDays} 天` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </BentoCardShell>
  );
};
