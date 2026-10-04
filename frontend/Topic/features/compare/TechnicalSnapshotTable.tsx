import { LedgerPanel } from '@/components/common/Ledger';
import { EmptyState } from '@/components/common/Notice';
import type { TechnicalDay } from '@/lib/types/view';
import { kdSignal, macdSignal, maPositionSignal, rsiSignal } from '@/lib/utils/compareSignals';
import { fmtPercent } from '@/lib/utils/format';
import type { Signal } from '@/lib/utils/indicatorSignals';
import { SignalTag } from '@/components/common/SignalTag';
import { cn } from '@/lib/cn';

const fmtFixed = (v: number | null | undefined, decimals = 1) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(decimals));

function SignalCell({ value, signal }: { value: string; signal: Signal }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="font-mono text-[13.5px] font-medium tabular-nums">{value}</span>
      <SignalTag signal={signal} />
    </div>
  );
}

const th = 'h-11 px-3 text-right text-[13px] font-medium tracking-[0.04em] whitespace-nowrap text-muted-foreground sm:px-4';
const td = 'px-3 py-3 text-right sm:px-4';

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
    <>
      {!hasAny ? (
        <LedgerPanel>
          <EmptyState>期間內無技術指標資料；可換股或拉長區間再試。</EmptyState>
        </LedgerPanel>
      ) : (
        <LedgerPanel padded={false}>
          <div className="overflow-x-auto overscroll-x-contain">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border-strong">
                  <th scope="col" className={cn(th, 'text-left')}>股票</th>
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
                  const kdText = row?.kd_k9 != null && row?.kd_d9 != null ? `${fmtFixed(row.kd_k9)} / ${fmtFixed(row.kd_d9)}` : '—';
                  return (
                    <tr key={sym} className="border-b align-top last:border-b-0">
                      <td className="px-3 py-3 whitespace-nowrap sm:px-4">
                        <span className="relative inline-flex items-center pl-3 font-mono text-[13.5px] font-medium tabular-nums">
                          <span className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: symbolColors[sym] }} aria-hidden />
                          {sym}
                        </span>
                        {row?.date ? <span className="characteristic mt-1 block pl-3">{row.date}</span> : null}
                      </td>
                      <td className={td}>
                        <SignalCell value={fmtFixed(row?.rsi10)} signal={rsiSignal(row?.rsi10)} />
                      </td>
                      <td className={td}>
                        <SignalCell value={fmtFixed(row?.macd_hist, 3)} signal={macdSignal(row?.macd_hist)} />
                      </td>
                      <td className={td}>
                        <SignalCell value={kdText} signal={kdSignal(row?.kd_k9, row?.kd_d9)} />
                      </td>
                      <td className={td}>
                        <SignalCell value={fmtPercent(ma20.value, { sign: true })} signal={ma20} />
                      </td>
                      <td className={td}>
                        <SignalCell value={fmtPercent(ma60.value, { sign: true })} signal={ma60} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </LedgerPanel>
      )}
    </>
  );
}
