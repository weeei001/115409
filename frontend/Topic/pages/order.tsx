import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { BookOpen, RefreshCw } from 'lucide-react';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { PaperOrderDraft, paperButton } from '@/features/order/PaperOrderDraft';
import { acknowledgePaperReview, cancelPaperOrder, fetchPaperPortfolio, paperDiscussion, paperDateTime, paperMoney, paperStatus, type PaperDraft, type PaperPortfolio } from '@/lib/api/paperPortfolio';
import { userFacingMessage } from '@/lib/api/errorDetail';
import { notificationAccountSnapshot, subscribeNotificationAccount } from '@/lib/notifications/account';

export default function OrderPage() {
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
  return <>
    <Head><title>股海明燈｜模擬投資</title><meta name="description" content="把與 AI 討論的投資想法，變成可以追蹤與回顧的模擬投資。" /></Head>
    <SiteHeader icon={BookOpen} title="模擬投資" subtitle="留下理由，追蹤變化，回顧每一次決策" />
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8" aria-label="模擬投資">
      {!ready ? <p role="status">正在確認登入狀態…</p> : !account ? <section className="mx-auto max-w-xl rounded-2xl border bg-card p-8">
        <p className="text-sm font-medium text-brand-text">你的第一筆投資實驗</p><h2 className="mt-3 text-2xl font-bold">把想法留下來，看看後來怎麼了。</h2>
        <p className="mt-4 leading-relaxed text-muted-foreground">登入後獲得 100 萬元虛擬資金。從 AI 對話建立模擬單，保留當初的理由，回來比較後續變化。</p>
        <Link className={`${paperButton} mt-6 bg-brand-gradient text-on-brand`} href={{ pathname: '/login', query: { returnUrl: '/order' } }}>登入並開始模擬投資</Link>
      </section> : <>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-2xl font-bold">我的投資實驗</h2><p className="mt-1 text-sm text-muted-foreground">先記下判斷，再讓時間提供證據。</p></div>
          <div className="flex flex-wrap gap-2"><Link href="/ai" className={paperButton}>先和 AI 討論</Link><button type="button" className={`${paperButton} bg-brand-gradient text-on-brand`} onClick={() => openDraft({ side: 'buy' })}>建立模擬單</button><button className={paperButton} onClick={() => void load()} disabled={loading} aria-label="重新整理帳戶"><RefreshCw size={16} aria-hidden /></button></div>
        </div>
        {error ? <p role="alert" className="mb-4 rounded-xl border border-danger p-4 text-sm text-danger">{error}</p> : null}
        {loading ? <p role="status" className="mb-4 text-sm text-muted-foreground">正在更新帳戶與委託狀態…</p> : null}
        {data ? <>
          <section aria-label="帳戶概況" className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border bg-border lg:grid-cols-4">
            {[['總資產', data.equity], ['可用資金', data.available_cash], ['委託保留資金', data.reserved_cash], ['已實現損益', data.realized_pnl]].map(([label, value]) => <div className="bg-card p-5" key={String(label)}><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 font-mono text-xl font-semibold tabular-nums sm:text-2xl">{paperMoney(value as number | null)}<span className="ml-1 text-xs font-normal text-muted-foreground">元</span></p></div>)}
          </section>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">初始資金 {paperMoney(data.initial_cash)} 元 · 現金 {paperMoney(data.cash)} 元 · 未實現損益 {paperMoney(data.unrealized_pnl)} 元 · 帳戶更新時間 {paperDateTime(data.as_of)}。各股行情可能不同步，請查看持股日期。</p>
          {data.accounting_note ? <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{data.accounting_note}</p> : null}
          {due.length ? <section className="mt-8 rounded-2xl border border-brand/30 bg-card p-5" aria-labelledby="reviews-title"><h2 id="reviews-title" className="text-lg font-bold">到了回顧的時候 <span className="ml-2 text-sm text-brand-text">{due.length} 筆</span></h2><p className="mt-1 text-sm text-muted-foreground">到期不會自動賣出。先檢查原始理由，再決定下一步。</p><div className="mt-4 divide-y">{due.map((review) => <article className="py-4 first:pt-0" key={review.id}><h3 className="font-semibold">{review.symbol} <span className="text-xs font-normal text-muted-foreground">回顧日 {review.due_date}</span></h3><p className="mt-2 whitespace-pre-wrap text-sm">{review.reason || '這筆決策尚未填寫理由。'}</p>{review.observation ? <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">觀察：{review.observation}</p> : null}<p className="mt-3 text-sm">期間價格報酬 {review.price_return_pct == null ? '資料不足' : `${review.price_return_pct.toFixed(2)}%`} · 同期大盤 {review.benchmark_return_pct == null ? '資料不足' : `${review.benchmark_return_pct.toFixed(2)}%`}</p><p className="mt-1 text-xs text-muted-foreground">{review.comparison_note}</p><div className="mt-3 flex flex-wrap gap-2"><Link className={paperButton} href={paperDiscussion(review.symbol, review.order_id)}>與 AI 回顧</Link><button className={paperButton} disabled={busy !== null} onClick={() => void mutate(review.id, () => acknowledgePaperReview(review.id))}>{busy === review.id ? '儲存中…' : '我已完成回顧'}</button></div></article>)}</div></section> : null}
          <section className="mt-8" aria-labelledby="positions-title"><h2 id="positions-title" className="text-lg font-bold">目前持股</h2>
            {!data.positions.length ? <div className="mt-3 rounded-2xl border border-dashed p-7"><h3 className="font-semibold">還沒有持股，先選一個想驗證的想法。</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">可以問 AI「我的收藏最近有哪些變化？」，也可以直接建立模擬單。待成交委託會在行情入庫後出現在這裡。</p><Link className={`${paperButton} mt-4`} href={{ pathname: '/ai', query: { prompt: '請讀取我的收藏股票，整理最近有哪些值得追蹤的變化，並標註資料日期。' } }}>從我的收藏開始討論</Link></div>
              : <div className="mt-3 grid gap-4 md:grid-cols-2">{data.positions.map((position) => {
                const latest = data.orders.find((order) => order.symbol === position.symbol && order.side === 'buy' && order.status === 'filled');
                return <article key={position.symbol} className="rounded-2xl border bg-card p-5"><div className="flex items-start justify-between gap-3"><h3 className="text-xl font-semibold">{position.symbol}</h3><span className="text-sm tabular-nums">{position.quantity.toLocaleString()} 股</span></div><dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-muted-foreground">持股市值</dt><dd className="mt-1 font-mono">{paperMoney(position.market_value)} 元</dd></div><div><dt className="text-muted-foreground">未實現損益</dt><dd className="mt-1 font-mono">{paperMoney(position.unrealized_pnl)} 元</dd></div><div><dt className="text-muted-foreground">平均成本</dt><dd className="mt-1 font-mono">{paperMoney(position.average_cost)} 元</dd></div><div><dt className="text-muted-foreground">行情日期</dt><dd className="mt-1">{position.market_date ?? '等待行情'}</dd></div></dl>
                  <div className="mt-4 border-t pt-3 text-sm"><p className="text-xs text-muted-foreground">最近一次買進理由</p><p className="mt-1 whitespace-pre-wrap">{latest?.reason || '未填寫，可與 AI 一起回顧這筆持股。'}</p>{latest?.review_remaining_days != null ? <p className="mt-2 text-xs text-muted-foreground">{latest.review_remaining_days > 0 ? `剩 ${latest.review_remaining_days} 個交易日回顧` : '已到回顧時間'}</p> : null}{latest?.review_due_date ? <p className="mt-2 text-xs text-muted-foreground">回顧日 {latest.review_due_date}</p> : null}</div>
                  <div className="mt-4 flex flex-wrap gap-2"><Link href={paperDiscussion(position.symbol)} className={paperButton}>與 AI 討論</Link><button className={paperButton} onClick={() => openDraft({ symbol: position.symbol, side: 'buy' })}>加碼</button><button className={paperButton} disabled={position.quantity <= position.reserved_quantity} onClick={() => openDraft({ symbol: position.symbol, side: 'sell', quantity: position.quantity - position.reserved_quantity })}>賣出</button></div>{position.reserved_quantity > 0 ? <p className="mt-2 text-xs text-muted-foreground">已有 {position.reserved_quantity} 股等待賣出成交。</p> : null}
                </article>;
              })}</div>}
          </section>
          <section className="mt-8" aria-labelledby="orders-title"><h2 id="orders-title" className="text-lg font-bold">委託與成交紀錄</h2><p className="mt-1 text-sm text-muted-foreground">採送出日期之後下一個交易日收盤價。目標交易日收盤前可取消；缺少行情時會繼續等待。</p>
            {!data.orders.length ? <p className="mt-4 rounded-xl border p-5 text-sm text-muted-foreground">尚無委託。建立後會在此顯示成交進度。</p> : <div className="mt-3 divide-y rounded-xl border bg-card">{data.orders.map((order) => <article key={order.id} className="p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">{order.symbol} · {order.side === 'buy' ? '買進' : '賣出'} <span className="ml-2 rounded bg-muted px-2 py-1 text-xs">{paperStatus(order.status)}</span></h3><p className="mt-2 text-sm text-muted-foreground">{order.status === 'filled' ? `${order.filled_quantity} 股 × ${paperMoney(order.fill_price)} 元 · ${order.trade_date} · 費用 ${paperMoney(order.fee)} 元 · 稅 ${paperMoney(order.tax)} 元` : order.side === 'buy' ? `投入上限 ${paperMoney(order.budget)} 元` : `${order.quantity} 股`}</p><p className="mt-1 text-xs text-muted-foreground">建立時間 {paperDateTime(order.created_at)}</p></div>{order.status === 'pending' ? <button className={paperButton} disabled={busy !== null} onClick={() => void mutate(order.id, () => cancelPaperOrder(order.id))}>{busy === order.id ? '取消中…' : '取消委託'}</button> : null}</div>{order.status === 'pending' ? <p className="mt-2 text-xs text-muted-foreground">{order.pending_reason || '等待目標交易日的收盤行情入庫。'}</p> : null}{order.reason ? <details className="mt-3 text-sm"><summary className="cursor-pointer text-brand-text">當時的決策</summary><p className="mt-2 whitespace-pre-wrap">{order.reason}</p><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{order.observation}</p>{order.review_remaining_days != null ? <p className="mt-2 text-xs text-muted-foreground">{order.review_remaining_days > 0 ? `剩 ${order.review_remaining_days} 個交易日回顧` : '已到回顧時間'}</p> : null}<Link className={`${paperButton} mt-3`} href={paperDiscussion(order.symbol, order.id)}>回到 AI 討論</Link></details> : null}</article>)}</div>}
          </section>
        </> : !loading && !error ? <p role="status">正在載入帳戶…</p> : null}
        {draft ? <section ref={draftRef} tabIndex={-1} className="mt-8 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2"><PaperOrderDraft key={`${account}:${draft.key}`} initial={draft.value} onCreated={() => void load()} /></section> : null}
      </>}
    </main>
  </>;
}
