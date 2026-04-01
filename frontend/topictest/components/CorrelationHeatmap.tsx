import React from 'react';
import { motion } from 'motion/react';
import { useTheme } from '../lib/ThemeContext';

interface Props {
  symbols: string[];
  matrix: Record<string, Record<string, number | null>>;
}

function colorForCell(
  rowSym: string,
  colSym: string,
  value: number | null,
  isDark: boolean
): string {
  if (value == null) return isDark ? '#374151' : '#f3f4f6';
  if (rowSym === colSym) return '#ef4444';
  if (value >= 0.7) return '#ea580c';
  if (value >= 0.3) return '#f97316';
  if (value > -0.3) return '#f59e0b';
  if (value > -0.7) return '#22c55e';
  return '#0ea5e9';
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
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700/80">
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">報酬率相關性矩陣</h3>
        </div>
        <div className="p-4 overflow-auto">
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
                  return (
                    <td
                      key={`${rowSym}-${colSym}`}
                      className="px-2 py-2 text-center rounded-md font-mono text-white"
                      style={{ backgroundColor: colorForCell(rowSym, colSym, val, isDark) }}
                      title={val == null ? '無資料' : `相關性: ${val.toFixed(4)}`}
                    >
                      {val == null ? '--' : val.toFixed(2)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </motion.section>
  );
};
