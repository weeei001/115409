import React from 'react';
import { Activity } from 'lucide-react';
import { EmptyState } from '@/components/common/Notice';
import { Panel } from '@/components/common/Panel';
import type { TechnicalDay } from '@/lib/types/view';
import { kdSignal, macdSignal, maPositionSignal, rsiSignal } from '@/lib/utils/compareSignals';
import { fmtPercent } from '@/lib/utils/format';
import { signalBadgeClass, type Signal } from '@/lib/utils/indicatorSignals';
import { cn } from '@/lib/cn';

const fmtNum = (v: number | null | undefined, decimals = 1) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(decimals));

function SignalCell({ value, signal }: { value: string; signal: Signal }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="font-mono font-semibold tabular-nums">{value}</span>
      <span className={cn('inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap', signalBadgeClass(signal.tone, true))}>
        {signal.label}
      </span>
    </div>
  );
}

const th = 'px-3 py-2 text-right whitespace-nowrap';

/** 技術指標快照：每檔最後一個交易日的讀數與訊號 */
export function TechnicalSnapshotTable({
  symbols,
  latestMap,
  symbolColors,
}: {
  symbols: string[];
  latestMap: Record<string, TechnicalDay | null>;
  symbolColors: Record<string, string>;
}) {
  const hasAny = symbols.some((sym) => latestMap[sym] != null);
  return (
    <Panel icon={Activity} title="技術指標快照對比" className="rounded-2xl">
      {!hasAny ? (
        <EmptyState>期間內無技術指標資料；可換股或拉長區間再試。</EmptyState>
      ) : (
        <div className="space-y-3">
          <p className="text-[11px] text-muted-foreground">每檔股票最後一個交易日的指標讀數與訊號偏向。</p>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[640px] text-xs">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left whitespace-nowrap">股票</th>
                  <th scope="col" className={th}>RSI10</th>
                  <th scope="col" className={th}>MACD 動能</th>
                  <th scope="col" className={th}>KD (K/D)</th>
                  <th scope="col" className={th}>vs MA20</th>
                  <th scope="col" className={th}>vs MA60</th>
                </tr>
              </thead>
              <tbody>
                {symbols.map((sym) => {
                  const row = latestMap[sym] ?? null;
                  // 收盤與均線取同一列（同一天），不拿比較主圖的最後收盤（決議 D9-c24）
                  const ma20 = maPositionSignal(row?.close, row?.ma20, 'MA20');
                  const ma60 = maPositionSignal(row?.close, row?.ma60, 'MA60');
                  const kdText = row?.kd_k9 != null && row?.kd_d9 != null ? `${fmtNum(row.kd_k9)} / ${fmtNum(row.kd_d9)}` : '—';
                  return (
                    <tr key={sym} className="border-t align-top">
                      <td className="px-3 py-3 font-mono whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="inline-block size-2 rounded-full" style={{ backgroundColor: symbolColors[sym] }} aria-hidden />
                          {sym}
                        </span>
                        {row?.date ? <span className="block font-sans text-[10px] text-muted-foreground">{row.date}</span> : null}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <SignalCell value={fmtNum(row?.rsi10)} signal={rsiSignal(row?.rsi10)} />
                      </td>
                      <td className="px-3 py-3 text-right">
                        <SignalCell value={fmtNum(row?.macd_hist, 3)} signal={macdSignal(row?.macd_hist)} />
                      </td>
                      <td className="px-3 py-3 text-right">
                        <SignalCell value={kdText} signal={kdSignal(row?.kd_k9, row?.kd_d9)} />
                      </td>
                      <td className="px-3 py-3 text-right">
                        <SignalCell value={fmtPercent(ma20.value, { sign: true })} signal={ma20} />
                      </td>
                      <td className="px-3 py-3 text-right">
                        <SignalCell value={fmtPercent(ma60.value, { sign: true })} signal={ma60} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  );
}
