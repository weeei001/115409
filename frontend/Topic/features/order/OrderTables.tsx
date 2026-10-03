import React, { useRef } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';
import type { SimulatedOrderCategoryProfitItem, SimulatedOrderCategoryProfitResponse, SimulatedOrderResponse } from '@/lib/types/api';
import { TableScrollHint } from '@/components/common/CollapsibleSection';
import { Ledger, LightGlyph, type LightState } from '@/components/common/Ledger';
import { EmptyState, LoadingRows } from '@/components/common/Notice';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/lib/hooks/useClientEnv';
import { valueToneText } from '@/lib/utils/tone';
import { cn } from '@/lib/cn';

/** 帳頁表格：表頭淺底加粗線，列高至少 44px，數字等寬靠右 */
const th = 'h-11 px-4 font-medium text-[12px] tracking-[0.04em] whitespace-nowrap text-muted-foreground first:pl-4 sm:first:pl-5';
const td = 'h-11 px-4 py-2.5 first:pl-4 sm:first:pl-5';
const num = 'text-right font-mono text-[13.5px] tabular-nums';
const rowClass = 'border-b last:border-b-0 transition-colors duration-(--dur-flash) hover:bg-accent';
/** 0 不加「+」（決議 c7） */
const signed = (v: number) => `${v > 0 ? '+' : ''}${v.toLocaleString()}`;
/** 百分比先取到小數兩位再判斷正負，才不會出現「+0.00%」「-0.00%」（決議 c7）；`|| 0` 把 -0 變成 0 */
const roundPct = (v: number) => Number(v.toFixed(2)) || 0;
const signedPct = (v: number) => {
  const r = roundPct(v);
  return `${r > 0 ? '+' : ''}${r.toFixed(2)}%`;
};

/** 表格的一欄：表頭、對齊與儲存格。手機版（< lg）依 `mobileOrder` 重排，讓損益與收益率不必橫向捲動就看得到 */
interface Column<T> {
  key: string;
  label: string;
  align: 'left' | 'right';
  className?: string;
  cell: (row: T) => React.ReactNode;
}

function orderColumns<T>(columns: Column<T>[], mobile: boolean, mobileOrder: string[]): Column<T>[] {
  if (!mobile) return columns;
  const byKey = new Map(columns.map((c) => [c.key, c]));
  return mobileOrder.map((k) => byKey.get(k)).filter((c): c is Column<T> => Boolean(c));
}

function DataTable<T>({ columns, rows, rowKey, loading }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => React.Key; loading: boolean }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border-strong bg-muted">
          {columns.map((c) => (
            <th key={c.key} scope="col" className={cn(th, c.align === 'left' ? 'text-left' : 'text-right')}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {loading
          ? null
          : rows.map((row) => (
              <tr key={rowKey(row)} className={rowClass}>
                {columns.map((c) => (
                  <td key={c.key} className={cn(td, c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
      </tbody>
    </table>
  );
}

/**
 * 載入中與空狀態放在表格外面：窄螢幕表格會橫向捲動，放在表格列裡會被置中到畫面外。載入＝燈質 Q（有線的空白列＋「讀取中」）。
 * 讀取失敗：錯誤已在委託單上方說過一次，這裡只放靜止的一行說明，不再顯示「尚無資料」。
 */
function TableStatus({ loading, failed, empty, emptyText, action }: { loading: boolean; failed?: boolean; empty: boolean; emptyText: string; action?: React.ReactNode }) {
  if (loading) return <LoadingRows className="h-[132px]" />;
  if (failed) return <p className="border-t px-4 py-3 text-[13px] leading-relaxed text-muted-foreground sm:px-5">這張表沒有讀到資料，原因見委託單上方的說明。</p>;
  return empty ? <EmptyState action={action}>{emptyText}</EmptyState> : null;
}

/** 帳頁標題右側的戳記：燈質記號（Q 讀取中／F 已載入／熄燈 失敗）加一段真實資訊 */
function StateStamp({ state, children }: { state: LightState; children?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <LightGlyph state={state} />
      {state === 'loading' ? '讀取中' : state === 'error' ? '讀取失敗' : children}
    </span>
  );
}

/** 舊的呼叫端只傳 loading：沒給 state 時由 loading 推得 */
const resolveState = (state: LightState | undefined, loading: boolean): LightState => (loading ? 'loading' : state ?? 'ready');

/** 表格外框：帳頁裡的一格，表格只在自己的容器內橫向捲動；真的放不下時才顯示「左右滑動」提示 */
function TablePanel({ children, status, className }: { children: React.ReactNode; status: React.ReactNode; className?: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <div data-stagger className={cn('min-w-0 bg-card', className)}>
      <TableScrollHint scrollRef={scrollRef} className="px-4 pt-3 pb-2 sm:px-5" />
      <div ref={scrollRef} className="overflow-x-auto">
        {children}
      </div>
      {status}
    </div>
  );
}

/** 空狀態的下一步：中性外框按鈕（燈色留給委託單的主要按鈕） */
function EmptyAction({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Button asChild variant="outline" className="mt-2">
      <Link href={href}>
        {children}
        <ArrowRight aria-hidden />
      </Link>
    </Button>
  );
}

/** 帳頁頂端的讀數格：小標＋等寬大數字 */
function Reading({ label, value }: { label: string; value: number }) {
  return (
    <div data-stagger className="min-w-0 bg-card px-4 py-3 sm:px-5">
      <p className="text-[13px] font-medium tracking-[0.04em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">
        {value.toLocaleString()}
        <span className="ml-1 font-sans text-xs font-normal text-muted-foreground">筆</span>
      </p>
    </div>
  );
}

const SUMMARY_COLUMNS: Column<SimulatedOrderCategoryProfitItem>[] = [
  { key: 'symbol', label: '股票', align: 'left', className: 'font-mono text-[13.5px] font-medium tabular-nums', cell: (r) => r.category },
  { key: 'count', label: '筆數', align: 'right', className: num, cell: (r) => r.order_count },
  { key: 'cost', label: '成本（元）', align: 'right', className: num, cell: (r) => r.cost_amount.toLocaleString() },
  { key: 'market', label: '市值（元）', align: 'right', className: num, cell: (r) => r.market_amount.toLocaleString() },
  { key: 'profit', label: '損益（元）', align: 'right', className: cn(num, 'font-medium'), cell: (r) => <span className={valueToneText(r.profit_amount)}>{signed(r.profit_amount)}</span> },
  { key: 'rate', label: '收益率', align: 'right', className: num, cell: (r) => <span className={valueToneText(roundPct(r.profit_rate))}>{signedPct(r.profit_rate)}</span> },
];
/** 手機：損益與收益率緊接在股票後面，不用橫向捲動就看得到 */
const SUMMARY_MOBILE_ORDER = ['symbol', 'profit', 'rate', 'count', 'cost', 'market'];

/** 依股票彙總（模擬收益） */
export function ProfitSummaryTable({ summary, loading, state }: { summary: SimulatedOrderCategoryProfitResponse | null; loading: boolean; state?: LightState }) {
  const rows = summary?.data ?? [];
  const isMobile = useIsMobile();
  const light = resolveState(state, loading);
  return (
    <Ledger title="依股票彙總（模擬收益）" stamp={<StateStamp state={light}>{`${rows.length} 檔`}</StateStamp>} cols="grid-cols-3">
      {summary ? (
        <>
          <Reading label="總委託" value={summary.total_orders} />
          <Reading label="可估值" value={summary.priced_orders} />
          <Reading label="無行情" value={summary.unpriced_orders} />
        </>
      ) : null}
      <TablePanel
        className="col-span-3"
        status={
          <TableStatus
            loading={loading}
            failed={light === 'error'}
            empty={rows.length === 0}
            emptyText="尚無彙總資料。送出第一筆模擬委託後，這裡會依股票合計成本、市值與損益。"
            action={<EmptyAction href="/#terminal">先查一檔股票</EmptyAction>}
          />
        }
      >
        <DataTable columns={orderColumns(SUMMARY_COLUMNS, isMobile, SUMMARY_MOBILE_ORDER)} rows={rows} rowKey={(r) => r.category} loading={loading} />
      </TablePanel>
    </Ledger>
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
      {o.reference_date ? <div className="font-mono text-xs whitespace-nowrap tabular-nums text-subtle">{o.reference_date}</div> : null}
      {o.reference_close != null ? (
        <div className="font-mono text-[13.5px] tabular-nums">{o.reference_close.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
      ) : null}
    </div>
  );
}

/** 委託紀錄的欄位；`today` 用來判斷「預計賣出日未到」 */
function orderColumnsFor(today: string): Column<SimulatedOrderResponse>[] {
  return [
    { key: 'id', label: '委託編號', align: 'left', className: 'font-mono text-xs tabular-nums text-muted-foreground', cell: (o) => o.id },
    { key: 'symbol', label: '股票', align: 'left', className: 'font-mono text-[13.5px] font-medium tabular-nums', cell: (o) => o.symbol },
    {
      key: 'side',
      label: '方向',
      align: 'left',
      // 方向：文字＋箭頭，買進用 up、賣出用 down（台股紅漲綠跌）
      cell: (o) => (
        <span className={cn('inline-flex items-center gap-1 text-xs font-semibold whitespace-nowrap', o.side === 'buy' ? 'text-up' : 'text-down')}>
          {o.side === 'buy' ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden />}
          {o.side === 'buy' ? '買' : '賣'}
        </span>
      ),
    },
    { key: 'date', label: '下單日', align: 'left', className: 'font-mono text-xs whitespace-nowrap tabular-nums', cell: (o) => o.trade_date },
    { key: 'plan', label: '賣出時間', align: 'left', className: 'text-xs whitespace-nowrap text-subtle', cell: sellPlanCell },
    { key: 'qty', label: '數量', align: 'right', className: num, cell: (o) => o.quantity },
    { key: 'amount', label: '預估金額', align: 'right', className: num, cell: (o) => o.estimated_amount.toLocaleString() },
    {
      key: 'basis',
      label: '試算依據',
      align: 'left',
      className: 'text-xs whitespace-nowrap text-subtle',
      cell: (o) =>
        o.markup_basis ? (
          <span className="inline-flex items-center rounded-sm border px-1.5 py-0.5 font-medium">{MARKUP_BASIS[o.markup_basis] ?? '—'}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { key: 'ref', label: '參考行情', align: 'right', cell: (o) => <ReferenceCell order={o} /> },
    {
      key: 'markup',
      label: '試算損益',
      align: 'right',
      className: 'text-right',
      cell: (o) =>
        o.markup_amount != null ? (
          <span className={cn('font-mono text-[13.5px] font-medium tabular-nums', valueToneText(o.markup_amount))}>{signed(o.markup_amount)}</span>
        ) : (
          <span className="text-xs whitespace-nowrap text-muted-foreground">
            {o.sell_plan === 'by_date' && o.planned_sell_date && o.planned_sell_date > today ? '預計賣出日未到' : '—'}
          </span>
        ),
    },
    {
      key: 'rate',
      label: '收益率',
      align: 'right',
      className: num,
      cell: (o) => (o.markup_rate != null ? <span className={valueToneText(roundPct(o.markup_rate))}>{signedPct(o.markup_rate)}</span> : <span className="text-muted-foreground">—</span>),
    },
  ];
}
/** 手機：股票、方向之後就是試算損益與收益率；委託編號放最後 */
const ORDERS_MOBILE_ORDER = ['symbol', 'side', 'markup', 'rate', 'qty', 'amount', 'date', 'plan', 'basis', 'ref', 'id'];

/** 委託紀錄 */
export function OrdersTable({ orders, loading, today, state }: { orders: SimulatedOrderResponse[]; loading: boolean; today: string; state?: LightState }) {
  const isMobile = useIsMobile();
  const light = resolveState(state, loading);
  return (
    <Ledger title="委託紀錄" stamp={<StateStamp state={light}>{`共 ${orders.length} 筆`}</StateStamp>}>
      <TablePanel
        status={
          <TableStatus
            loading={loading}
            failed={light === 'error'}
            empty={orders.length === 0}
            emptyText="尚無委託紀錄。填好委託單並確認後，每一筆都會記在這裡。"
            action={<EmptyAction href="#order-form">填寫委託單</EmptyAction>}
          />
        }
      >
        <DataTable columns={orderColumns(orderColumnsFor(today), isMobile, ORDERS_MOBILE_ORDER)} rows={orders} rowKey={(o) => o.id} loading={loading} />
      </TablePanel>
    </Ledger>
  );
}
