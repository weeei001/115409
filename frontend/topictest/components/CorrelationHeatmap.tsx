import React from 'react';
import { motion } from 'motion/react';
import { useTheme } from '../lib/ThemeContext';
import type { ChartPalette } from '../lib/chartTheme';
import { getChartPalette } from '../lib/chartTheme';

interface Props {
  symbols: string[];
  matrix: Record<string, Record<string, number | null>>;
  /** 共同交易日數，用於 cell tooltip 顯示樣本數 */
  alignedDays?: number;
}

function colorForCorrelation(value: number | null, isDark: boolean, nullBg: string): string {
  if (value == null) return nullBg;

  const clamped = Math.max(-1, Math.min(1, value));
  const normalized = (clamped + 1) / 2; // -1 -> 0, +1 -> 1

  // Hue: 210 (blue, negative) -> 24 (orange, positive)
  const hue = 210 - normalized * 186;
  const saturation = 82;
  const lightness = isDark ? 42 + normalized * 10 : 84 - normalized * 28;

  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

function textColorForCorrelation(value: number | null, p: ChartPalette): string {
  if (value == null) return p.heatmapTextStrong;
  const abs = Math.abs(value);
  return abs >= 0.45 ? p.heatmapTextStrong : p.heatmapTextWeak;
}

/** 依標準閾值（|ρ|≥0.7 高、0.3–0.7 中度、<0.3 低）回傳中文解讀標籤。 */
function interpretRho(rho: number): string {
  const abs = Math.abs(rho);
  if (abs < 0.3) return '低相關';
  const dir = rho >= 0 ? '正相關' : '負相關';
  return abs >= 0.7 ? `高度${dir}` : `中度${dir}`;
}

/** 把 ρ 翻成「分散風險」白話結論。 */
function diversificationVerdict(rho: number): {
  label: string;
  tone: 'good' | 'mid' | 'weak';
  detail: string;
} {
  const abs = Math.abs(rho);
  if (abs < 0.3) {
    return {
      label: '分散效果佳',
      tone: 'good',
      detail: rho >= 0
        ? '兩檔走勢相對獨立，同時持有可分散個股風險。'
        : '兩檔走勢相對獨立，同時持有可分散個股風險。',
    };
  }
  if (abs < 0.7) {
    return {
      label: '分散效果有限',
      tone: 'mid',
      detail: rho >= 0
        ? '兩檔多數時候同向波動，分散效果打折。'
        : '兩檔多數時候反向波動，可部分對沖、但波動仍互有牽動。',
    };
  }
  return {
    label: rho >= 0 ? '走勢高度連動' : '走勢高度互沖',
    tone: rho >= 0 ? 'weak' : 'good',
    detail: rho >= 0
      ? '兩檔多半同漲同跌，等同集中持有單一風險來源。'
      : '兩檔幾乎相反，可作為避險配對。',
  };
}

const VERDICT_TONE_CLASS: Record<'good' | 'mid' | 'weak', string> = {
  good: 'bg-up-muted text-up-emphasis border-up/30',
  mid: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:border-amber-500/30',
  weak: 'bg-down-muted text-down-emphasis border-down/30',
};

export const CorrelationHeatmap: React.FC<Props> = ({ symbols, matrix, alignedDays }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const c = getChartPalette(isDark);

  if (symbols.length < 2) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border)] shadow-sm px-5 py-12 text-center">
          <p className="text-sm text-[var(--color-text-muted)]">資料不足，至少需要 2 檔股票才能計算相關性</p>
        </div>
      </motion.section>
    );
  }

  // N=2：只有一個有意義的相關係數，用「ρ 主視覺 + 分散效果結論」的單欄佈局填滿空間，避免大片留白。
  if (symbols.length === 2) {
    const [a, b] = symbols;
    const rho = matrix[a]?.[b] ?? null;
    const verdict = rho == null ? null : diversificationVerdict(rho);
    const rhoBarPct = rho == null ? null : Math.round(((Math.max(-1, Math.min(1, rho)) + 1) / 2) * 100);
    return (
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border)] shadow-sm overflow-hidden h-full flex flex-col">
          <div className="px-5 py-4 border-b border-[var(--color-border)] space-y-1">
            <h3 className="text-base font-bold text-[var(--color-text-primary)]">報酬率相關性</h3>
            <p className="text-xs text-[var(--color-text-muted)]">
              共同交易日的日報酬 Pearson ρ；用來判斷兩檔同向程度與分散風險效果。
            </p>
          </div>

          <div className="px-5 py-5 flex-1 flex flex-col gap-4">
            {/* 主視覺：配對 + ρ */}
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-sm text-[var(--color-text-secondary)]">{a}</span>
                <span className="text-xs text-[var(--color-text-muted)]">×</span>
                <span className="font-mono text-sm text-[var(--color-text-secondary)]">{b}</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-xs text-[var(--color-text-muted)]">ρ =</span>
                <span className="font-mono text-4xl font-bold tabular-nums text-[var(--color-text-primary)] leading-none">
                  {rho == null ? '—' : rho.toFixed(2)}
                </span>
              </div>
            </div>

            {/* ρ 在 [-1, +1] 軸上的相對位置 */}
            <div className="space-y-1.5">
              <div
                className="relative h-2 rounded-full"
                style={{
                  background: isDark
                    ? 'linear-gradient(90deg, hsl(210 82% 42%), hsl(95 70% 45%), hsl(24 82% 52%))'
                    : 'linear-gradient(90deg, hsl(210 82% 64%), hsl(95 60% 60%), hsl(24 82% 58%))',
                }}
                aria-hidden
              >
                {rhoBarPct != null && (
                  <span
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-[var(--color-bg-card)] border-2 border-[var(--color-text-primary)] shadow-sm"
                    style={{ left: `${rhoBarPct}%` }}
                  />
                )}
              </div>
              <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-[var(--color-text-muted)]">
                <span>-1 反向</span>
                <span>0 獨立</span>
                <span>+1 同向</span>
              </div>
            </div>

            {/* 分散效果結論卡 */}
            {verdict ? (
              <div className={`rounded-xl border px-3.5 py-3 ${VERDICT_TONE_CLASS[verdict.tone]}`}>
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-sm font-semibold">{interpretRho(rho!)}</span>
                  <span className="text-[11px] opacity-75">→ {verdict.label}</span>
                </div>
                <p className="text-[12px] leading-snug opacity-90">{verdict.detail}</p>
              </div>
            ) : (
              <div className="rounded-xl border border-[var(--color-border)] px-3.5 py-3 text-[12px] text-[var(--color-text-muted)]">
                此區間無共同交易日資料，無法計算相關係數。
              </div>
            )}

            {/* 樣本量註腳 */}
            {alignedDays != null && (
              <p className="text-[11px] text-[var(--color-text-muted)] mt-auto">
                樣本：共同交易日 {alignedDays} 天
                {alignedDays < 20 ? '（樣本偏少，係數穩定性較低）' : ''}
                ；|ρ| ≥ 0.7 高相關、0.3–0.7 中度、&lt; 0.3 低相關。
              </p>
            )}
          </div>
        </div>
      </motion.section>
    );
  }

  // N>=3：保留矩陣，但收緊格子尺寸與圖例。
  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border)] shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--color-border)] space-y-1">
          <h3 className="text-base font-bold text-[var(--color-text-primary)]">報酬率相關性矩陣</h3>
          {alignedDays != null && (
            <p className="text-[11px] text-[var(--color-text-muted)]">
              共同交易日 {alignedDays} 天{alignedDays < 20 ? '（樣本不足，相關係數穩定性較低）' : ''}
            </p>
          )}
        </div>

        <div className="p-4 overflow-auto space-y-4">
          <table className="text-xs border-separate border-spacing-1">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-[var(--color-bg-card)] w-12" />
                {symbols.map((sym) => (
                  <th
                    key={`head-${sym}`}
                    className="w-14 px-2 py-1 text-[var(--color-text-secondary)] font-mono text-center"
                  >
                    {sym}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {symbols.map((rowSym) => (
                <tr key={`row-${rowSym}`}>
                  <th className="sticky left-0 z-10 bg-[var(--color-bg-card)] w-12 px-2 py-1 text-left text-[var(--color-text-secondary)] font-mono">
                    {rowSym}
                  </th>
                  {symbols.map((colSym) => {
                    const val = matrix[rowSym]?.[colSym] ?? null;
                    const isDiagonal = rowSym === colSym;
                    const backgroundColor = isDiagonal
                      ? c.heatmapNullBg
                      : colorForCorrelation(val, isDark, c.heatmapNullBg);
                    const textColor = isDiagonal
                      ? c.tick
                      : textColorForCorrelation(val, c);
                    const titleText = isDiagonal
                      ? '對角線：股票對自身相關性恆為 1'
                      : val == null
                        ? '無共同交易日資料'
                        : `相關性 ρ = ${val.toFixed(4)}${alignedDays != null ? `；樣本約 ${alignedDays} 天` : ''}`;
                    return (
                      <td
                        key={`${rowSym}-${colSym}`}
                        className={`w-14 h-10 px-2 py-2 text-center rounded-md font-mono ${isDiagonal ? 'opacity-60' : ''}`}
                        style={{ backgroundColor, color: textColor }}
                        title={titleText}
                      >
                        {val == null ? '--' : val.toFixed(2)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <div className="max-w-xs space-y-1.5">
            <div
              className="h-1.5 rounded-full"
              style={{
                background: isDark
                  ? 'linear-gradient(90deg, hsl(210 82% 42%), hsl(95 82% 48%), hsl(24 82% 52%))'
                  : 'linear-gradient(90deg, hsl(210 82% 64%), hsl(95 82% 56%), hsl(24 82% 52%))',
              }}
              aria-hidden
            />
            <div className="flex items-center justify-between text-[11px] text-[var(--color-text-muted)]">
              <span>負相關 (-1)</span>
              <span>低相關 (0)</span>
              <span>正相關 (+1)</span>
            </div>
          </div>
          <p className="text-[11px] text-[var(--color-text-muted)]">
            解讀建議：|ρ| ≥ 0.7 為高相關、0.3–0.7 為中度相關、&lt; 0.3 為低相關。對角線為股票對自身，恆為 1.00。
          </p>
        </div>
      </div>
    </motion.section>
  );
};
