import { AlertTriangle } from 'lucide-react';
import type { CompareQualityMeta } from '@/lib/types/compare';
import { fmtPercent } from '@/lib/utils/format';
import { formatTaipei } from '@/lib/utils/date';
import { cn } from '@/lib/cn';

const th = 'h-11 px-3 text-[13px] font-medium tracking-[0.04em] text-muted-foreground sm:px-4';

/** 方法與可信度：計算方式、分析區間、資料品質。放在「延伸分析」裡，預設收合；有提醒時摘要寫出提醒數 */
export function MethodologyPanel({ qualityMeta }: { qualityMeta: CompareQualityMeta }) {
  const warningCount = qualityMeta.qualityWarnings.length;
  return (
        <div className="grid gap-px bg-border lg:grid-cols-12">
          <section data-stagger className="min-w-0 space-y-3 bg-card p-4 sm:p-5 lg:col-span-7">
            <h4 className="text-[13px] font-medium tracking-[0.04em] text-muted-foreground">計算方式</h4>
            <ul className="list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-subtle marker:text-muted-foreground">
              <li>主圖與區間漲跌幅使用所有標的皆有有效收盤價的共同起訖日；有效共同日期不足 2 天時不計算。</li>
              <li>區間漲跌幅 = (共同迄日收盤 / 共同起日收盤 − 1) × 100%。價格為證交所／櫃買中心未還原收盤價，未計入股息；除權息、分割可能影響漲跌幅與風險指標。</li>
              <li>日漲跌幅只在合併交易日期序列的相鄰兩日皆有有效收盤價時計算，不跨缺值補算、不填零；圖表缺值保留斷線。</li>
              <li>最大回撤 = 共同區間內有效收盤價相對此前最高收盤價的最大跌幅，直接使用價格，不以日漲跌幅累乘重建。</li>
              <li>
                <strong className="font-medium text-foreground">年化波動</strong> = 有效日漲跌幅的樣本標準差 × √252 × 100%，至少需要 2 筆。
              </li>
              <li>上漲日比例 = 日漲跌幅大於 0 的筆數 / 有效日漲跌幅筆數 × 100%。</li>
              <li>相關係數 ρ：以兩檔同一天的日漲跌幅計算，介於 −1 到 +1；每格列出實際配對樣本數，少於 2 筆或任一序列無變異時不計算，少於 20 筆提醒樣本偏少。</li>
              <li>大盤採加權指數（不含息）。差值為個股價格漲跌幅減去指數同期漲跌幅，單位為百分點；指數另有除權息調整規則，和個股未還原價格的計算方式不完全相同，不代表含息超額報酬。</li>
              <li>基本面各項優先採最近的共同期間與同一編製基礎（合併／個別），無法對齊時列出各自日期且不排名。累計 EPS 不當作單季 EPS；財報實際公布日未保存，不能當作當時已公開的資訊。</li>
              <li>均線趨勢 = 均線乖離率 (MA20 − MA60) / MA60 × 100%，正值代表短均在中均之上（趨勢偏多），為標準均線指標。</li>
            </ul>
            <div className="space-y-1 border-t pt-3 font-mono text-xs leading-relaxed text-muted-foreground tabular-nums">
              <p className="text-foreground">實際比較期間：{qualityMeta.analysisRange ? `${qualityMeta.analysisRange.startDate} → ${qualityMeta.analysisRange.endDate}` : '共同有效收盤價不足 2 天'}</p>
              <p>
                查詢條件：{qualityMeta.requestedRange.startDate} → {qualityMeta.requestedRange.endDate}（結束日期當天不一定有資料）
              </p>
              <p>所有標的共同有效日漲跌幅：{qualityMeta.alignedDays} 筆；各配對樣本數以相關性面板為準。</p>
              <p>資料時間：{formatTaipei(qualityMeta.generatedAt, { hour12: false }, qualityMeta.generatedAt)}</p>
            </div>
          </section>

          <section data-stagger className="min-w-0 space-y-3 bg-card p-4 sm:p-5 lg:col-span-5">
            <h4 className="text-[13px] font-medium tracking-[0.04em] text-muted-foreground">資料品質摘要</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-strong">
                    <th scope="col" className={cn(th, 'pl-0 text-left sm:pl-0')}>股票</th>
                    <th scope="col" className={cn(th, 'text-right')}>有效日漲跌幅</th>
                    <th scope="col" className={cn(th, 'pr-0 text-right sm:pr-0')}>日漲跌幅缺值率</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(qualityMeta.samplesBySymbol).map((symbol) => (
                    <tr key={symbol} className="border-b last:border-b-0">
                      <td className="h-11 pr-3 font-mono text-[13.5px] font-medium tabular-nums">{symbol}</td>
                      <td className="h-11 px-3 text-right font-mono text-[13.5px] tabular-nums sm:px-4">{qualityMeta.samplesBySymbol[symbol]}</td>
                      <td className="h-11 pl-3 text-right font-mono text-[13.5px] tabular-nums">
                        {qualityMeta.analysisRange ? fmtPercent(qualityMeta.missingRatioBySymbol[symbol], { fromRatio: true, decimals: 1 }) : '--'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">缺值率以實際比較期間合併交易日期的相鄰日數為分母；無共同期間時無法計算。</p>
            {warningCount > 0 ? (
              <div className="border border-l-2 border-warning-border bg-warning-muted px-3 py-2.5 text-warning">
                <p className="flex items-center gap-1.5 text-[13px] font-medium">
                  <AlertTriangle size={14} aria-hidden />
                  資料提醒
                </p>
                <ul className="mt-1 space-y-1 text-xs leading-relaxed">
                  {qualityMeta.qualityWarnings.map((warning) => (
                    <li key={warning}>• {warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        </div>
  );
}
