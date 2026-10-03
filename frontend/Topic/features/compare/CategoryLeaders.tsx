import React from 'react';
import { Ledger } from '@/components/common/Ledger';
import type { StockInfo } from '@/lib/types/api';
import type { CategoryLeader } from '@/lib/types/compare';
import { toneText } from '@/lib/utils/tone';
import { cn } from '@/lib/cn';

/** 「A × B」拆成各檔代號；沒有資料（--）回傳空陣列 */
function leaderSymbols(symbol: string): string[] {
  if (!symbol || symbol === '--') return [];
  return symbol.split('×').map((s) => s.trim()).filter(Boolean);
}

/** 有方向（up/down）的讀數一律帶正負號；格式化字串已帶負號，只補上正號 */
function signedValue(card: CategoryLeader): string {
  return card.tone === 'up' && !card.value.startsWith('+') ? `+${card.value}` : card.value;
}

/** 冠軍條目：3px 代表色條、等寬代號、名稱；組合（最低相關）逐檔列出 */
function LeaderEntry({ symbol, symbolColors, stockInfos }: { symbol: string; symbolColors: Record<string, string>; stockInfos: Record<string, StockInfo> }) {
  const symbols = leaderSymbols(symbol);
  if (symbols.length === 0) return <span className="font-mono text-[13.5px] text-muted-foreground tabular-nums">--</span>;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {symbols.map((sym, i) => (
        <React.Fragment key={sym}>
          {i > 0 ? <span className="text-xs text-muted-foreground">×</span> : null}
          <span className="relative inline-flex min-w-0 items-baseline gap-2 pl-3">
            <span className="absolute inset-y-0.5 left-0 w-[3px]" style={{ backgroundColor: symbolColors[sym] }} aria-hidden />
            <span className="font-mono text-[13.5px] font-medium tabular-nums">{sym}</span>
            {stockInfos[sym]?.name?.trim() ? <span className="truncate text-sm">{stockInfos[sym]?.name?.trim()}</span> : null}
          </span>
        </React.Fragment>
      ))}
    </span>
  );
}

/**
 * 類別冠軍：一張有線的燈質表，每列一個標準指標的最高／最低者——類別、冠軍條目、讀數、一句註記。
 * 讀數只有帶方向的指標（漲跌、法人買賣超、均線乖離）才上漲跌色並帶正負號；波動與相關性維持中性。
 */
export function CategoryLeaders({
  leaders,
  symbolColors,
  stockInfos = {},
}: {
  leaders: CategoryLeader[];
  symbolColors: Record<string, string>;
  stockInfos?: Record<string, StockInfo>;
}) {
  return (
    <Ledger title="類別冠軍" aria-label="類別冠軍" stamp={`${leaders.length} 項標準指標的最高／最低者`}>
      <div className="min-w-0 bg-card">
        {/* 桌機的欄名；手機每列自帶類別名，不需要表頭 */}
        <div aria-hidden className="hidden border-b px-5 md:grid md:grid-cols-[12rem_minmax(12rem,15rem)_9rem_minmax(0,1fr)] md:gap-x-6">
          {['類別', '股票', '讀數', '註記'].map((h, i) => (
            <span key={h} className={cn('flex h-10 items-center text-xs font-medium tracking-[0.04em] text-muted-foreground', i === 2 && 'justify-end')}>
              {h}
            </span>
          ))}
        </div>
        <ul className="divide-y">
          {leaders.map((card) => (
            <li
              key={card.id}
              data-stagger
              className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 px-4 py-2.5 sm:px-5 md:min-h-11 md:grid-cols-[12rem_minmax(12rem,15rem)_9rem_minmax(0,1fr)] md:items-center md:gap-x-6 md:py-2"
            >
              <span className="col-start-1 row-start-1 text-[13px] font-medium tracking-[0.04em] text-subtle md:col-start-auto md:row-start-auto">{card.title}</span>
              <span className="col-span-2 min-w-0 md:col-span-1">
                <LeaderEntry symbol={card.symbol} symbolColors={symbolColors} stockInfos={stockInfos} />
              </span>
              <span
                className={cn(
                  'col-start-2 row-start-1 text-right font-mono text-[15px] font-semibold whitespace-nowrap tabular-nums md:col-start-auto md:row-start-auto',
                  card.tone === 'neutral' ? 'text-foreground' : toneText(card.tone),
                )}
              >
                {signedValue(card)}
              </span>
              <span className="col-span-2 text-xs leading-snug text-muted-foreground md:col-span-1">{card.reason}</span>
            </li>
          ))}
        </ul>
      </div>
    </Ledger>
  );
}
