import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { BookOpen, RefreshCw, X } from 'lucide-react';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { AnimatedSection } from '@/components/common/AnimatedSection';
import { Expandable, FoldSection } from '@/components/common/CollapsibleSection';
import { Ledger, LedgerPanel, LightGlyph, type LightState } from '@/components/common/Ledger';
import { signedText } from '@/components/common/LightEntry';
import { EmptyState, LoadingRows, Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/button';
import { LoginPrompt } from '@/features/auth/LoginPrompt';
import { PaperFunds } from '@/features/order/PaperFunds';
import { PaperOrderDraft } from '@/features/order/PaperOrderDraft';
import { acknowledgePaperReview, cancelPaperOrder, fetchPaperPortfolio, paperDiscussion, paperDateTime, paperMoney, paperStatus, type PaperDraft, type PaperOrder, type PaperPortfolio, type PaperReview } from '@/lib/api/paperPortfolio';
import { userFacingMessage } from '@/lib/api/errorDetail';
import { Badge } from '@/components/ui/badge';
import { useStockInfos } from '@/lib/hooks/useStockInfos';
import { notificationAccountSnapshot, subscribeNotificationAccount } from '@/lib/notifications/account';
import { valueToneText } from '@/lib/utils/tone';
import { cn } from '@/lib/cn';

const pageClass = 'mx-auto w-full max-w-[1320px] flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10';
const figure = 'font-mono text-[clamp(24px,2.4vw,32px)] leading-tight font-semibold tabular-nums';
/** 定義表的一列：左項目、右等寬數字，列與列之間是 1px 線（父層 gap-px bg-border） */
const defRow = 'flex min-h-11 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 bg-card py-2.5';

/** 損益：依正負上色並帶正負號（紅漲綠跌）；缺行情時寫「等待行情」 */
function Pnl({ value, className }: { value: number | null; className?: string }) {
  const sign = value == null ? '' : value > 0 ? '+' : value < 0 ? '−' : '';
  return <span className={cn('font-mono tabular-nums', valueToneText(value), className)}>{value == null ? '等待行情' : sign + paperMoney(Math.abs(value))}</span>;
}

function Percent({ value }: { value: number | null | undefined }) {
  return <span className={cn('font-mono tabular-nums', valueToneText(value))}>{value == null ? '等待行情' : signedText(value, 2, '%')}</span>;
}

/** 委託狀態：中性的方框徽章，不用漲跌色也不用燈色 */
function StatusBadge({ status }: { status: PaperOrder['status'] }) {
  return <Badge tone="outline" className={cn('h-6 py-0 font-normal', status === 'pending' ? 'border-border-strong text-foreground' : 'text-muted-foreground')}>{paperStatus(status)}</Badge>;
}

export default function OrderPage() {
  const router = useRouter();
  const account = useSyncExternalStore(subscribeNotificationAccount, notificationAccountSnapshot, () => '');
  const [ready, setReady] = useState(false);
  const [snapshot, setSnapshot] = useState<{ account: string; data: PaperPortfolio } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ key: number; value: Partial<PaperDraft> } | null>(null);
  const accountRef = useRef(account);
  const version = useRef(0);
  const mutationRef = useRef(false);
  const draftRef = useRef<HTMLElement>(null);
  const reviewScrolled = useRef(false);
  accountRef.current = account;
  const data = snapshot?.account === account ? snapshot.data : null;
  const load = useCallback(async () => {
    if (!account) return;
    const request = ++version.current;
    setLoading(true); setError(null);
    try {
      const result = await fetchPaperPortfolio();
      if (accountRef.current === account && version.current === request) setSnapshot({ account, data: result });
    } catch (err) {
      if (accountRef.current === account && version.current === request) setError(userFacingMessage(err, '無法載入模擬投資，請重新整理。'));
    } finally { if (accountRef.current === account && version.current === request) setLoading(false); }
  }, [account]);
  useEffect(() => { setReady(true); }, []);
  useEffect(() => {
    setSnapshot(null); setDraft(null); setError(null); setBusy(null); mutationRef.current = false;
    void load();
    const refresh = () => void load();
    window.addEventListener('focus', refresh);
    return () => { version.current += 1; window.removeEventListener('focus', refresh); };
  }, [load]);
  // 持股只有代號；名稱沿用全站的 /stocks/info（30 秒快取），查不到就只顯示代號
  const { data: stockInfos } = useStockInfos({ enabled: Boolean(account) });
  const names = useMemo<Record<string, string>>(() => Object.fromEntries((stockInfos ?? []).map((stock) => [stock.symbol, stock.name])), [stockInfos]);
  const mutate = async (id: string, action: () => Promise<unknown>) => {
    if (mutationRef.current) return;
    const owner = account;
    mutationRef.current = true; setBusy(id); setError(null);
    try { await action(); if (accountRef.current === owner) await load(); }
    catch (err) { if (accountRef.current === owner) setError(userFacingMessage(err, '操作失敗，請稍後再試。')); }
    finally { if (accountRef.current === owner) { mutationRef.current = false; setBusy(null); } }
  };
  const openDraft = (value: Partial<PaperDraft>) => {
    setDraft({ key: Date.now(), value });
    window.setTimeout(() => { draftRef.current?.scrollIntoView({ block: 'nearest' }); draftRef.current?.focus(); }, 0);
  };
  const due = data?.reviews.filter((review) => review.status === 'due') ?? [];
  const pendingOrders = data?.orders.filter((order) => order.status === 'pending') ?? [];
  const pastOrders = data?.orders.filter((order) => order.status !== 'pending') ?? [];
  const marketDate = useMemo(() => data?.positions.reduce<string | null>((latest, position) => (position.market_date && (!latest || position.market_date > latest) ? position.market_date : latest), null) ?? null, [data]);
  const fundsChanged = (result: PaperPortfolio) => {
    if (accountRef.current !== account) return;
    version.current += 1; setLoading(false); setSnapshot({ account, data: result });
  };
  // 通知裡的回顧連結（/order?review=<id>）：資料到位後捲到那一筆，只捲一次
  const reviewTarget = typeof router.query.review === 'string' ? router.query.review : null;
  useEffect(() => {
    if (!reviewTarget || !data?.initialized || reviewScrolled.current) return;
    reviewScrolled.current = true;
    (document.getElementById(`review-${reviewTarget}`) ?? document.getElementById('reviews-heading'))?.scrollIntoView({ block: 'start' });
  }, [reviewTarget, data]);

  const label = (symbol: string) => (names[symbol] ? `${symbol} ${names[symbol]}` : symbol);
  const state: LightState = loading ? 'loading' : error ? 'error' : 'ready';
  const retry = <Button variant="outline" onClick={() => void load()}><RefreshCw aria-hidden />重試</Button>;

  const reviewPanel = (review: PaperReview) => (
    <LedgerPanel key={review.id} id={`review-${review.id}`} className="scroll-mt-24">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-sm font-medium"><span className="font-mono tabular-nums">{review.symbol}</span>{names[review.symbol] ? ` ${names[review.symbol]}` : ''}</h3>
        <span className="characteristic">{review.opened_date} 買進 · {review.due_date} 到期</span>
      </div>
      <p className="mt-2 text-[15px] leading-[1.8] whitespace-pre-wrap">{review.reason || '這筆投資尚未填寫理由。'}</p>
      {review.observation ? <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">觀察重點：{review.observation}</p> : null}
      <dl className="mt-3 grid gap-px border-y bg-border text-sm sm:grid-cols-2">
        <div className={cn(defRow, 'sm:pr-4')}><dt className="text-muted-foreground">期間漲跌（{review.review_after_days} 個交易日）</dt><dd><Percent value={review.price_return_pct} /></dd></div>
        <div className={cn(defRow, 'sm:pl-4')}><dt className="text-muted-foreground">同期大盤</dt><dd><Percent value={review.benchmark_return_pct} /></dd></div>
      </dl>
      {review.comparison_note ? <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{review.comparison_note}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm"><Link href={paperDiscussion(review.symbol, review.order_id)}>與 AI 回顧</Link></Button>
        <Button variant="outline" size="sm" disabled={busy !== null} aria-busy={busy === review.id || undefined} onClick={() => void mutate(review.id, () => acknowledgePaperReview(review.id))}>{busy === review.id ? '儲存中…' : '完成回顧'}</Button>
      </div>
    </LedgerPanel>
  );

  const orderRow = (order: PaperOrder) => (
    <li key={order.id} className="px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium"><span className="font-mono tabular-nums">{order.symbol}</span>{names[order.symbol] ?? ''} · {order.side === 'buy' ? '買進' : '賣出'} <StatusBadge status={order.status} /></p>
          <p className="mt-1 text-[13px] text-subtle">{order.status === 'filled'
            ? <><span className="font-mono tabular-nums">{order.filled_quantity?.toLocaleString()}</span> 股 × <span className="font-mono tabular-nums">{paperMoney(order.fill_price)}</span> 元 · {order.trade_date} 成交</>
            : order.side === 'buy' ? <>買入金額 <span className="font-mono tabular-nums">{paperMoney(order.budget)}</span> 元</> : <><span className="font-mono tabular-nums">{order.quantity?.toLocaleString()}</span> 股</>}</p>
          <p className="characteristic mt-0.5">送出 {paperDateTime(order.created_at)}</p>
          {order.status === 'pending' && order.pending_reason ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{order.pending_reason}</p> : null}
        </div>
        {order.status === 'pending' ? <Button variant="outline" size="sm" disabled={busy !== null} aria-busy={busy === order.id || undefined} onClick={() => void mutate(order.id, () => cancelPaperOrder(order.id))}>{busy === order.id ? '取消中…' : '取消委託'}</Button> : null}
      </div>
      {order.reason ? <Expandable className="mt-3" expandLabel="當時的想法" collapseLabel="收起當時的想法" contentClassName="px-3 pt-3 text-sm">
        <p className="leading-relaxed whitespace-pre-wrap">{order.reason}</p>
        {order.observation ? <p className="mt-1 leading-relaxed whitespace-pre-wrap text-muted-foreground">觀察重點：{order.observation}</p> : null}
        <Button asChild variant="outline" size="sm" className="mt-3"><Link href={paperDiscussion(order.symbol, order.id)}>與 AI 討論</Link></Button>
      </Expandable> : null}
    </li>
  );

  const rules = data?.accounting_note ? (
    <Ledger title="模擬規則">
      <LedgerPanel>
        <p className="text-sm leading-relaxed text-subtle">委託在送出後的下一個交易日以收盤價成交，實際股數依成交價格計算。</p>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{data.accounting_note}</p>
      </LedgerPanel>
    </Ledger>
  ) : null;

  let content: React.ReactNode;
  if (!ready) {
    content = <div className="border-t border-border-strong"><LoadingRows label="確認登入狀態中…" className="h-[176px]" /></div>;
  } else if (!account) {
    content = <LoginPrompt title="用自己的預算，開始練習投資" action="登入並開始" returnUrl="/order">設定模擬資金，和 AI 討論你關注的股票，再決定怎麼買。交易與決策紀錄會存在你的帳戶裡。</LoginPrompt>;
  } else if (!data) {
    content = error
      ? <Notice tone="danger" action={retry}>{error}</Notice>
      : <div className="border-t border-border-strong"><LoadingRows label="讀取模擬投資中…" className="h-[176px]" /></div>;
  } else if (!data.initialized) {
    content = (
      <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-12 lg:gap-x-16">
        <AnimatedSection className="min-w-0 lg:col-span-7">
          <Ledger title="想用多少資金練習投資？">
            <LedgerPanel><PaperFunds key={`${account}:initial`} portfolio={data} onChanged={fundsChanged} /></LedgerPanel>
          </Ledger>
        </AnimatedSection>
        <AnimatedSection delay={0.05} className="min-w-0 lg:col-span-5">{rules}</AnimatedSection>
      </div>
    );
  } else {
    content = (
      <div className="space-y-10 lg:space-y-16">
        {error ? <Notice tone="danger" action={retry}>{error}</Notice> : null}
        <AnimatedSection>
          <Ledger
            title="我的模擬投資"
            cols="grid-cols-1 sm:grid-cols-3"
            stamp={<span className="inline-flex items-center gap-1.5"><LightGlyph state={state} />{state === 'loading' ? '更新中' : state === 'error' ? '更新失敗' : marketDate ? `持股依 ${marketDate} 收盤估值` : '已更新'}</span>}
            // 手機：燈質列一行、按鈕另起一行並排滿寬；sm 以上回到標題列右側
            actions={<div className="flex basis-full gap-2 sm:basis-auto">
              <Button asChild variant="outline" size="sm" className="flex-1 sm:flex-none"><Link href={{ pathname: '/ai', query: { prompt: '請參考我的模擬投資可用資金、持股與收藏股票，協助我討論下一步投資安排。' } }}>與 AI 討論</Link></Button>
              <Button size="sm" variant={draft ? 'outline' : 'default'} className="flex-1 sm:flex-none" onClick={() => openDraft({ side: 'buy' })}>模擬買入</Button>
              <Button variant="ghost" size="icon" onClick={() => void load()} disabled={loading} aria-label="重新整理" className="border border-transparent hover:border-border-strong"><RefreshCw aria-hidden /></Button>
            </div>}
          >
            <LedgerPanel title="可用資金" unit="元">
              <p className={figure}>{paperMoney(data.available_cash)}</p>
              <p className="mt-2 text-[13px] text-muted-foreground">{data.reserved_cash > 0 ? <>另有 <span className="font-mono tabular-nums">{paperMoney(data.reserved_cash)}</span> 元保留給待成交買單</> : '沒有保留給待成交買單的資金'}</p>
            </LedgerPanel>
            <LedgerPanel title="總資產" unit="元">
              <p className={figure}>{paperMoney(data.equity)}</p>
              <p className="mt-2 text-[13px] text-muted-foreground">累計投入 <span className="font-mono tabular-nums">{paperMoney(data.net_contributions)}</span> 元</p>
            </LedgerPanel>
            <LedgerPanel title="投資損益" unit="元">
              <p className={figure}><Pnl value={data.total_pnl} /></p>
              <p className="mt-2 text-[13px] text-muted-foreground">已實現 <Pnl value={data.realized_pnl} /> · 未實現 <Pnl value={data.unrealized_pnl} /></p>
            </LedgerPanel>
          </Ledger>
        </AnimatedSection>

        <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-12 lg:gap-x-16">
          <div className="min-w-0 space-y-10 lg:col-span-8 lg:space-y-16">
            {draft ? (
              <section ref={draftRef} tabIndex={-1} aria-label="模擬下單" className="scroll-mt-24 outline-none focus-visible:shadow-none">
                <Ledger title="模擬下單" actions={<Button variant="ghost" size="sm" onClick={() => setDraft(null)} className="border border-transparent hover:border-border-strong"><X aria-hidden />收起</Button>}>
                  <LedgerPanel><PaperOrderDraft key={`${account}:${draft.key}`} initial={draft.value} currentPortfolio={data} onCreated={() => void load()} embedded /></LedgerPanel>
                </Ledger>
              </section>
            ) : null}

            <Ledger aria-labelledby="positions-heading" title={<span id="positions-heading">我的持股</span>} stamp={`${data.positions.length} 檔`}>
              {!data.positions.length ? (
                <LedgerPanel>
                  <EmptyState className="py-6" action={<div className="mt-2 flex flex-wrap justify-center gap-2">
                    <Button asChild variant="outline"><Link href="/favorites">查看收藏</Link></Button>
                    <Button asChild variant="outline"><Link href={{ pathname: '/ai', query: { prompt: '請讀取我的收藏股票和模擬投資預算，協助我挑選適合進一步研究的股票。' } }}>請 AI 協助</Link></Button>
                  </div>}>從你關注的股票開始：挑一檔收藏，或先請 AI 幫你整理想法。</EmptyState>
                </LedgerPanel>
              ) : data.positions.map((position) => {
                const latest = data.orders.find((order) => order.symbol === position.symbol && order.side === 'buy' && order.status === 'filled');
                const sellable = position.quantity - position.reserved_quantity;
                return (
                  <LedgerPanel key={position.symbol}>
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <div className="min-w-0">
                        <h3 className="text-[15px] font-medium"><span className="font-mono tabular-nums">{position.symbol}</span>{names[position.symbol] ? ` ${names[position.symbol]}` : ''}</h3>
                        <p className="characteristic mt-0.5">{position.quantity.toLocaleString()} 股{position.reserved_quantity ? ` · ${position.reserved_quantity.toLocaleString()} 股賣出委託中` : ''}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-lg font-semibold tabular-nums">{paperMoney(position.market_value)}<span className="ml-1 text-xs font-normal text-muted-foreground">元</span></p>
                        <p className="mt-0.5 text-[13px] text-muted-foreground">未實現損益 <Pnl value={position.unrealized_pnl} /></p>
                      </div>
                    </div>
                    <Expandable className="mt-3" expandLabel="持股詳情與投資想法" collapseLabel="收起持股詳情" contentClassName="px-3 pt-3 text-sm">
                      <dl className="grid gap-px border-y bg-border sm:grid-cols-2">
                        <div className={cn(defRow, 'sm:pr-4')}><dt className="text-muted-foreground">平均成本</dt><dd className="font-mono tabular-nums">{paperMoney(position.average_cost)} 元</dd></div>
                        <div className={cn(defRow, 'sm:pl-4')}><dt className="text-muted-foreground">最近收盤</dt><dd className="font-mono tabular-nums">{position.market_price == null ? '等待行情' : `${paperMoney(position.market_price)} 元 · ${position.market_date}`}</dd></div>
                      </dl>
                      <p className="mt-3 leading-relaxed whitespace-pre-wrap">{latest?.reason || '還沒留下投資想法，可以與 AI 一起討論。'}</p>
                    </Expandable>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button asChild variant="outline" size="sm"><Link href={paperDiscussion(position.symbol)}>與 AI 討論</Link></Button>
                      <Button variant="outline" size="sm" aria-label={`買入 ${label(position.symbol)}`} onClick={() => openDraft({ symbol: position.symbol, side: 'buy' })}>買入</Button>
                      <Button variant="outline" size="sm" aria-label={`賣出 ${label(position.symbol)}`} disabled={sellable <= 0} onClick={() => openDraft({ symbol: position.symbol, side: 'sell', quantity: sellable })}>賣出</Button>
                    </div>
                  </LedgerPanel>
                );
              })}
            </Ledger>

            <Ledger aria-labelledby="reviews-heading" title={<span id="reviews-heading" className="scroll-mt-24">投資回顧</span>} stamp={due.length ? `${due.length} 筆待回顧` : '沒有待回顧'}>
              {due.length ? due.map(reviewPanel) : <LedgerPanel padded={false}><EmptyState>目前沒有待回顧的投資。買進成交後，到了設定的交易日數會出現在這裡。</EmptyState></LedgerPanel>}
            </Ledger>

            <Ledger aria-labelledby="orders-heading" title={<span id="orders-heading">交易紀錄</span>} stamp={pendingOrders.length ? `${pendingOrders.length} 筆待成交` : `共 ${data.orders.length} 筆`}>
              {!data.orders.length ? <LedgerPanel padded={false}><EmptyState>還沒有交易紀錄。</EmptyState></LedgerPanel> : <>
                {pendingOrders.length ? <div className="bg-card"><h3 className="border-b px-4 py-2.5 text-[13px] font-medium tracking-[0.04em] text-muted-foreground sm:px-5">待成交</h3><ul className="divide-y">{pendingOrders.map(orderRow)}</ul></div> : null}
                {pastOrders.length ? <FoldSection title="已成交與已取消" summary={`${pastOrders.length} 筆，由新到舊`}><ul className="divide-y">{pastOrders.map(orderRow)}</ul></FoldSection> : null}
              </>}
            </Ledger>
          </div>

          <div className="min-w-0 space-y-10 lg:col-span-4 lg:space-y-16">
            <Ledger title="管理資金">
              <LedgerPanel><PaperFunds key={`${account}:funds`} portfolio={data} onChanged={fundsChanged} /></LedgerPanel>
            </Ledger>
            {rules}
          </div>
        </div>
      </div>
    );
  }

  return <>
    <Head><title>股海明燈｜模擬投資</title><meta name="description" content="用自己的投資預算，與 AI 一起練習投資。" /></Head>
    <SiteHeader icon={BookOpen} title="模擬投資" subtitle="從你的預算開始，練習每一次投資決定" />
    <main className={pageClass} aria-label="模擬投資">{content}</main>
  </>;
}
