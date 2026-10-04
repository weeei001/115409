import React, { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Expandable } from '@/components/common/CollapsibleSection';
import { Notice } from '@/components/common/Notice';
import { LedgerPanel, panelClass } from '@/components/common/Ledger';
import { Button, textLinkClass } from '@/components/ui/button';
import { fieldLabelClass, inputClass } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { cn } from '@/lib/cn';
import { createPaperOrder, fetchPaperPortfolio, paperMoney, paperStatus, type PaperDraft, type PaperOrder, type PaperPortfolio } from '@/lib/api/paperPortfolio';
import { userFacingMessage } from '@/lib/api/errorDetail';
import { ApiRequestError } from '@/lib/api/client';
import { notificationAccountSnapshot, subscribeNotificationAccount } from '@/lib/notifications/account';

/** 標籤下方的輸入框（全站同一套外觀，見 components/ui/input） */
const fieldInput = cn('mt-1.5', inputClass);
/** 文字連結：中性色加底線，燈色留給主要按鈕 */
export const paperLink = cn('font-medium text-foreground', textLinkClass);

/** embedded：放在模擬投資頁的帳頁裡，不畫外框，也不連回 /order */
export function PaperOrderStatus({ order, embedded = false }: { order: PaperOrder; embedded?: boolean }) {
  return <LedgerPanel as="section" padded={!embedded} framed={!embedded} aria-label="模擬委託狀態">
    <p className="font-medium" role="status"><span className="font-mono tabular-nums">{order.symbol}</span> · {order.side === 'buy' ? '買進' : '賣出'} · {paperStatus(order.status)}</p>
    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{order.status === 'filled' ? <span className="font-mono tabular-nums">{`${order.filled_quantity} 股 · 成交價 ${paperMoney(order.fill_price)} 元 · ${order.trade_date}`}</span> : order.status === 'cancelled' ? '這筆委託已取消。' : '預計於下一交易日收盤成交。'}</p>
    {embedded ? null : <Button asChild variant="outline" className="mt-3"><Link href="/order">查看模擬投資</Link></Button>}
  </LedgerPanel>;
}

export function PaperOrderDraft({ initial, requestId, onCreated, currentPortfolio, embedded = false }: {
  initial?: Partial<PaperDraft>;
  currentPortfolio?: PaperPortfolio;
  requestId?: string;
  onCreated?: (order: PaperOrder) => void;
  /** 模擬投資頁：外層帳頁已有標題與外框 */
  embedded?: boolean;
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

  const frame = cn(!embedded && ['border', panelClass]);
  if (!account) return <p className={cn(frame, 'text-sm leading-relaxed')}><Link className={paperLink} href={{ pathname: '/login', query: { returnUrl: '/order' } }}>登入</Link>後確認模擬單，使用帳戶的虛擬資金。</p>;
  if (order) return <PaperOrderStatus order={order} embedded={embedded} />;
  if (funds && !funds.initialized) return <div className={cn(frame, 'text-sm leading-relaxed')}><p>先設定想投入的模擬資金，再回來確認這筆委託。</p><Button asChild variant="outline" className="mt-3"><Link href="/order">設定模擬資金</Link></Button></div>;
  return <form onSubmit={(event) => void submit(event)} className={frame} aria-label="確認模擬單" aria-busy={busy || checking}>
    {embedded ? null : <h3 className="text-[13px] font-medium tracking-[0.04em] text-muted-foreground">模擬下單</h3>}
    <p className={cn('text-[13px] leading-relaxed text-muted-foreground', !embedded && 'mt-1')}>預計於下一交易日收盤成交，實際股數依成交價格計算。</p>
    <fieldset disabled={busy || checking || locked} className="mt-4 min-w-0 space-y-4">
      <legend className="sr-only">模擬委託內容</legend>
      <div className="grid gap-4 sm:grid-cols-3">
        <label htmlFor={`${scope}-symbol`} className={fieldLabelClass}>股票代號<input id={`${scope}-symbol`} className={cn(fieldInput, 'font-mono tabular-nums')} value={symbol} onChange={(e) => setSymbol(e.target.value)} maxLength={10} required placeholder="例如 2330" /></label>
        <label htmlFor={`${scope}-side`} className={fieldLabelClass}>操作<NativeSelect wrapperClassName="mt-1.5" id={`${scope}-side`} value={side} onChange={(e) => { setSide(e.target.value as 'buy' | 'sell'); setAmount(''); }}><option value="buy">買進</option><option value="sell">賣出</option></NativeSelect></label>
        <label htmlFor={`${scope}-amount`} className={fieldLabelClass}>{side === 'buy' ? '想買多少錢（元）' : '賣出股數（股）'}<input id={`${scope}-amount`} className={cn(fieldInput, 'font-mono tabular-nums')} type="number" min={side === 'buy' ? 0.01 : 1} max={1000000000} step={side === 'buy' ? '0.01' : '1'} required value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      </div>
      <Expandable expandLabel="記下投資想法（選填）" collapseLabel="收起投資想法" defaultOpen={Boolean(initial?.reason || initial?.observation)} contentClassName="grid gap-4 pt-4">
        <label htmlFor={`${scope}-reason`} className={fieldLabelClass}>我的理由（選填）<textarea id={`${scope}-reason`} className={cn(fieldInput, 'h-auto min-h-[4.5rem] py-2 leading-relaxed')} rows={2} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="當初為什麼做這個決定？" /></label>
        <label htmlFor={`${scope}-observation`} className={fieldLabelClass}>觀察重點（選填）<textarea id={`${scope}-observation`} className={cn(fieldInput, 'h-auto min-h-[4.5rem] py-2 leading-relaxed')} rows={2} maxLength={2000} value={observation} onChange={(e) => setObservation(e.target.value)} placeholder="哪些變化會支持或推翻你的想法？" /></label>
      </Expandable>
    </fieldset>
    {funds && side === 'sell' ? <p className="mt-3 text-[13px] text-muted-foreground">可賣股數 <span className="font-mono tabular-nums text-foreground">{sellable.toLocaleString()}</span> 股</p> : null}
    {funds && side === 'buy' ? <p className="mt-3 text-[13px] text-muted-foreground">可用資金 <span className="font-mono tabular-nums text-foreground">{paperMoney(funds.available_cash)}</span> 元{Number(amount) > 0 && Number(amount) <= funds.available_cash ? <> · 預計剩餘至少 <span className="font-mono tabular-nums text-foreground">{paperMoney(funds.available_cash - Number(amount))}</span> 元</> : null}</p> : null}
    {error ? <Notice tone="danger" className="mt-3">{error}</Notice> : null}
    {locked && !busy ? <p className="mt-2 text-xs text-muted-foreground">尚未確認送出結果，請重試或查看交易紀錄。</p> : null}
    <Button type="submit" disabled={busy || checking || !funds} aria-busy={busy || undefined} className="mt-4 w-full sm:w-auto sm:min-w-44">{busy ? '正在建立…' : checking ? '確認委託狀態…' : locked ? '重試相同委託' : '確認建立模擬單'}</Button>
  </form>;
}
