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
        ⓘ 本頁提供產業背景、價格表現、基本面、風險、技術面、籌碼面與加權價格指數對照。
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
              <li>主圖與區間漲跌幅使用所有標的皆有有效收盤價的共同起訖日；有效共同日期不足 2 天時不計算。</li>
              <li>區間漲跌幅 = (共同迄日收盤 / 共同起日收盤 − 1) × 100%。價格為證交所／櫃買中心未還原收盤價，未計入股息；除權息、分割等公司行動可能影響漲跌幅與風險指標。</li>
              <li>日漲跌幅只在合併交易日期序列的相鄰兩日皆有有效收盤價時計算，不跨缺值補算、不填零；圖表缺值保留斷線。</li>
              <li>最大回撤 = 共同區間內有效收盤價相對此前最高收盤價的最大跌幅，直接使用價格，不以日漲跌幅累乘重建。</li>
              <li>
                <strong>年化波動度</strong> = 有效日漲跌幅的樣本標準差 × √252 × 100%，至少需要 2 筆。
              </li>
              <li>上漲日比例 = 日漲跌幅大於 0 的筆數 / 有效日漲跌幅筆數 × 100%。</li>
              <li>相關係數 = 各配對同日有效日漲跌幅的 Pearson ρ；每格列出實際配對樣本數，少於 2 筆或任一序列無變異時不計算，少於 20 筆提醒樣本偏少。</li>
              <li>大盤採證交所加權價格指數（TAIEX），不含現金股利。差值為個股價格漲跌幅減去指數同期漲跌幅，單位為百分點；指數另有公司行動調整規則，與個股未還原價格並非完全相同口徑，不代表含息超額報酬。</li>
              <li>基本面各項優先採最近共同期間與口徑，無法對齊時列出各自日期且不排名。累計 EPS 不當作單季 EPS；財報缺少實際公告日，不能當作歷史當時已知資訊。</li>
              <li>均線趨勢 = 均線乖離率 (MA20 − MA60) / MA60 × 100%，正值代表短均在中均之上（趨勢偏多），為標準均線指標。</li>
            </ul>
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>
                選擇區間：{qualityMeta.requestedRange.startDate} 至 {qualityMeta.requestedRange.endDate}
              </p>
              <p>實際比較期間：{qualityMeta.analysisRange ? `${qualityMeta.analysisRange.startDate} 至 ${qualityMeta.analysisRange.endDate}` : '共同有效收盤價不足 2 天'}</p>
              <p>所有標的共同有效日漲跌幅：{qualityMeta.alignedDays} 筆；各配對樣本數以相關性面板為準。</p>
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
                    <th scope="col" className="px-3 py-2 text-right">有效日漲跌幅</th>
                    <th scope="col" className="px-3 py-2 text-right">日漲跌幅缺值率</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(qualityMeta.samplesBySymbol).map((symbol) => (
                    <tr key={symbol} className="border-t">
                      <td className="px-3 py-2 font-mono">{symbol}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{qualityMeta.samplesBySymbol[symbol]}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {qualityMeta.analysisRange ? fmtPercent(qualityMeta.missingRatioBySymbol[symbol], { fromRatio: true, decimals: 1 }) : '--'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground">缺值率以實際比較期間合併交易日期的相鄰日數為分母；無共同期間時無法計算。</p>
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
