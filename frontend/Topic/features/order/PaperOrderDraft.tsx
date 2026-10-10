import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Expandable } from '@/components/common/CollapsibleSection';
import { Notice } from '@/components/common/Notice';
import { LedgerPanel, panelClass } from '@/components/common/Ledger';
import { Button, textLinkClass } from '@/components/ui/button';
import { fieldLabelClass, inputClass } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { cn } from '@/lib/cn';
import { createPaperOrder, estimatePaperBuy, estimatePaperSell, fetchPaperPortfolio, paperMoney, paperStatus, type PaperDraft, type PaperOrder, type PaperPortfolio } from '@/lib/api/paperPortfolio';
import { userFacingMessage } from '@/lib/api/errorDetail';
import { ApiRequestError } from '@/lib/api/client';
import { fetchLatestPrice } from '@/lib/api/stock';
import { useAuthAccount } from '@/lib/auth/account';
import { StockSearch } from '@/components/common/StockSearch';
import { useStockInfos } from '@/lib/hooks/useStockInfos';
import { parseBulkSymbolInput } from '@/lib/utils/stockSelection';

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

/** 最近收盤（參考價）；拿不到就是 null，估算改寫「無法取得參考價」 */
type Reference = { status: 'idle' | 'loading' | 'ready' | 'error'; close: number | null; date: string | null };

/** 下單前的估算文字（P1-30、04-O1）：依最近收盤估算股數與費用，買不到一股時直接說 */
export function paperEstimateText(side: 'buy' | 'sell', amount: number, reference: { close: number | null; date: string | null }): { text: string; tone: 'info' | 'warning' } | null {
  if (!(amount > 0) || reference.close == null) return null;
  const ref = `以最近收盤 ${paperMoney(reference.close)} 元（${reference.date}）估算`;
  if (side === 'buy') {
    const buy = estimatePaperBuy(amount, reference.close);
    if (!buy) return null;
    if (buy.quantity === 0) return { text: `${ref}，這個金額買不到 1 股；成交時若仍不足 1 股，這筆委託會自動取消。`, tone: 'warning' };
    return { text: `${ref}：約 ${buy.quantity.toLocaleString()} 股，手續費約 ${paperMoney(buy.fee)} 元。實際依下一交易日收盤價成交。`, tone: 'info' };
  }
  const sell = estimatePaperSell(amount, reference.close);
  if (!sell) return null;
  return { text: `${ref}：約可拿回 ${paperMoney(sell.proceeds)} 元（手續費約 ${paperMoney(sell.fee)} 元、證券交易稅約 ${paperMoney(sell.tax)} 元）。實際依下一交易日收盤價成交。`, tone: 'info' };
}

export function PaperOrderDraft({ initial, requestId, onCreated, currentPortfolio, embedded = false, chatMode = false }: {
  initial?: Partial<PaperDraft>;
  currentPortfolio?: PaperPortfolio;
  requestId?: string;
  onCreated?: (order: PaperOrder) => void;
  /** 模擬投資頁：外層帳頁已有標題與外框 */
  embedded?: boolean;
  /** Ask before opening the editable draft inside an AI reply. */
  chatMode?: boolean;
}) {
  const scope = useId();
  const account = useAuthAccount();
  const [accepted, setAccepted] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [order, setOrder] = useState<PaperOrder | null>(null);
  const formActive = (!chatMode || accepted) && !order;
  const refreshOnFocusRef = useRef(formActive);
  refreshOnFocusRef.current = formActive || order?.status === 'pending';
  // 股票用搜尋選（顯示名稱），不再是純文字欄（P1-30）
  const { data: stockInfos } = useStockInfos({ enabled: Boolean(account) && formActive });
  const stockList = useMemo(() => stockInfos ?? [], [stockInfos]);
  const [reference, setReference] = useState<Reference>({ status: 'idle', close: null, date: null });
  /** 送出前的確認摘要（P1-30）：按「送出委託」先看摘要，再按「確認送出」才真的送 */
  const [confirming, setConfirming] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [symbol, setSymbol] = useState(initial?.symbol ?? '');
  const [side, setSide] = useState<'buy' | 'sell'>(initial?.side ?? 'buy');
  const [amount, setAmount] = useState(String(initial?.side === 'sell' ? initial.quantity ?? '' : initial?.budget ?? ''));
  const [reason, setReason] = useState(initial?.reason ?? '');
  const [observation, setObservation] = useState(initial?.observation ?? '');
  const days = String(initial?.review_after_days ?? 20);
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
    setConfirming(false);
    setAccepted(false);
    setDeclined(false);
    submitting.current = false;
  }, [account, requestId]);

  // 開啟對話草稿前先查詢已送出的委託；表單專用資料等使用者接受後才讀取。
  const needsPortfolio = !chatMode || Boolean(requestId) || accepted;
  useEffect(() => {
    if (!account) { setChecking(false); return; }
    if (currentPortfolio) {
      const match = requestId ? currentPortfolio.orders.find((item) => item.client_request_id === requestId) : undefined;
      if (match) setOrder(match);
      setChecking(false);
      return;
    }
    if (!needsPortfolio) { setChecking(false); return; }
    const ctrl = new AbortController();
    setChecking(true);
    const refresh = () => {
      void fetchPaperPortfolio(ctrl.signal).then((portfolio) => {
        if (ctrl.signal.aborted) return;
        setPortfolio(portfolio);
        const match = requestId ? portfolio.orders.find((item) => item.client_request_id === requestId) : undefined;
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
    const onFocus = () => { if (refreshOnFocusRef.current) refresh(); };
    window.addEventListener('focus', onFocus);
    return () => { ctrl.abort(); window.removeEventListener('focus', onFocus); };
  }, [account, requestId, currentPortfolio, needsPortfolio]);

  const funds = currentPortfolio ?? portfolio;
  const code = symbol.trim().toUpperCase();
  const availableShares = funds?.positions.find((position) => position.symbol === code);
  const sellable = availableShares ? availableShares.quantity - availableShares.reserved_quantity : 0;
  const stockName = stockList.find((stock) => stock.symbol === code)?.name ?? '';
  const stockLabel = stockName ? `${code} ${stockName}` : code;

  // 參考價：選定股票後讀最近收盤
  useEffect(() => {
    if (!account || !formActive || !/^[0-9A-Z]{1,10}$/.test(code)) { setReference({ status: 'idle', close: null, date: null }); return; }
    const ctrl = new AbortController();
    setReference({ status: 'loading', close: null, date: null });
    fetchLatestPrice(code, { signal: ctrl.signal }).then((row) => {
      if (ctrl.signal.aborted) return;
      const close = row.close == null ? null : Number(row.close);
      setReference(close != null && Number.isFinite(close) && close > 0 ? { status: 'ready', close, date: row.date } : { status: 'error', close: null, date: null });
    }).catch(() => { if (!ctrl.signal.aborted) setReference({ status: 'error', close: null, date: null }); });
    return () => ctrl.abort();
  }, [account, code, formActive]);
  const estimate = paperEstimateText(side, Number(amount), reference);

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
    else if (chatMode && accepted && !checking && !order) amountRef.current?.focus();
  }, [confirming, chatMode, accepted, checking, order]);

  /** 欄位檢查；回傳錯誤訊息，沒問題回 null */
  const validate = (): string | null => {
    if (!/^[0-9A-Z]{1,10}$/.test(code) || !Number.isFinite(Number(amount)) || Number(amount) <= 0
      || (side === 'sell' && !Number.isSafeInteger(Number(amount))) || !Number.isInteger(Number(days)) || Number(days) < 1 || Number(days) > 250) {
      // 回顧天數不是畫面上的欄位，錯誤訊息不提它（P2-118）
      return '請選擇股票，並填入有效的金額或整數股數。';
    }
    if (!locked && funds && side === 'buy' && Number(amount) > funds.available_cash) return '可用資金不足，請降低買進金額。';
    if (!locked && side === 'sell' && Number(amount) > sellable) return '賣出股數不能超過可賣股數。';
    return null;
  };

  /** 「送出委託」：先檢查欄位、顯示確認摘要；重試同一筆委託時直接送 */
  const review = (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current || !account || checking || order || !funds?.initialized) return;
    const problem = validate();
    if (problem) { setError(problem); return; }
    setError(null);
    if (locked) { void submit(); return; }
    setConfirming(true);
  };

  const submit = async () => {
    if (submitting.current || !account || checking || order || !funds?.initialized) return;
    const problem = validate();
    if (problem) { setError(problem); setConfirming(false); return; }
    if (!idRef.current) idRef.current = crypto.randomUUID();
    submitting.current = true;
    setBusy(true); setLocked(true); setError(null);
    const owner = account;
    try {
      const created = await createPaperOrder({ symbol: code, side,
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
    } finally { if (accountRef.current === owner) { submitting.current = false; setBusy(false); setConfirming(false); } }
  };

  const frame = cn(!embedded && ['border', panelClass]);
  // 連結文字說清楚目的地：登入後會到模擬投資頁，不是回到目前這一頁（P2-128）
  if (!account) return <p className={cn(frame, 'text-sm leading-relaxed')}><Link className={paperLink} href={{ pathname: '/login', query: { returnUrl: '/order' } }}>登入後前往模擬投資</Link>，用模擬帳戶的虛擬資金下單。</p>;
  if (order) return <PaperOrderStatus order={order} embedded={embedded} />;
  if (chatMode && !accepted) return <section className={frame} aria-labelledby={`${scope}-offer`}>
    <h3 id={`${scope}-offer`} className="text-sm font-medium">要為 {stockLabel} 建立模擬單嗎？</h3>
    {declined ? <p className="mt-2 text-sm text-muted-foreground" role="status">這次先不建立模擬單。</p>
      : <p className="mt-2 text-sm leading-relaxed text-muted-foreground">可直接在對話中選擇買賣、填寫金額或股數，查看委託內容後再確認送出。</p>}
    <div className="mt-3 flex flex-wrap gap-2">
      <Button type="button" variant={declined ? 'outline' : 'default'} onClick={() => { setAccepted(true); setDeclined(false); }}>{declined ? '重新開啟模擬單' : '建立模擬單'}</Button>
      {declined ? null : <Button type="button" variant="outline" onClick={() => setDeclined(true)}>暫時不用</Button>}
    </div>
  </section>;
  if (funds && !funds.initialized) return <div className={cn(frame, 'text-sm leading-relaxed')}><p>先設定想投入的模擬資金，再回來確認這筆委託。</p><Button asChild variant="outline" className="mt-3"><Link href="/order">設定模擬資金</Link></Button></div>;
  const amountText = side === 'buy' ? `${paperMoney(Number(amount))} 元` : `${Number(amount).toLocaleString()} 股`;
  return <form onSubmit={review} className={frame} aria-label="模擬下單" aria-busy={busy || checking}>
    {embedded ? null : <h3 className="text-[13px] font-medium tracking-[0.04em] text-muted-foreground">模擬下單</h3>}
    <p className={cn('text-[13px] leading-relaxed text-muted-foreground', !embedded && 'mt-1')}>預計於下一交易日收盤成交，實際股數依成交價格計算。{side === 'buy' ? `買進成交後第 ${days} 個交易日會出現在「投資回顧」。` : ''}</p>
    <fieldset disabled={busy || checking || locked || confirming} className="mt-4 min-w-0 space-y-4">
      <legend className="sr-only">委託內容</legend>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className={fieldLabelClass}>
          <span id={`${scope}-symbol-label`}>股票</span>
          {code ? (
            <div className="mt-1.5 flex min-h-11 items-center justify-between gap-2 rounded-md border border-input bg-card pr-1 pl-3" aria-labelledby={`${scope}-symbol-label`}>
              <span className="min-w-0 truncate text-sm"><span className="font-mono tabular-nums">{code}</span>{stockName ? ` ${stockName}` : ''}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => { setSymbol(''); setConfirming(false); }} aria-label={`更換股票（目前 ${stockLabel}）`}>更換</Button>
            </div>
          ) : (
            <StockSearch
              className="mt-1.5"
              symbols={stockList.map((stock) => stock.symbol)}
              stockInfos={stockList}
              onSelect={(picked) => setSymbol(picked)}
              onBulkSelect={(input) => { const first = parseBulkSymbolInput(input).find((item) => stockList.some((stock) => stock.symbol === item)); if (first) setSymbol(first); }}
              placeholder="搜尋代號或公司名稱"
            />
          )}
        </div>
        <label htmlFor={`${scope}-side`} className={fieldLabelClass}>操作<NativeSelect wrapperClassName="mt-1.5" id={`${scope}-side`} value={side} onChange={(e) => { setSide(e.target.value as 'buy' | 'sell'); setAmount(''); }}><option value="buy">買進</option><option value="sell">賣出</option></NativeSelect></label>
        <label htmlFor={`${scope}-amount`} className={fieldLabelClass}>{side === 'buy' ? '買進金額（元）' : '賣出股數（股）'}<input ref={amountRef} id={`${scope}-amount`} className={cn(fieldInput, 'font-mono tabular-nums')} type="number" min={side === 'buy' ? 0.01 : 1} max={1000000000} step={side === 'buy' ? '0.01' : '1'} required value={amount} onChange={(e) => setAmount(e.target.value)} aria-describedby={`${scope}-estimate`} /></label>
      </div>
      <p id={`${scope}-estimate`} className={cn('text-[13px] leading-relaxed', estimate?.tone === 'warning' ? 'text-warning' : 'text-muted-foreground')} aria-live="polite">
        {!code ? '先選擇股票，會顯示最近收盤與估算股數。'
          : reference.status === 'loading' ? '載入最近收盤…'
            : reference.status === 'error' ? '無法取得最近收盤，送出後仍以下一交易日收盤價成交。'
              : estimate?.text ?? (reference.close != null ? `最近收盤 ${paperMoney(reference.close)} 元（${reference.date}）。` : '')}
      </p>
      <Expandable expandLabel="記下投資想法（選填）" collapseLabel="收起投資想法" defaultOpen={Boolean(initial?.reason || initial?.observation)} contentClassName="grid gap-4 pt-4">
        <label htmlFor={`${scope}-reason`} className={fieldLabelClass}>我的理由（選填）<textarea id={`${scope}-reason`} className={cn(fieldInput, 'h-auto min-h-[4.5rem] py-2 leading-relaxed')} rows={2} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="當初為什麼做這個決定？" /></label>
        <label htmlFor={`${scope}-observation`} className={fieldLabelClass}>觀察重點（選填）<textarea id={`${scope}-observation`} className={cn(fieldInput, 'h-auto min-h-[4.5rem] py-2 leading-relaxed')} rows={2} maxLength={2000} value={observation} onChange={(e) => setObservation(e.target.value)} placeholder="哪些變化會支持或推翻你的想法？" /></label>
      </Expandable>
    </fieldset>
    {funds && side === 'sell' ? <p className="mt-3 text-[13px] text-muted-foreground">可賣股數 <span className="font-mono tabular-nums text-foreground">{sellable.toLocaleString()}</span> 股</p> : null}
    {funds && side === 'buy' ? <p className="mt-3 text-[13px] text-muted-foreground">可用資金 <span className="font-mono tabular-nums text-foreground">{paperMoney(funds.available_cash)}</span> 元{Number(amount) > 0 && Number(amount) <= funds.available_cash ? <> · 預計剩餘至少 <span className="font-mono tabular-nums text-foreground">{paperMoney(funds.available_cash - Number(amount))}</span> 元</> : null}</p> : null}
    {error ? <Notice tone="danger" className="mt-3">{error}</Notice> : null}
    {locked && !busy ? <p className="mt-2 text-xs text-muted-foreground">尚未確認送出結果，請重試或查看交易紀錄。</p> : null}
    {confirming ? (
      <section aria-label="確認委託內容" className="mt-4 border border-border-strong bg-card p-4">
        <h4 className="text-[13px] font-medium tracking-[0.04em] text-muted-foreground">確認委託內容</h4>
        <dl className="mt-2 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[7rem_minmax(0,1fr)]">
          <dt className="text-muted-foreground">股票</dt><dd>{stockLabel}</dd>
          <dt className="text-muted-foreground">操作</dt><dd>{side === 'buy' ? '買進' : '賣出'} <span className="font-mono tabular-nums">{amountText}</span></dd>
          <dt className="text-muted-foreground">預估</dt><dd className="text-subtle">{estimate?.text ?? '無法取得最近收盤，無法估算。'}</dd>
          <dt className="text-muted-foreground">成交規則</dt><dd className="text-subtle">送出後下一個交易日的收盤價成交</dd>
          {side === 'buy' ? <><dt className="text-muted-foreground">回顧</dt><dd className="text-subtle">買進成交後第 {days} 個交易日</dd></> : null}
          {reason.trim() ? <><dt className="text-muted-foreground">我的理由</dt><dd className="whitespace-pre-wrap text-subtle">{reason.trim()}</dd></> : null}
          {observation.trim() ? <><dt className="text-muted-foreground">觀察重點</dt><dd className="whitespace-pre-wrap text-subtle">{observation.trim()}</dd></> : null}
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button ref={confirmRef} type="button" onClick={() => void submit()} disabled={busy} aria-busy={busy || undefined} className="sm:min-w-32">{busy ? '送出中…' : '確認送出'}</Button>
          <Button type="button" variant="outline" onClick={() => setConfirming(false)} disabled={busy}>返回修改</Button>
        </div>
      </section>
    ) : (
      <Button type="submit" disabled={busy || checking || !funds} aria-busy={busy || undefined} className="mt-4 w-full sm:w-auto sm:min-w-44">{busy ? '送出中…' : checking ? '確認委託狀態…' : locked ? '重試相同委託' : '送出委託'}</Button>
    )}
    {chatMode && !confirming && !locked ? <Button type="button" variant="outline" disabled={busy} className="mt-4 sm:ml-2" onClick={() => { setAccepted(false); setDeclined(true); }}>暫時不用</Button> : null}
  </form>;
}
