import React, { useMemo, useRef, useState } from 'react';
import { TableScrollHint } from '@/components/common/CollapsibleSection';
import type { CompareMetricsRow } from '@/lib/types/compare';
import { sortMetricsRows, type CompareSortState } from '@/lib/utils/compare';
import { fmtAmount, fmtPercent, fmtVolume } from '@/lib/utils/format';
import { valueToneText } from '@/lib/utils/tone';
import { cn } from '@/lib/cn';

const HEADERS: Array<{ key: keyof CompareMetricsRow; label: string; title?: string }> = [
  { key: 'symbol', label: '股票' },
  { key: 'totalReturnPct', label: '區間漲跌幅%' },
  { key: 'volatilityPct', label: '年化波動%', title: '有效日漲跌幅的樣本標準差 × √252 × 100%' },
  { key: 'maxDrawdownPct', label: '最大回撤%' },
  { key: 'winRatePct', label: '上漲日比例%' },
  { key: 'maxDailyGainPct', label: '最大單日漲%' },
  { key: 'maxDailyLossPct', label: '最大單日跌%' },
  { key: 'avgVolume', label: '平均量' },
  { key: 'avgAmount', label: '平均金額（TWD）' },
];

/** The volume API preserves domestic TWSE/TPEx trade values in NT dollars. */
export function formatCompareAmount(value: number | null) {
  if (value == null || !Number.isFinite(value)) return { label: '--', detail: '平均金額資料未提供' };
  return {
    label: `${value < 0 ? '-' : ''}${fmtAmount(Math.abs(value))}`,
    detail: `新臺幣 ${value.toLocaleString('zh-TW', { maximumFractionDigits: 20 })} 元（TWD）`,
  };
}

const td = 'px-3 py-3 whitespace-nowrap tabular-nums sm:px-4';

/** 比較指標表：點欄位標題排序（預設區間報酬由高到低） */
export function MetricsTable({ rows, symbolColors, benchmarkReturnPct = null }: { rows: CompareMetricsRow[]; symbolColors: Record<string, string>; benchmarkReturnPct?: number | null }) {
  const [sort, setSort] = useState<CompareSortState>({ key: 'totalReturnPct', direction: 'desc' });
  const scrollRef = useRef<HTMLDivElement>(null);
  const sorted = useMemo(() => sortMetricsRows(rows, sort), [rows, sort]);

  const toggleSort = (key: keyof CompareMetricsRow) =>
    setSort((prev) => ({
      key,
      direction: prev.key === key ? (prev.direction === 'asc' ? 'desc' : 'asc') : key === 'symbol' ? 'asc' : 'desc',
    }));

  return (
    <section aria-label="股票比較指標表" className="overflow-hidden rounded-2xl border bg-card shadow-card">
      <div className="border-b px-5 py-4">
        <h2 className="text-base font-bold">比較指標表</h2>
      </div>
      <TableScrollHint scrollRef={scrollRef} className="px-5 pt-3" />
      <div ref={scrollRef} className="overflow-x-auto overscroll-x-contain">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              {HEADERS.map((h) => {
                const active = sort.key === h.key;
                return (
                  <th
                    key={h.key}
                    scope="col"
                    aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}
                    className="px-3 py-3 text-left whitespace-nowrap sm:px-4"
                  >
                    <button
                      type="button"
                      title={h.title}
                      onClick={() => toggleSort(h.key)}
                      className="min-h-9 font-semibold text-subtle transition-colors hover:text-brand-text"
                    >
                      {h.label}
                      {active ? (sort.direction === 'asc' ? ' ▲' : ' ▼') : ''}
                    </button>
                  </th>
                );
              })}
              <th scope="col" className="px-3 py-3 text-left whitespace-nowrap sm:px-4">相對加權差值（百分點）</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const amount = formatCompareAmount(r.avgAmount);
              return (
                <tr key={r.symbol} className="border-t transition-colors hover:bg-muted/60">
                  <td className={cn(td, 'font-mono font-semibold')}>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block size-2 rounded-full" style={{ backgroundColor: symbolColors[r.symbol] }} aria-hidden />
                      {r.symbol}
                    </span>
                  </td>
                  <td className={cn(td, 'font-medium', valueToneText(r.totalReturnPct))}>{fmtPercent(r.totalReturnPct)}</td>
                  <td className={td}>{fmtPercent(r.volatilityPct)}</td>
                  <td className={td}>{fmtPercent(r.maxDrawdownPct)}</td>
                  <td className={td}>{fmtPercent(r.winRatePct)}</td>
                  <td className={cn(td, valueToneText(r.maxDailyGainPct))}>{fmtPercent(r.maxDailyGainPct)}</td>
                  <td className={cn(td, valueToneText(r.maxDailyLossPct))}>{fmtPercent(r.maxDailyLossPct)}</td>
                  <td className={td}>{r.avgVolume == null ? '--' : fmtVolume(r.avgVolume)}</td>
                  <td className={td}>
                    <span title={amount.detail} className="relative">
                      <span aria-hidden="true">{amount.label}</span>
                      <span className="sr-only">{amount.detail}</span>
                    </span>
                  </td>
                  <td className={td}>{r.totalReturnPct == null || benchmarkReturnPct == null ? '--' : (r.totalReturnPct - benchmarkReturnPct).toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero' })}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="space-y-0.5 px-4 py-2 text-xs text-muted-foreground">
        <p>點擊欄位標題可排序，空值以 -- 顯示。</p>
        <p>平均金額以新臺幣（TWD）呈現，依數值縮放為元／萬元／億元。</p>
        <p>漲跌幅依共同起訖日的未還原收盤價計算，未計入股息；「上漲日比例」為有效日漲跌幅中大於 0 的比例。</p>
        <p>「年化波動%」為有效日漲跌幅的樣本標準差 × √252；台股年化常用 252 個交易日。</p>
        <p>相對加權差值＝個股區間漲跌幅 − 加權價格指數同期漲跌幅，單位為百分點；非含息超額報酬。基準缺少起訖資料時顯示 --。</p>
      </div>
    </section>
  );
}
