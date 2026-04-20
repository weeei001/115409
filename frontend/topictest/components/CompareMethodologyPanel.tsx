import React from 'react';
import { motion } from 'motion/react';
import type { CompareQualityMeta } from '../lib/types';

interface Props {
  qualityMeta: CompareQualityMeta;
}

function toLocalTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('zh-TW', { hour12: false });
}

function fmtPct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

export const CompareMethodologyPanel: React.FC<Props> = ({ qualityMeta }) => {
  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border)] shadow-sm overflow-hidden"
    >
      <div className="px-5 py-4 border-b border-[var(--color-border)]">
        <h3 className="text-base font-bold text-[var(--color-text-primary)]">方法與可信度</h3>
      </div>

      <div className="p-5 grid gap-5 lg:grid-cols-[1.25fr_1fr]">
        <section className="space-y-3">
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">運算口徑</p>
          <ul className="text-xs leading-relaxed text-[var(--color-text-secondary)] space-y-1">
            <li>區間報酬 = (末日收盤 / 首日收盤 - 1) × 100%</li>
            <li>最大回撤 = 區間 NAV 相對歷史峰值之最大跌幅</li>
            <li>波動度 = 區間日報酬標準差（未年化）</li>
            <li>相關係數 = 共同交易日的日報酬 Pearson correlation</li>
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
                    <td className="px-3 py-2 text-right tabular-nums">{fmtPct(qualityMeta.missingRatioBySymbol[symbol] ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {qualityMeta.qualityWarnings.length > 0 && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">可解釋性提醒</p>
              <ul className="mt-1 text-xs text-amber-700 dark:text-amber-300 space-y-1">
                {qualityMeta.qualityWarnings.map((warning) => (
                  <li key={warning}>• {warning}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </motion.section>
  );
};
