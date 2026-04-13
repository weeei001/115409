import React from 'react';
import { motion } from 'motion/react';
import type { CompareInsightCard } from '../lib/types';
import { COMPARE_COLOR_PALETTE } from '../lib/utils/compare';

interface Props {
  insights: CompareInsightCard[];
  symbolColors?: Record<string, string>;
}

function extractPrimarySymbol(symbol: string): string | null {
  if (!symbol || symbol === '--') return null;
  if (symbol.includes('×')) {
    return symbol.split('×')[0]?.trim() || null;
  }
  return symbol.trim();
}

function fallbackColor(symbol: string): string {
  let hash = 0;
  for (let i = 0; i < symbol.length; i += 1) {
    hash = (hash << 5) - hash + symbol.charCodeAt(i);
    hash |= 0;
  }
  return COMPARE_COLOR_PALETTE[Math.abs(hash) % COMPARE_COLOR_PALETTE.length];
}

export const CompareInsightsPanel: React.FC<Props> = ({ insights, symbolColors = {} }) => {
  if (insights.length === 0) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45 }}
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
    >
      {insights.map((card) => {
        const primarySymbol = extractPrimarySymbol(card.symbol);
        const color = primarySymbol
          ? (symbolColors[primarySymbol] ?? fallbackColor(primarySymbol))
          : '#94a3b8';

        return (
          <article
            key={card.id}
            className="rounded-2xl border border-gray-200/80 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm"
          >
            <p className="text-xs text-gray-500 dark:text-gray-400">{card.title}</p>
            <div className="mt-2 flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: color }}
                aria-hidden
              />
              <p className="text-sm font-mono font-semibold text-gray-700 dark:text-gray-200">{card.symbol}</p>
            </div>
            <p className="mt-2 text-xl font-bold tracking-tight text-[#c2410c] dark:text-[#fb923c]">{card.value}</p>
            <p className="mt-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{card.reason}</p>
          </article>
        );
      })}
    </motion.section>
  );
};
