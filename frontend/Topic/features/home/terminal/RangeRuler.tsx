import { fmtPrice } from '@/lib/utils/format';

interface Props {
  low: number | null;
  high: number | null;
  average: number | null;
  close: number | null;
}

const TICKS = 21;

/**
 * 區間尺：最低到最高的刻度尺，標出區間均價與最近收盤的位置。
 * 刻度標的是價格，不是百分比或分數。
 */
export function RangeRuler({ low, high, average, close }: Props) {
  if (low == null || high == null || !(high > low)) {
    return <p className="py-3 text-[13px] text-muted-foreground">這個區間沒有足夠的資料畫出區間尺。</p>;
  }
  const pos = (v: number) => `${Math.min(100, Math.max(0, ((v - low) / (high - low)) * 100)).toFixed(2)}%`;
  const label = [
    `區間最低 ${fmtPrice(low)}`,
    `最高 ${fmtPrice(high)}`,
    average != null ? `均價 ${fmtPrice(average)}` : null,
    close != null ? `最近收盤 ${fmtPrice(close)}` : null,
  ]
    .filter(Boolean)
    .join('，');

  return (
    <div role="img" aria-label={label} className="pt-7 pb-1">
      <div className="relative h-5">
        {/* 刻度：每格短刻度，頭、中、尾長刻度 */}
        <div className="absolute inset-x-0 bottom-0 flex h-full items-end justify-between border-b border-border-strong" aria-hidden>
          {Array.from({ length: TICKS }).map((_, i) => (
            <span key={i} className={i % 10 === 0 ? 'h-3 w-px bg-border-strong' : i % 5 === 0 ? 'h-2 w-px bg-border-strong' : 'h-1 w-px bg-input'} />
          ))}
        </div>
        {average != null ? (
          <span className="absolute bottom-0 h-5 w-px bg-muted-foreground" style={{ left: pos(average) }} aria-hidden>
            <span className="absolute bottom-full left-1/2 mb-0.5 -translate-x-1/2 text-[11px] whitespace-nowrap text-muted-foreground">均</span>
          </span>
        ) : null}
        {close != null ? (
          <span className="absolute bottom-0 h-6 w-0.5 bg-foreground" style={{ left: pos(close) }} aria-hidden>
            <span className="absolute bottom-full left-1/2 mb-0.5 -translate-x-1/2 text-[11px] font-medium whitespace-nowrap">收</span>
          </span>
        ) : null}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-xs tabular-nums text-subtle" aria-hidden>
        <span>{fmtPrice(low)}</span>
        {average != null ? <span className="text-muted-foreground">均 {fmtPrice(average)}</span> : null}
        <span>{fmtPrice(high)}</span>
      </div>
    </div>
  );
}
