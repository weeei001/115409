import React from 'react';
import { Activity } from 'lucide-react';
import type { TechnicalIndicatorDayRow } from '../../lib/types/stockDashboard';
import {
  kdSignal,
  macdSignal,
  maPositionSignal,
  rsiSignal,
  type Signal,
} from '../../lib/utils/compareSignals';
import { fmtPercent } from '../../lib/utils/format';
import { COMPARE_COLOR_PALETTE } from '../../lib/utils/compare';
import { getBadgeToneClass } from '../../lib/utils/valueToneClass';
import { BentoCardShell } from '../stock/bento/BentoCardShell';

interface Props {
  symbols: string[];
  technicalLatestMap: Record<string, TechnicalIndicatorDayRow | null>;
  lastCloseMap: Record<string, number | null>;
  symbolColors: Record<string, string>;
}

function fallbackColor(symbol: string): string {
  let hash = 0;
  for (let i = 0; i < symbol.length; i += 1) {
    hash = (hash << 5) - hash + symbol.charCodeAt(i);
    hash |= 0;
  }
  return COMPARE_COLOR_PALETTE[Math.abs(hash) % COMPARE_COLOR_PALETTE.length];
}

function fmtNum(v: number | null | undefined, decimals = 1): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toFixed(decimals);
}

function SignalCell({ value, signal }: { value: string; signal: Signal }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="font-mono font-semibold tabular-nums text-[var(--color-text-primary)]">
        {value}
      </span>
      <span
        className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${getBadgeToneClass(signal.tone)}`}
      >
        {signal.label}
      </span>
    </div>
  );
}

export const TechnicalSnapshotGrid: React.FC<Props> = ({
  symbols,
  technicalLatestMap,
  lastCloseMap,
  symbolColors,
}) => {
  const hasAny = symbols.some((sym) => technicalLatestMap[sym] != null);

  return (
    <BentoCardShell
      icon={Activity}
      title="技術指標快照對比"
      isEmpty={!hasAny}
      emptyText="期間內無技術指標資料；可換股或拉長區間再試。"
    >
      <p className="text-[11px] text-[var(--color-text-muted)] -mt-1">
        每檔股票最後一個交易日的指標讀數與訊號偏向。
      </p>
      <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
        <table className="w-full text-xs min-w-[640px]">
          <thead className="bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)]">
            <tr>
              <th className="px-3 py-2 text-left whitespace-nowrap">股票</th>
              <th className="px-3 py-2 text-right whitespace-nowrap">RSI10</th>
              <th className="px-3 py-2 text-right whitespace-nowrap">MACD 動能</th>
              <th className="px-3 py-2 text-right whitespace-nowrap">KD (K/D)</th>
              <th className="px-3 py-2 text-right whitespace-nowrap">vs MA20</th>
              <th className="px-3 py-2 text-right whitespace-nowrap">vs MA60</th>
            </tr>
          </thead>
          <tbody>
            {symbols.map((sym) => {
              const row = technicalLatestMap[sym] ?? null;
              const close = lastCloseMap[sym] ?? null;
              const rsi = rsiSignal(row?.rsi10);
              const macd = macdSignal(row?.macd_hist);
              const kd = kdSignal(row?.kd_k9, row?.kd_d9);
              const ma20 = maPositionSignal(close, row?.ma20, 'MA20');
              const ma60 = maPositionSignal(close, row?.ma60, 'MA60');

              const kdValueText =
                row?.kd_k9 != null && row?.kd_d9 != null
                  ? `${fmtNum(row.kd_k9, 1)} / ${fmtNum(row.kd_d9, 1)}`
                  : '—';

              return (
                <tr key={sym} className="border-t border-[var(--color-border)] align-top">
                  <td className="px-3 py-3 font-mono whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: symbolColors[sym] ?? fallbackColor(sym) }}
                        aria-hidden
                      />
                      {sym}
                    </span>
                    {row?.date ? (
                      <span className="block text-[10px] text-[var(--color-text-muted)] font-sans">
                        {row.date}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <SignalCell value={fmtNum(row?.rsi10, 1)} signal={rsi} />
                  </td>
                  <td className="px-3 py-3 text-right">
                    <SignalCell value={fmtNum(row?.macd_hist, 3)} signal={macd} />
                  </td>
                  <td className="px-3 py-3 text-right">
                    <SignalCell value={kdValueText} signal={kd} />
                  </td>
                  <td className="px-3 py-3 text-right">
                    <SignalCell
                      value={fmtPercent(ma20.value, { sign: true })}
                      signal={ma20}
                    />
                  </td>
                  <td className="px-3 py-3 text-right">
                    <SignalCell
                      value={fmtPercent(ma60.value, { sign: true })}
                      signal={ma60}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </BentoCardShell>
  );
};
