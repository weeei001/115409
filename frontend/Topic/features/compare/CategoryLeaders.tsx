import React from 'react';
import { Flame, Landmark, Network, ShieldCheck, Trophy, type LucideIcon } from 'lucide-react';
import type { CategoryLeader } from '@/lib/types/compare';
import { toneText } from '@/lib/utils/tone';
import { cn } from '@/lib/cn';

const ICON: Record<CategoryLeader['id'], LucideIcon> = {
  bestReturn: Trophy,
  minVolatility: ShieldCheck,
  institutionalFavorite: Landmark,
  strongestMomentum: Flame,
  lowestCorrelationPair: Network,
};

/** 卡片主色點取主要股票；組合取第一檔 */
function primarySymbol(symbol: string): string | null {
  if (!symbol || symbol === '--') return null;
  return symbol.split('×')[0]?.trim() || null;
}

/** 類別冠軍 5 格：每格一個標準指標的最高／最低者 */
export function CategoryLeaders({ leaders, symbolColors }: { leaders: CategoryLeader[]; symbolColors: Record<string, string> }) {
  return (
    <section aria-label="類別冠軍">
      <h2 className="sr-only">類別冠軍</h2>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
        {leaders.map((card) => {
          const Icon = ICON[card.id];
          const sym = primarySymbol(card.symbol);
          return (
            <li key={card.id} className="flex flex-col gap-1.5 rounded-xl border bg-card px-3 py-3 shadow-card">
              <div className="flex items-center gap-1.5 text-[11px] leading-tight text-muted-foreground">
                <Icon size={13} className="shrink-0 text-brand" aria-hidden />
                <span>{card.title}</span>
              </div>
              <div className="flex min-w-0 items-center gap-1.5">
                <span
                  className="inline-block size-2.5 shrink-0 rounded-full bg-muted-foreground"
                  style={sym ? { backgroundColor: symbolColors[sym] } : undefined}
                  aria-hidden
                />
                <span className="truncate font-mono text-sm font-semibold tabular-nums">{card.symbol}</span>
              </div>
              <p
                className={cn(
                  'font-mono text-base leading-tight font-semibold tabular-nums',
                  card.tone === 'neutral' ? 'text-foreground' : toneText(card.tone),
                )}
              >
                {card.value}
              </p>
              <p className="text-[11px] leading-snug text-muted-foreground">{card.reason}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
