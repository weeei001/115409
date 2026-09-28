import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TableProperties } from 'lucide-react';
import { EmptyState } from '@/components/common/Notice';
import { cn } from '@/lib/cn';
import { fmtPrice } from '@/lib/utils/format';
import { tradeSides } from '../derive';
import { actionLabel, fmtMoney, fmtRatioPct, fmtShares, sideToneClass } from '../display';
import type { SimDayEvent } from '../types';
import { DemoCard } from './DemoCard';

/** 理由超過這個長度才出現展開鈕 */
const REASON_COLLAPSE_AT = 40;

const numCell = 'px-3 py-2.5 text-right font-mono tabular-nums whitespace-nowrap';
const headCell = 'px-3 py-2 text-right font-medium whitespace-nowrap';

/** 表格寬過容器時才顯示「左右滑動」提示（同 components/common/CollapsibleSection 的 TableScrollHint） */
function useOverflowsX(ref: React.RefObject<HTMLElement | null>, hasContent: boolean) {
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOverflows(el.scrollWidth > el.clientWidth + 2);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, hasContent]);
  return overflows;
}

export function DayTable({ days }: { days: SimDayEvent[] }) {
  const sides = useMemo(() => tradeSides(days), [days]);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const overflows = useOverflowsX(scrollRef, days.length > 0);

  const toggle = (index: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  return (
    <DemoCard
      title="逐日明細"
      icon={TableProperties}
      description={days.length ? `共 ${days.length} 個交易日；日期為成交日，買％、賣％是後端給的下單比例。` : undefined}
    >
      {days.length ? (
        <>
          <div ref={scrollRef} className="-mx-4 overflow-x-auto overscroll-x-contain sm:mx-0 dark:[color-scheme:dark]">
            <table className="w-full min-w-[1100px] border-collapse text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th scope="col" className="px-3 py-2 text-left font-medium whitespace-nowrap">
                    日期
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-medium whitespace-nowrap">
                    動作
                  </th>
                  <th scope="col" className={headCell}>
                    買％
                  </th>
                  <th scope="col" className={headCell}>
                    賣％
                  </th>
                  <th scope="col" className={headCell}>
                    成交股數
                  </th>
                  <th scope="col" className={headCell}>
                    成本（元）
                  </th>
                  <th scope="col" className={headCell}>
                    收盤價
                  </th>
                  <th scope="col" className={headCell}>
                    現金（元）
                  </th>
                  <th scope="col" className={headCell}>
                    持股（股）
                  </th>
                  <th scope="col" className={headCell}>
                    資產淨值（元）
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    理由
                  </th>
                </tr>
              </thead>
              <tbody>
                {days.map((day, i) => {
                  const long = day.reason.trim().length > REASON_COLLAPSE_AT;
                  const open = expanded.has(i);
                  return (
                    <tr key={`${day.date}-${i}`} className="border-b align-top last:border-b-0">
                      <td className="px-3 py-2.5 font-mono whitespace-nowrap">{day.date}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className={cn('inline-flex rounded-md border px-2 py-0.5 text-xs font-medium', sideToneClass(sides[i]))}>
                          {actionLabel(day.action)}
                        </span>
                      </td>
                      <td className={numCell}>{fmtRatioPct(day.buy_pct)}</td>
                      <td className={numCell}>{fmtRatioPct(day.sell_pct)}</td>
                      <td className={numCell}>{fmtShares(day.executed_shares)}</td>
                      <td className={numCell}>{fmtMoney(day.cost)}</td>
                      <td className={numCell}>{fmtPrice(day.close_price)}</td>
                      <td className={numCell}>{fmtMoney(day.cash_after)}</td>
                      <td className={numCell}>{fmtShares(day.shares_after)}</td>
                      <td className={numCell}>{fmtMoney(day.portfolio_value)}</td>
                      <td className="min-w-[18rem] px-3 py-2.5 text-subtle">
                        <p id={`ai-demo-reason-${i}`} className={cn('leading-6', long && !open && 'line-clamp-2')}>
                          {day.reason || '—'}
                        </p>
                        {long ? (
                          <button
                            type="button"
                            onClick={() => toggle(i)}
                            aria-expanded={open}
                            aria-controls={`ai-demo-reason-${i}`}
                            className="mt-1 inline-flex min-h-11 items-center text-xs font-medium text-brand-text hover:underline sm:min-h-8"
                          >
                            {open ? '收合' : '展開全文'}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {overflows ? <p className="mt-2 text-xs text-muted-foreground">← 左右滑動查看完整表格 →</p> : null}
        </>
      ) : (
        <EmptyState>尚未收到交易日資料</EmptyState>
      )}
    </DemoCard>
  );
}
