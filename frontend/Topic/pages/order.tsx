import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { PaperFunds } from '@/features/order/PaperFunds';
import { BookOpen, RefreshCw } from 'lucide-react';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { PaperOrderDraft, paperButton } from '@/features/order/PaperOrderDraft';
import { acknowledgePaperReview, cancelPaperOrder, fetchPaperPortfolio, paperDiscussion, paperDateTime, paperMoney, paperStatus, type PaperDraft, type PaperPortfolio } from '@/lib/api/paperPortfolio';
import { userFacingMessage } from '@/lib/api/errorDetail';
import { notificationAccountSnapshot, subscribeNotificationAccount } from '@/lib/notifications/account';

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
  const fundsChanged = (result: PaperPortfolio) => {
    if (accountRef.current !== account) return;
    version.current += 1; setLoading(false); setSnapshot({ account, data: result });
  };
  return <>
    <Head><title>股海明燈｜模擬投資</title><meta name="description" content="用自己的投資預算，與 AI 一起練習投資。" /></Head>
    <SiteHeader icon={BookOpen} title="模擬投資" subtitle="從你的預算開始，練習每一次投資決定" />
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6 lg:px-8" aria-label="模擬投資">
      {!ready ? <p role="status">正在確認登入狀態…</p> : !account ? <section className="mx-auto max-w-xl rounded-2xl border bg-card p-8">
        <h2 className="text-2xl font-bold">用自己的預算，開始練習投資。</h2>
        <p className="mt-4 leading-relaxed text-muted-foreground">設定模擬資金，和 AI 討論你關注的股票，再決定怎麼買。</p>
        <Link className={`${paperButton} mt-6 bg-brand-gradient text-on-brand`} href={{ pathname: '/login', query: { returnUrl: '/order' } }}>登入並開始</Link>
      </section> : <>
        {error ? <p role="alert" className="mb-4 rounded-xl border border-danger p-4 text-sm text-danger">{error}</p> : null}
        {loading ? <p role="status" className="mb-4 text-sm text-muted-foreground">更新中…</p> : null}
        {data ? !data.initialized ? <section className="mx-auto max-w-lg rounded-2xl border bg-card p-6 sm:p-8"><PaperFunds key={`${account}:initial`} portfolio={data} onChanged={fundsChanged} /></section> : <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-bold">我的模擬投資</h2>
            <div className="flex flex-wrap gap-2"><Link href={{ pathname: '/ai', query: { prompt: '請參考我的模擬投資可用資金、持股與收藏股票，協助我討論下一步投資安排。' } }} className={paperButton}>與 AI 討論</Link><button type="button" className={`${paperButton} bg-brand-gradient text-on-brand`} onClick={() => openDraft({ side: 'buy' })}>模擬買入</button><button className={paperButton} onClick={() => void load()} disabled={loading} aria-label="重新整理"><RefreshCw size={16} aria-hidden /></button></div>
          </div>
          <section aria-label="模擬資金概況" className="grid gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-3">
            {[['可用資金', data.available_cash], ['總資產', data.equity], ['投資損益', data.total_pnl]].map(([label, value]) => <div className="bg-card p-5" key={String(label)}><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 font-mono text-2xl font-semibold tabular-nums">{paperMoney(value as number | null)}<span className="ml-1 text-xs font-normal text-muted-foreground">元</span></p></div>)}
          </section>
          <details className="mt-4 rounded-xl border bg-card p-4"><summary className="cursor-pointer text-sm font-medium">管理資金</summary><div className="mt-4 max-w-lg"><PaperFunds key={`${account}:funds`} portfolio={data} onChanged={fundsChanged} /></div></details>
          {draft ? <section ref={draftRef} tabIndex={-1} className="mt-6 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2"><div className="mb-2 flex justify-end"><button className="text-sm text-muted-foreground underline" onClick={() => setDraft(null)}>收起下單</button></div><PaperOrderDraft key={`${account}:${draft.key}`} initial={draft.value} currentPortfolio={data} onCreated={() => void load()} /></section> : null}
          <section className="mt-8" aria-labelledby="positions-title"><h2 id="positions-title" className="text-lg font-bold">我的持股</h2>
            {!data.positions.length ? <div className="mt-3 rounded-2xl border border-dashed p-6"><h3 className="font-semibold">從你關注的股票開始。</h3><p className="mt-2 text-sm text-muted-foreground">挑一檔收藏，或先請 AI 幫你整理想法。</p><div className="mt-4 flex flex-wrap gap-2"><Link className={paperButton} href="/favorites">查看收藏</Link><Link className={paperButton} href={{ pathname: '/ai', query: { prompt: '請讀取我的收藏股票和模擬投資預算，協助我挑選適合進一步研究的股票。' } }}>請 AI 協助</Link></div></div>
              : <div className="mt-3 divide-y rounded-2xl border bg-card">{data.positions.map((position) => {
                const latest = data.orders.find((order) => order.symbol === position.symbol && order.side === 'buy' && order.status === 'filled');
                return <article key={position.symbol} className="p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-semibold">{position.symbol}</h3><p className="mt-1 text-sm text-muted-foreground">{position.quantity.toLocaleString()} 股</p></div><div className="text-right text-sm"><p className="font-mono text-lg">{paperMoney(position.market_value)} 元</p><p className="mt-1 text-muted-foreground">損益 {paperMoney(position.unrealized_pnl)} 元</p></div></div>
                  <details className="mt-3 text-sm"><summary className="cursor-pointer text-muted-foreground">持股詳情與投資想法</summary><p className="mt-3">平均成本 {paperMoney(position.average_cost)} 元 · 行情日期 {position.market_date ?? '等待行情'}</p><p className="mt-2 whitespace-pre-wrap">{latest?.reason || '還沒留下投資想法，可以與 AI 一起討論。'}</p></details>
                  <div className="mt-4 flex flex-wrap gap-2"><Link href={paperDiscussion(position.symbol)} className={paperButton}>與 AI 討論</Link><button className={paperButton} onClick={() => openDraft({ symbol: position.symbol, side: 'buy' })}>買入</button><button className={paperButton} disabled={position.quantity <= position.reserved_quantity} onClick={() => openDraft({ symbol: position.symbol, side: 'sell', quantity: position.quantity - position.reserved_quantity })}>賣出</button></div>
                </article>;
              })}</div>}
          </section>
          <details className="mt-6 rounded-xl border bg-card p-5" open={Boolean(router.query.review) || undefined}><summary className="cursor-pointer font-semibold">投資回顧{due.length ? ` · ${due.length} 筆待回顧` : ''}</summary>
            {!due.length ? <p className="mt-4 text-sm text-muted-foreground">目前沒有待回顧的投資。</p> : <div className="mt-4 divide-y">{due.map((review) => <article className="py-4 first:pt-0" key={review.id}><h3 className="font-semibold">{review.symbol} <span className="text-xs font-normal text-muted-foreground">{review.due_date}</span></h3><p className="mt-2 whitespace-pre-wrap text-sm">{review.reason || '這筆投資尚未填寫理由。'}</p>{review.observation ? <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{review.observation}</p> : null}<p className="mt-3 text-sm">期間漲跌 {review.price_return_pct == null ? '等待行情' : `${review.price_return_pct.toFixed(2)}%`} · 同期大盤 {review.benchmark_return_pct == null ? '等待行情' : `${review.benchmark_return_pct.toFixed(2)}%`}</p><div className="mt-3 flex flex-wrap gap-2"><Link className={paperButton} href={paperDiscussion(review.symbol, review.order_id)}>與 AI 回顧</Link><button className={paperButton} disabled={busy !== null} onClick={() => void mutate(review.id, () => acknowledgePaperReview(review.id))}>{busy === review.id ? '儲存中…' : '完成回顧'}</button></div></article>)}</div>}
          </details>
          <details className="mt-4 rounded-xl border bg-card p-5"><summary className="cursor-pointer font-semibold">交易紀錄{data.orders.some((order) => order.status === 'pending') ? ` · ${data.orders.filter((order) => order.status === 'pending').length} 筆待成交` : ''}</summary>
            {!data.orders.length ? <p className="mt-4 text-sm text-muted-foreground">還沒有交易紀錄。</p> : <div className="mt-3 divide-y">{data.orders.map((order) => <article key={order.id} className="py-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">{order.symbol} · {order.side === 'buy' ? '買進' : '賣出'} <span className="ml-2 rounded bg-muted px-2 py-1 text-xs">{paperStatus(order.status)}</span></h3><p className="mt-2 text-sm text-muted-foreground">{order.status === 'filled' ? `${order.filled_quantity} 股 × ${paperMoney(order.fill_price)} 元 · ${order.trade_date}` : order.side === 'buy' ? `買入金額 ${paperMoney(order.budget)} 元` : `${order.quantity} 股`}</p><p className="mt-1 text-xs text-muted-foreground">{paperDateTime(order.created_at)}</p></div>{order.status === 'pending' ? <button className={paperButton} disabled={busy !== null} onClick={() => void mutate(order.id, () => cancelPaperOrder(order.id))}>{busy === order.id ? '取消中…' : '取消委託'}</button> : null}</div>{order.reason ? <details className="mt-3 text-sm"><summary className="cursor-pointer text-muted-foreground">當時的想法</summary><p className="mt-2 whitespace-pre-wrap">{order.reason}</p><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{order.observation}</p><Link className={`${paperButton} mt-3`} href={paperDiscussion(order.symbol, order.id)}>與 AI 討論</Link></details> : null}</article>)}</div>}
          </details>
        </> : !loading && !error ? <p role="status">正在載入…</p> : null}
      </>}
    </main>
  </>;
}
