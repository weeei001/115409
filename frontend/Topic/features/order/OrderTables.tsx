import React from 'react';
import { ArrowDownCircle, ArrowUpCircle, ClipboardList, Loader2, PieChart } from 'lucide-react';
import type { SimulatedOrderCategoryProfitResponse, SimulatedOrderResponse } from '@/lib/types/api';
import { TableScrollHint } from '@/components/common/CollapsibleSection';
import { valueToneText } from '@/lib/utils/tone';
import { cn } from '@/lib/cn';

const th = 'px-5 py-3 font-medium whitespace-nowrap text-muted-foreground';
/** 0 不加「+」（決議 c7） */
const signed = (v: number) => `${v > 0 ? '+' : ''}${v.toLocaleString()}`;
/** 百分比先取到小數兩位再判斷正負，才不會出現「+0.00%」「-0.00%」（決議 c7）；`|| 0` 把 -0 變成 0 */
const roundPct = (v: number) => Number(v.toFixed(2)) || 0;
const signedPct = (v: number) => {
  const r = roundPct(v);
  return `${r > 0 ? '+' : ''}${r.toFixed(2)}%`;
};

/** 載入中與空狀態放在表格外面：窄螢幕表格會橫向捲動，放在表格列裡會被置中到畫面外 */
function TableStatus({ loading, empty, emptyText }: { loading: boolean; empty: boolean; emptyText: string }) {
  if (loading) {
    return (
      <p className="flex items-center justify-center gap-2 py-12 text-muted-foreground" role="status">
        <Loader2 size={18} className="animate-spin" aria-hidden />
        載入中…
      </p>
    );
  }
  return empty ? <p className="py-12 text-center text-muted-foreground">{emptyText}</p> : null;
}

function SectionTitle({ icon: Icon, title, loading }: { icon: typeof PieChart; title: string; loading: boolean }) {
  return (
    <div className="mb-5 flex items-center gap-2">
      <Icon size={18} className="text-brand" aria-hidden />
      <h2 className="text-lg font-bold">{title}</h2>
      {loading ? <Loader2 size={16} className="animate-spin text-muted-foreground" aria-hidden /> : null}
    </div>
  );
}

/** 依股票彙總（模擬收益） */
export function ProfitSummaryTable({ summary, loading }: { summary: SimulatedOrderCategoryProfitResponse | null; loading: boolean }) {
  const rows = summary?.data ?? [];
  return (
    <section>
      <SectionTitle icon={PieChart} title="依股票彙總（模擬收益）" loading={loading} />
      {summary ? (
        <div className="mb-4 flex flex-wrap gap-4 text-sm text-subtle">
          <span>
            總委託 <strong className="font-mono">{summary.total_orders}</strong> 筆
          </span>
          <span>
            可估值 <strong className="font-mono">{summary.priced_orders}</strong> 筆
          </span>
          <span>
            無行情 <strong className="font-mono">{summary.unpriced_orders}</strong> 筆
          </span>
        </div>
      ) : null}
      <div className="overflow-hidden rounded-xl border bg-card shadow-card">
        <TableScrollHint className="px-5 pt-3" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/80">
                <th className={cn(th, 'text-left')}>股票</th>
                <th className={cn(th, 'text-right')}>筆數</th>
                <th className={cn(th, 'text-right')}>成本（元）</th>
                <th className={cn(th, 'text-right')}>市值（元）</th>
                <th className={cn(th, 'text-right')}>損益（元）</th>
                <th className={cn(th, 'text-right')}>收益率</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? null
                : rows.map((row) => (
                    <tr key={row.category} className="border-b transition-colors hover:bg-muted/50">
                      <td className="px-5 py-3 font-mono font-semibold">{row.category}</td>
                      <td className="px-5 py-3 text-right font-mono text-xs">{row.order_count}</td>
                      <td className="px-5 py-3 text-right font-mono text-xs">{row.cost_amount.toLocaleString()}</td>
                      <td className="px-5 py-3 text-right font-mono text-xs">{row.market_amount.toLocaleString()}</td>
                      <td className={cn('px-5 py-3 text-right font-mono text-xs font-medium', valueToneText(row.profit_amount))}>{signed(row.profit_amount)}</td>
                      <td className="px-5 py-3 text-right font-mono text-xs">{row.profit_rate.toFixed(2)}%</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
        <TableStatus loading={loading} empty={rows.length === 0} emptyText="尚無彙總資料" />
      </div>
    </section>
  );
}

function sellPlanCell(o: SimulatedOrderResponse): string {
  if (o.side === 'sell' || o.sell_plan == null) return '—';
  if (o.sell_plan === 'long_term') return '長期持有';
  return o.planned_sell_date ?? '—';
}

const MARKUP_BASIS: Record<string, string> = { latest: '最新收盤', planned_sell: '預計賣出日', fifo_realized: '實現損益' };

function ReferenceCell({ order: o }: { order: SimulatedOrderResponse }) {
  if (!o.reference_date && o.reference_close == null) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="space-y-0.5 text-right">
      {o.reference_date ? <div className="font-mono text-xs whitespace-nowrap text-subtle">{o.reference_date}</div> : null}
      {o.reference_close != null ? (
        <div className="font-mono text-[11px] text-muted-foreground">{o.reference_close.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
      ) : null}
    </div>
  );
}

/** 委託紀錄 */
export function OrdersTable({ orders, loading, today }: { orders: SimulatedOrderResponse[]; loading: boolean; today: string }) {
  const headers: Array<[string, 'left' | 'right']> = [
    ['委託編號', 'left'],
    ['股票', 'left'],
    ['方向', 'left'],
    ['下單日', 'left'],
    ['賣出時間', 'left'],
    ['數量', 'right'],
    ['預估金額', 'right'],
    ['試算依據', 'left'],
    ['參考行情', 'right'],
    ['試算損益', 'right'],
    ['收益率', 'right'],
  ];
  return (
    <section>
      <SectionTitle icon={ClipboardList} title="委託紀錄" loading={loading} />
      <div className="overflow-hidden rounded-xl border bg-card shadow-card">
        <TableScrollHint className="px-5 pt-3" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/80">
                {headers.map(([label, align]) => (
                  <th key={label} className={cn(th, align === 'left' ? 'text-left' : 'text-right')}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading
                ? null
                : orders.map((o) => (
                    <tr key={o.id} className="border-b transition-colors hover:bg-muted/50">
                      <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{o.id}</td>
                      <td className="px-5 py-3 font-mono font-semibold">{o.symbol}</td>
                      <td className="px-5 py-3">
                        <span className={cn('inline-flex items-center gap-1 text-xs font-semibold', o.side === 'buy' ? 'text-up' : 'text-down')}>
                          {o.side === 'buy' ? <ArrowUpCircle size={12} aria-hidden /> : <ArrowDownCircle size={12} aria-hidden />}
                          {o.side === 'buy' ? '買' : '賣'}
                        </span>
                      </td>
                      <td className="px-5 py-3 font-mono text-xs whitespace-nowrap">{o.trade_date}</td>
                      <td className="px-5 py-3 text-xs whitespace-nowrap text-subtle">{sellPlanCell(o)}</td>
                      <td className="px-5 py-3 text-right font-mono text-xs">{o.quantity}</td>
                      <td className="px-5 py-3 text-right font-mono text-xs">{o.estimated_amount.toLocaleString()}</td>
                      <td className="px-5 py-3 align-top text-xs text-subtle">
                        {o.markup_basis ? (
                          <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 font-medium">{MARKUP_BASIS[o.markup_basis] ?? '—'}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 align-top">
                        <ReferenceCell order={o} />
                      </td>
                      <td className="px-5 py-3 text-right">
                        {o.markup_amount != null ? (
                          <span className={cn('font-mono text-xs font-medium', valueToneText(o.markup_amount))}>{signed(o.markup_amount)}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {o.sell_plan === 'by_date' && o.planned_sell_date && o.planned_sell_date > today ? '預計賣出日未到' : '—'}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-xs">
                        {o.markup_rate != null ? (
                          <span className={valueToneText(roundPct(o.markup_rate))}>{signedPct(o.markup_rate)}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
        <TableStatus loading={loading} empty={orders.length === 0} emptyText="尚無委託紀錄" />
      </div>
    </section>
  );
}
