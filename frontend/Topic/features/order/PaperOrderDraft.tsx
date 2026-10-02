import React, { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { createPaperOrder, fetchPaperPortfolio, paperMoney, paperStatus, type PaperDraft, type PaperOrder, type PaperPortfolio } from '@/lib/api/paperPortfolio';
import { userFacingMessage } from '@/lib/api/errorDetail';
import { ApiRequestError } from '@/lib/api/client';
import { notificationAccountSnapshot, subscribeNotificationAccount } from '@/lib/notifications/account';

export const paperInput = 'mt-1 min-h-11 w-full rounded-lg border border-input bg-muted px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:text-sm';
export const paperButton = 'inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50';

export function PaperOrderStatus({ order }: { order: PaperOrder }) {
  return <section className="rounded-xl border bg-muted p-4" aria-label="模擬委託狀態">
    <p className="font-semibold" role="status">{order.symbol} · {order.side === 'buy' ? '買進' : '賣出'} · {paperStatus(order.status)}</p>
    <p className="mt-2 text-sm text-muted-foreground">{order.status === 'filled' ? `${order.filled_quantity} 股 · 成交價 ${paperMoney(order.fill_price)} 元 · ${order.trade_date}` : order.status === 'cancelled' ? '這筆委託已取消。' : '預計於下一交易日收盤成交。'}</p>
    <Link className={`${paperButton} mt-3`} href="/order">查看模擬投資</Link>
  </section>;
}

export function PaperOrderDraft({ initial, requestId, onCreated, currentPortfolio }: {
  initial?: Partial<PaperDraft>;
  currentPortfolio?: PaperPortfolio;
  requestId?: string;
  onCreated?: (order: PaperOrder) => void;
}) {
  const scope = useId();
  const account = useSyncExternalStore(subscribeNotificationAccount, notificationAccountSnapshot, () => '');
  const [symbol, setSymbol] = useState(initial?.symbol ?? '');
  const [side, setSide] = useState<'buy' | 'sell'>(initial?.side ?? 'buy');
  const [amount, setAmount] = useState(String(initial?.side === 'sell' ? initial.quantity ?? '' : initial?.budget ?? ''));
  const [reason, setReason] = useState(initial?.reason ?? '');
  const [observation, setObservation] = useState(initial?.observation ?? '');
  const days = String(initial?.review_after_days ?? 20);
  const [order, setOrder] = useState<PaperOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [portfolio, setPortfolio] = useState<PaperPortfolio | null>(null);
  const [locked, setLocked] = useState(false);
  const idRef = useRef(requestId ?? '');
  const submitting = useRef(false);
  const accountRef = useRef(account);
  accountRef.current = account;

  useEffect(() => {
    setOrder(null);
    setPortfolio(null);
    idRef.current = requestId ?? "";
    setError(null);
    setLocked(false);
    setBusy(false);
    submitting.current = false;
    if (!account) { setChecking(false); return; }
    const ctrl = new AbortController();
    setChecking(true);
    const refresh = () => {
      void fetchPaperPortfolio(ctrl.signal).then((portfolio) => {
        if (ctrl.signal.aborted) return;
        setPortfolio(portfolio);
        const match = portfolio.orders.find((item) => item.client_request_id === requestId);
        if (match) setOrder(match);
        setError(null);
        setChecking(false);
      }).catch((err) => {
        if (ctrl.signal.aborted) return;
        setError(userFacingMessage(err, '無法確認委託狀態，請重新載入後再試。'));
        setChecking(false);
      });
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => { ctrl.abort(); window.removeEventListener('focus', refresh); };
  }, [account, requestId]);

  const funds = currentPortfolio ?? portfolio;
  const availableShares = funds?.positions.find((position) => position.symbol === symbol.trim().toUpperCase());
  const sellable = availableShares ? availableShares.quantity - availableShares.reserved_quantity : 0;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current || !account || checking || order || !funds?.initialized) return;
    if (!/^[0-9A-Z]{1,10}$/.test(symbol.trim().toUpperCase()) || !Number.isFinite(Number(amount)) || Number(amount) <= 0
      || (side === 'sell' && !Number.isSafeInteger(Number(amount))) || !Number.isInteger(Number(days)) || Number(days) < 1 || Number(days) > 250) {
      setError('請填入股票代號、有效金額或整數股數，以及 1 至 250 個交易日。'); return;
    }
    if (!locked && side === 'buy' && Number(amount) > funds.available_cash) { setError('可用資金不足，請降低買入金額。'); return; }
    if (!locked && side === 'sell' && Number(amount) > sellable) { setError('賣出股數不能超過可賣股數。'); return; }
    if (!idRef.current) idRef.current = crypto.randomUUID();
    submitting.current = true;
    setBusy(true); setLocked(true); setError(null);
    const owner = account;
    try {
      const created = await createPaperOrder({ symbol: symbol.trim().toUpperCase(), side,
        budget: side === 'buy' ? Number(amount) : null, quantity: side === 'sell' ? Number(amount) : null,
        reason: reason.trim(), observation: observation.trim(), review_after_days: Number(days),
        conversation_id: initial?.conversation_id ?? null }, idRef.current);
      if (accountRef.current !== owner) return;
      setOrder(created); onCreated?.(created);
    } catch (err) {
      if (accountRef.current === owner) {
        setError(userFacingMessage(err, '委託送出失敗，請重試。'));
        if (err instanceof ApiRequestError && err.status != null && err.status >= 400 && err.status < 500 && ![408, 409, 429].includes(err.status)) setLocked(false);
      }
    } finally { if (accountRef.current === owner) { submitting.current = false; setBusy(false); } }
  };

  if (!account) return <p className="rounded-xl border bg-muted p-4 text-sm"><Link className="text-brand-text underline" href={{ pathname: '/login', query: { returnUrl: '/order' } }}>登入</Link>後確認模擬單，使用帳戶的虛擬資金。</p>;
  if (order) return <PaperOrderStatus order={order} />;
  if (funds && !funds.initialized) return <p className="rounded-xl border bg-card p-4 text-sm">先設定想投入的模擬資金，再回來確認這筆委託。<Link className={`${paperButton} mt-3`} href="/order">設定模擬資金</Link></p>;
  return <form onSubmit={(event) => void submit(event)} className="rounded-xl border bg-card p-4 sm:p-5" aria-label="確認模擬單" aria-busy={busy || checking}>
    <h3 className="font-semibold">模擬下單</h3>
    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">預計於下一交易日收盤成交，實際股數依成交價格計算。</p>
    <fieldset disabled={busy || checking || locked} className="mt-4 grid gap-4 sm:grid-cols-2">
      <legend className="sr-only">模擬委託內容</legend>
      <label htmlFor={`${scope}-symbol`} className="text-sm">股票代號<input id={`${scope}-symbol`} className={paperInput} value={symbol} onChange={(e) => setSymbol(e.target.value)} maxLength={10} required placeholder="例如 2330" /></label>
      <label htmlFor={`${scope}-side`} className="text-sm">操作<select id={`${scope}-side`} className={paperInput} value={side} onChange={(e) => { setSide(e.target.value as 'buy' | 'sell'); setAmount(''); }}><option value="buy">買進</option><option value="sell">賣出</option></select></label>
      <label htmlFor={`${scope}-amount`} className="text-sm">{side === 'buy' ? '想買多少錢（元）' : '賣出股數（股）'}<input id={`${scope}-amount`} className={paperInput} type="number" min={side === 'buy' ? 0.01 : 1} max={1000000000} step={side === 'buy' ? '0.01' : '1'} required value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <details className="sm:col-span-2"><summary className="cursor-pointer text-sm text-muted-foreground">記下投資想法（選填）</summary><div className="mt-3 grid gap-4">      <label htmlFor={`${scope}-reason`} className="text-sm sm:col-span-2">我的理由（選填）<textarea id={`${scope}-reason`} className={paperInput} rows={2} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="當初為什麼做這個決定？" /></label>
      <label htmlFor={`${scope}-observation`} className="text-sm sm:col-span-2">觀察重點（選填）<textarea id={`${scope}-observation`} className={paperInput} rows={2} maxLength={2000} value={observation} onChange={(e) => setObservation(e.target.value)} placeholder="哪些變化會支持或推翻你的想法？" /></label>
</div></details>
    </fieldset>
    {funds && side === 'sell' ? <p className="mt-3 text-sm text-muted-foreground">可賣股數 {sellable.toLocaleString()} 股</p> : null}
    {funds && side === 'buy' ? <p className="mt-3 text-sm text-muted-foreground">可用資金 {paperMoney(funds.available_cash)} 元{side === 'buy' && Number(amount) > 0 && Number(amount) <= funds.available_cash ? ` · 預計剩餘至少 ${paperMoney(funds.available_cash - Number(amount))} 元` : ''}</p> : null}
    {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
    {locked && !busy ? <p className="mt-2 text-xs text-muted-foreground">尚未確認送出結果，請重試或查看交易紀錄。</p> : null}
    <button type="submit" disabled={busy || checking || !funds} className={`${paperButton} mt-4 bg-brand-gradient text-on-brand`}>{busy ? '正在建立…' : checking ? '確認委託狀態…' : locked ? '重試相同委託' : '確認建立模擬單'}</button>
  </form>;
}
