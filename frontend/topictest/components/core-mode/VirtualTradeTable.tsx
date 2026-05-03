import React, { useMemo, useState } from 'react';
import type { CoreModeTradeRecord } from '../../lib/types/coreMode';

interface Props {
  trades: CoreModeTradeRecord[];
}

const ROW_HEIGHT = 44;
const VIEWPORT_HEIGHT = 360;
const OVERSCAN = 6;

function formatPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatPrice(value: number): string {
  return value.toFixed(2);
}

export const VirtualTradeTable: React.FC<Props> = ({ trades }) => {
  const [scrollTop, setScrollTop] = useState(0);

  const totalHeight = trades.length * ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(trades.length, Math.ceil((scrollTop + VIEWPORT_HEIGHT) / ROW_HEIGHT) + OVERSCAN);

  const visibleTrades = useMemo(() => trades.slice(startIndex, endIndex), [trades, startIndex, endIndex]);

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-3">
      <h3 className="mb-2 text-sm font-semibold">交易明細</h3>
      <div className="grid grid-cols-10 gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 py-2 text-xs font-semibold text-[var(--color-text-secondary)]">
        <div>進場日</div>
        <div>出場日</div>
        <div>進場價</div>
        <div>出場價</div>
        <div>報酬率</div>
        <div>持有天數</div>
        <div>最大有利波動</div>
        <div>最大不利波動</div>
        <div>進場理由</div>
        <div>出場理由</div>
      </div>

      <div
        className="mt-2 overflow-auto rounded-lg border border-[var(--color-border)]"
        style={{ height: VIEWPORT_HEIGHT }}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div style={{ height: totalHeight, position: 'relative' }}>
          {visibleTrades.map((trade, offset) => {
            const realIndex = startIndex + offset;
            return (
              <div
                key={`${trade.entry_date}-${trade.exit_date}-${realIndex}`}
                style={{
                  position: 'absolute',
                  top: realIndex * ROW_HEIGHT,
                  left: 0,
                  right: 0,
                  height: ROW_HEIGHT,
                }}
                className="grid grid-cols-10 gap-2 border-b border-[var(--color-border)] px-2 py-2 text-xs text-[var(--color-text-primary)]"
              >
                <div>{trade.entry_date}</div>
                <div>{trade.exit_date}</div>
                <div>{formatPrice(trade.entry_price)}</div>
                <div>{formatPrice(trade.exit_price)}</div>
                <div className={trade.return_pct >= 0 ? 'text-red-500' : 'text-green-600'}>{formatPct(trade.return_pct)}</div>
                <div>{trade.holding_days}</div>
                <div>{formatPct(trade.mfe)}</div>
                <div>{formatPct(trade.mae)}</div>
                <div className="truncate" title={trade.entry_reason}>{trade.entry_reason}</div>
                <div className="truncate" title={trade.exit_reason}>{trade.exit_reason}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
