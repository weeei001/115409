import React, { useRef, useState } from 'react';
import { ApiRequestError } from '@/lib/api/client';
import { userFacingMessage } from '@/lib/api/errorDetail';
import { changePaperFunds, paperDateTime, paperMoney, type PaperFundMovement, type PaperPortfolio } from '@/lib/api/paperPortfolio';
import { paperButton, paperInput } from './PaperOrderDraft';

export function PaperFunds({ portfolio, onChanged }: { portfolio: PaperPortfolio; onChanged: (data: PaperPortfolio) => void }) {
  const [kind, setKind] = useState<PaperFundMovement['kind']>(portfolio.initialized ? 'deposit' : 'initial');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(false);
  const [success, setSuccess] = useState(false);
  const request = useRef<{ id: string; kind: PaperFundMovement['kind']; amount: number } | null>(null);
  const submitting = useRef(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current) return;
    setSuccess(false);
    const value = Number(amount);
    if (!retry && (!Number.isFinite(value) || value <= 0 || value > 1_000_000_000 || !/^\d+(\.\d{1,2})?$/.test(amount))) { setError('請輸入有效金額，最多 10 億元。'); return; }
    if (!retry && kind === 'withdrawal' && value > portfolio.available_cash) { setError('取回金額不能超過可用資金。'); return; }
    request.current ??= { id: crypto.randomUUID(), kind, amount: value };
    const pending = request.current;
    submitting.current = true; setBusy(true); setError(null); setSuccess(false);
    try {
      const data = await changePaperFunds(pending.kind, pending.amount, pending.id);
      request.current = null; setRetry(false); setAmount(''); setSuccess(true); onChanged(data);
    } catch (err) {
      setError(userFacingMessage(err, '尚未確認調整結果，請重試。'));
      const rejected = err instanceof ApiRequestError && err.status != null && err.status >= 400 && err.status < 500 && ![408, 409, 429].includes(err.status);
      if (rejected) request.current = null;
      setRetry(!rejected);
    } finally { submitting.current = false; setBusy(false); }
  };
  return <div>
    <form onSubmit={(event) => void submit(event)} aria-label={portfolio.initialized ? '調整模擬資金' : '設定模擬資金'}>
      {!portfolio.initialized ? <><h2 className="text-2xl font-bold">想用多少資金練習投資？</h2><p className="mt-3 text-sm leading-relaxed text-muted-foreground">填入你願意投入的預算。這是模擬資金，之後隨時可以調整。</p></> : <p className="text-sm text-muted-foreground">可用資金 {paperMoney(portfolio.available_cash)} 元</p>}
      <fieldset disabled={busy || retry} className="mt-4 space-y-4">
        <legend className="sr-only">資金設定</legend>
        {!portfolio.initialized ? <div className="flex flex-wrap gap-2">{[10000, 30000, 100000].map((value) => <button type="button" key={value} className={`${paperButton} ${Number(amount) === value ? 'border-brand text-brand-text' : ''}`} onClick={() => { setAmount(String(value)); setSuccess(false); setError(null); }}>{paperMoney(value)} 元</button>)}</div> : <label className="block text-sm">調整方式<select className={paperInput} value={kind} onChange={(e) => { setKind(e.target.value as 'deposit' | 'withdrawal'); setSuccess(false); setError(null); }}><option value="deposit">增加模擬資金</option><option value="withdrawal">取回模擬資金</option></select></label>}
        <label className="block text-sm">{portfolio.initialized ? '金額（元）' : '自訂金額（元）'}<input className={paperInput} type="number" inputMode="decimal" min="0.01" step="0.01" max="1000000000" required value={amount} onChange={(e) => { setAmount(e.target.value); setSuccess(false); setError(null); }} placeholder="輸入你的投資預算" /></label>
      </fieldset>
      {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
      {success ? <p role="status" className="mt-3 text-sm">資金已更新。</p> : null}
      <button type="submit" disabled={busy} className={`${paperButton} mt-4 bg-brand-gradient text-on-brand`}>{busy ? '儲存中…' : retry ? '重試這筆調整' : portfolio.initialized ? '確認調整' : '開始模擬投資'}</button>
    </form>
    {portfolio.initialized && portfolio.fund_movements.length ? <details className="mt-5 border-t pt-4"><summary className="cursor-pointer text-sm text-muted-foreground">資金紀錄</summary><ul className="mt-2 divide-y">{portfolio.fund_movements.map((movement) => <li className="flex flex-wrap justify-between gap-2 py-3 text-sm" key={movement.id}><span>{{ initial: '起始資金', deposit: '增加資金', withdrawal: '取回資金' }[movement.kind]} · {paperMoney(movement.amount)} 元</span><span className="text-xs text-muted-foreground">{paperDateTime(movement.created_at)}</span></li>)}</ul></details> : null}
  </div>;
}
