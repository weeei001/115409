import React from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import type { CompareQualityMeta } from '@/lib/types/compare';
import { fmtPercent } from '@/lib/utils/format';

function toLocalTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('zh-TW', { hour12: false });
}

/** 方法與可信度：運算口徑、分析區間、資料品質；有提醒時自動展開 */
export function MethodologyPanel({ qualityMeta }: { qualityMeta: CompareQualityMeta }) {
  const warningCount = qualityMeta.qualityWarnings.length;
  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-card">
      <p className="border-b bg-muted/40 px-5 py-2.5 text-[11px] text-muted-foreground">
        ⓘ 本比較頁面僅含技術面與籌碼面，<strong>不含基本面、產業類別與大盤對標</strong>；資料為市場資訊呈現，非投資建議。
      </p>
      <details open={warningCount > 0} className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 border-b border-transparent px-5 py-4 transition-colors group-open:border-border hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
          <h2 className="inline-flex flex-wrap items-center gap-2 text-base font-bold">
            <Info size={16} className="text-brand" aria-hidden />
            方法與可信度
            {warningCount > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-warning-border bg-warning-muted px-2 py-0.5 text-[10px] font-medium text-warning">
                <AlertTriangle size={10} aria-hidden />
                {warningCount} 項提醒
              </span>
            ) : null}
          </h2>
          <span className="text-xs text-muted-foreground select-none group-open:hidden">展開</span>
          <span className="hidden text-xs text-muted-foreground select-none group-open:inline">收合</span>
        </summary>

        <div className="grid gap-5 p-5 lg:grid-cols-[1.25fr_1fr]">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">運算口徑</h3>
            <ul className="space-y-1 text-xs leading-relaxed text-subtle">
              <li>區間報酬 = (末日收盤 / 首日收盤 − 1) × 100%</li>
              <li>最大回撤 = 區間 NAV 相對歷史峰值之最大跌幅</li>
              <li>
                <strong>年化波動度</strong> = 區間日報酬標準差 × √252 × 100%
              </li>
              <li>相關係數 = 共同交易日的日報酬 Pearson correlation</li>
              <li>均線趨勢 = 均線乖離率 (MA20 − MA60) / MA60 × 100%，正值代表短均在中均之上（趨勢偏多），為標準均線指標。</li>
            </ul>
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>
                分析區間：{qualityMeta.analysisRange.startDate} 至 {qualityMeta.analysisRange.endDate}
              </p>
              <p>共同交易日：{qualityMeta.alignedDays} 天</p>
              <p>資料時間戳：{toLocalTime(qualityMeta.generatedAt)}</p>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">資料品質摘要</h3>
            <div className="overflow-hidden rounded-xl border">
              <table className="w-full text-xs">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left">股票</th>
                    <th scope="col" className="px-3 py-2 text-right">有效樣本</th>
                    <th scope="col" className="px-3 py-2 text-right">缺值率</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(qualityMeta.samplesBySymbol).map((symbol) => (
                    <tr key={symbol} className="border-t">
                      <td className="px-3 py-2 font-mono">{symbol}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{qualityMeta.samplesBySymbol[symbol]}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {fmtPercent(qualityMeta.missingRatioBySymbol[symbol] ?? 0, { fromRatio: true, decimals: 1 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {warningCount > 0 ? (
              <div className="rounded-xl border border-warning-border bg-warning-muted px-3 py-2 text-warning">
                <p className="text-xs font-semibold">可解釋性提醒</p>
                <ul className="mt-1 space-y-1 text-xs">
                  {qualityMeta.qualityWarnings.map((warning) => (
                    <li key={warning}>• {warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        </div>
      </details>
    </section>
  );
}
