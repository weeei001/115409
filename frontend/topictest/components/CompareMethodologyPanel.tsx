import React from 'react';
import { motion } from 'motion/react';
import { Info } from 'lucide-react';
import type { CompareQualityMeta } from '../lib/types';
import { fmtPercent } from '../lib/utils/format';

interface Props {
  qualityMeta: CompareQualityMeta;
}

function toLocalTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('zh-TW', { hour12: false });
}

const fmtRatioPct = (ratio: number): string => fmtPercent(ratio, { fromRatio: true, decimals: 1 });

export const CompareMethodologyPanel: React.FC<Props> = ({ qualityMeta }) => {
  const autoOpen = qualityMeta.qualityWarnings.length > 0;
  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border)] shadow-[var(--shadow-card)] overflow-hidden"
    >
      <p className="px-5 py-2.5 text-[11px] text-[var(--color-text-muted)] border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)]/30">
        ⓘ 本比較頁面僅含技術面與籌碼面，<strong>不含基本面、產業類別與大盤對標</strong>；資料為市場資訊呈現，非投資建議。
      </p>
      <details open={autoOpen} className="group">
        <summary className="flex items-center justify-between gap-2 px-5 py-4 cursor-pointer list-none border-b border-transparent group-open:border-[var(--color-border)] hover:bg-[var(--color-bg-elevated)]/40 transition-colors">
          <h3 className="inline-flex items-center gap-2 text-base font-bold text-[var(--color-text-primary)]">
            <Info size={16} className="text-brand" aria-hidden />
            方法與可信度
            {autoOpen && (
              <span className="ml-2 inline-flex items-center rounded-full bg-down-muted px-2 py-0.5 text-[10px] font-medium text-down-emphasis border border-down/30">
                {qualityMeta.qualityWarnings.length} 項提醒
              </span>
            )}
          </h3>
          <span className="text-xs text-[var(--color-text-muted)] select-none group-open:hidden">展開</span>
          <span className="text-xs text-[var(--color-text-muted)] select-none hidden group-open:inline">收合</span>
        </summary>

      <div className="p-5 grid gap-5 lg:grid-cols-[1.25fr_1fr]">
        <section className="space-y-3">
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">運算口徑</p>
          <ul className="text-xs leading-relaxed text-[var(--color-text-secondary)] space-y-1">
            <li>區間報酬 = (末日收盤 / 首日收盤 − 1) × 100%</li>
            <li>最大回撤 = 區間 NAV 相對歷史峰值之最大跌幅</li>
            <li>
              <strong>年化波動度</strong> = 區間日報酬標準差 × √252 × 100%
            </li>
            <li>相關係數 = 共同交易日的日報酬 Pearson correlation</li>
            <li>
              均線趨勢 = 均線乖離率 (MA20 − MA60) / MA60 × 100%，正值代表短均在中均之上（趨勢偏多），為標準均線指標。
            </li>
          </ul>
          <div className="text-xs text-[var(--color-text-muted)] space-y-1">
            <p>分析區間：{qualityMeta.analysisRange.startDate} 至 {qualityMeta.analysisRange.endDate}</p>
            <p>共同交易日：{qualityMeta.alignedDays} 天</p>
            <p>資料時間戳：{toLocalTime(qualityMeta.generatedAt)}</p>
          </div>
        </section>

        <section className="space-y-3">
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">資料品質摘要</p>
          <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)]">
                <tr>
                  <th className="px-3 py-2 text-left">股票</th>
                  <th className="px-3 py-2 text-right">有效樣本</th>
                  <th className="px-3 py-2 text-right">缺值率</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(qualityMeta.samplesBySymbol).map((symbol) => (
                  <tr key={symbol} className="border-t border-[var(--color-border)] text-[var(--color-text-primary)]">
                    <td className="px-3 py-2 font-mono">{symbol}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{qualityMeta.samplesBySymbol[symbol]}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtRatioPct(qualityMeta.missingRatioBySymbol[symbol] ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {qualityMeta.qualityWarnings.length > 0 && (
            <div className="ui-alert-warning rounded-xl px-3 py-2">
              <p className="text-xs font-semibold">可解釋性提醒</p>
              <ul className="mt-1 text-xs space-y-1">
                {qualityMeta.qualityWarnings.map((warning) => (
                  <li key={warning}>• {warning}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
      </details>
    </motion.section>
  );
};
