import React from 'react';
import { motion } from 'motion/react';
import {
  Trophy,
  ShieldCheck,
  Landmark,
  Flame,
  Network,
  type LucideIcon,
} from 'lucide-react';
import type { CategoryLeader } from '../../lib/utils/compare';
import { COMPARE_COLOR_PALETTE } from '../../lib/utils/compare';
import { usePrefersReducedMotionClient } from '../../lib/usePrefersReducedMotionClient';

interface Props {
  leaders: CategoryLeader[];
  symbolColors: Record<string, string>;
}

const CATEGORY_ICON: Record<CategoryLeader['id'], LucideIcon> = {
  bestReturn: Trophy,
  minVolatility: ShieldCheck,
  institutionalFavorite: Landmark,
  strongestMomentum: Flame,
  lowestCorrelationPair: Network,
};

function fallbackColor(symbol: string): string {
  let hash = 0;
  for (let i = 0; i < symbol.length; i += 1) {
    hash = (hash << 5) - hash + symbol.charCodeAt(i);
    hash |= 0;
  }
  return COMPARE_COLOR_PALETTE[Math.abs(hash) % COMPARE_COLOR_PALETTE.length];
}

function primarySymbol(symbol: string): string | null {
  if (!symbol || symbol === '--') return null;
  if (symbol.includes('×')) return symbol.split('×')[0]?.trim() || null;
  return symbol.trim();
}

export const CompareCategoryLeaders: React.FC<Props> = ({ leaders, symbolColors }) => {
  const reduceMotion = usePrefersReducedMotionClient();

  return (
    <motion.section
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.4, delay: 0.05 }}
      aria-label="類別冠軍"
    >
      <h2 className="sr-only">類別冠軍</h2>
      <div
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3"
        role="list"
      >
        {leaders.map((card) => {
          const Icon = CATEGORY_ICON[card.id];
          const pSym = primarySymbol(card.symbol);
          const color = pSym
            ? (symbolColors[pSym] ?? fallbackColor(pSym))
            : 'var(--color-text-muted)';
          return (
            <div
              key={card.id}
              role="listitem"
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-3 shadow-[var(--shadow-card)] flex flex-col gap-1.5"
            >
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)] leading-tight">
                <Icon size={13} className="text-brand" aria-hidden />
                <span>{card.title}</span>
              </div>
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: color }}
                  aria-hidden
                />
                <span className="text-sm font-mono font-semibold tabular-nums text-[var(--color-text-primary)] truncate">
                  {card.symbol}
                </span>
              </div>
              <p className="text-base font-mono font-semibold tabular-nums text-brand-deep dark:text-brand leading-tight">
                {card.value}
              </p>
              <p className="text-[11px] text-[var(--color-text-muted)] leading-snug">
                {card.reason}
              </p>
            </div>
          );
        })}
      </div>
    </motion.section>
  );
};
