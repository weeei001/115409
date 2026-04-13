import React from 'react';
import { motion } from 'motion/react';
import { useTheme } from '../lib/ThemeContext';

interface Props {
  symbols: string[];
  matrix: Record<string, Record<string, number | null>>;
}

function colorForCorrelation(value: number | null, isDark: boolean): string {
  if (value == null) return isDark ? '#334155' : '#f1f5f9';

  const clamped = Math.max(-1, Math.min(1, value));
  const normalized = (clamped + 1) / 2; // -1 -> 0, +1 -> 1

  // Hue: 210 (blue, negative) -> 24 (orange, positive)
  const hue = 210 - normalized * 186;
  const saturation = 82;
  const lightness = isDark ? 42 + normalized * 10 : 84 - normalized * 28;

  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

function textColorForCorrelation(value: number | null, isDark: boolean): string {
  if (value == null) return isDark ? '#e2e8f0' : '#334155';
  const abs = Math.abs(value);
  if (isDark) return abs >= 0.45 ? '#f8fafc' : '#e2e8f0';
  return abs >= 0.45 ? '#111827' : '#1f2937';
}

export const CorrelationHeatmap: React.FC<Props> = ({ symbols, matrix }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  if (symbols.length < 2) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/80 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700/80 space-y-1">
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">報酬率相關性矩陣</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            色階範圍為 -1 至 +1；數值越接近 -1，分散效果通常越高。
          </p>
        </div>

        <div className="p-4 overflow-auto space-y-4">
          <table className="text-xs border-separate border-spacing-1 w-full min-w-[420px] sm:min-w-[540px]">
            <thead>
              <tr>
                <th className="w-14" />
                {symbols.map((sym) => (
                  <th key={`head-${sym}`} className="px-2 py-1 text-gray-500 dark:text-gray-300 font-mono">
                    {sym}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {symbols.map((rowSym) => (
                <tr key={`row-${rowSym}`}>
                  <th className="px-2 py-1 text-left text-gray-500 dark:text-gray-300 font-mono">{rowSym}</th>
                  {symbols.map((colSym) => {
                    const val = matrix[rowSym]?.[colSym] ?? null;
                    const backgroundColor = colorForCorrelation(val, isDark);
                    const textColor = textColorForCorrelation(val, isDark);
                    return (
                      <td
                        key={`${rowSym}-${colSym}`}
                        className="px-2 py-2 text-center rounded-md font-mono"
                        style={{ backgroundColor, color: textColor }}
                        title={val == null ? '無共同交易日資料' : `相關性: ${val.toFixed(4)}`}
                      >
                        {val == null ? '--' : val.toFixed(2)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <div className="space-y-2">
            <div
              className="h-2.5 rounded-full"
              style={{
                background: isDark
                  ? 'linear-gradient(90deg, hsl(210 82% 42%), hsl(95 82% 48%), hsl(24 82% 52%))'
                  : 'linear-gradient(90deg, hsl(210 82% 64%), hsl(95 82% 56%), hsl(24 82% 52%))',
              }}
              aria-hidden
            />
            <div className="flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
              <span>負相關 (-1)</span>
              <span>低相關 (0)</span>
              <span>正相關 (+1)</span>
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              解讀建議：|ρ| ≥ 0.7 為高相關、0.3~0.7 為中度相關、&lt; 0.3 為低相關。
            </p>
          </div>
        </div>
      </div>
    </motion.section>
  );
};
