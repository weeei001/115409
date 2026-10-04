import React, { useId, useRef, useState } from 'react';
import { Expandable } from '@/components/common/CollapsibleSection';
import { Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/button';
import { ApiRequestError } from '@/lib/api/client';
import { userFacingMessage } from '@/lib/api/errorDetail';
import { changePaperFunds, paperDateTime, paperMoney, type PaperFundMovement, type PaperPortfolio } from '@/lib/api/paperPortfolio';
import { fieldLabelClass, inputClass } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { toggleVariants } from '@/components/ui/toggle';
import { cn } from '@/lib/cn';

const fieldInput = cn('mt-1.5', inputClass);

/** 方形切換鈕：按下用粗線＋淺底，不用燈色（與新聞篩選一致） */
const presetClass = cn(toggleVariants({ variant: 'square' }), 'min-w-0 font-mono tabular-nums');

const MOVEMENT_LABEL: Record<PaperFundMovement['kind'], string> = { initial: '起始資金', deposit: '增加資金', withdrawal: '取回資金' };

/** primary：這一頁的主要動作（尚未設定資金時）；設定後主要動作是「模擬買入」，這裡改用外框鈕 */
export function PaperFunds({ portfolio, onChanged }: { portfolio: PaperPortfolio; onChanged: (data: PaperPortfolio) => void }) {
  const scope = useId();
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
      {!portfolio.initialized
        ? <p className="text-sm leading-relaxed text-subtle">填入你願意投入的預算。這是模擬資金，之後隨時可以調整。</p>
        : <p className="text-[13px] text-muted-foreground">可用資金 <span className="font-mono tabular-nums text-foreground">{paperMoney(portfolio.available_cash)}</span> 元</p>}
      <fieldset disabled={busy || retry} className="mt-4 min-w-0 space-y-4">
        <legend className="sr-only">資金設定</legend>
        {!portfolio.initialized ? <div role="group" aria-labelledby={`${scope}-presets`}>
          <p id={`${scope}-presets`} className={fieldLabelClass}>常用金額</p>
          <div className="mt-1.5 grid grid-cols-3 gap-2">{[10000, 30000, 100000].map((value) => <button type="button" key={value} aria-pressed={Number(amount) === value} className={presetClass} onClick={() => { setAmount(String(value)); setSuccess(false); setError(null); }}>{paperMoney(value)}</button>)}</div>
        </div> : <label htmlFor={`${scope}-kind`} className={fieldLabelClass}>調整方式<NativeSelect wrapperClassName="mt-1.5" id={`${scope}-kind`} value={kind} onChange={(e) => { setKind(e.target.value as 'deposit' | 'withdrawal'); setSuccess(false); setError(null); }}><option value="deposit">增加模擬資金</option><option value="withdrawal">取回模擬資金</option></NativeSelect></label>}
        <label htmlFor={`${scope}-amount`} className={fieldLabelClass}>{portfolio.initialized ? '金額（元）' : '自訂金額（元）'}<input id={`${scope}-amount`} className={cn(fieldInput, 'font-mono tabular-nums')} type="number" inputMode="decimal" min="0.01" step="0.01" max="1000000000" required value={amount} onChange={(e) => { setAmount(e.target.value); setSuccess(false); setError(null); }} placeholder="輸入你的投資預算" /></label>
      </fieldset>
      {error ? <Notice tone="danger" className="mt-3">{error}</Notice> : null}
      {success ? <Notice tone="success" className="mt-3">資金已更新。</Notice> : null}
      <Button type="submit" variant={portfolio.initialized ? 'outline' : 'default'} disabled={busy} aria-busy={busy || undefined} className="mt-4 w-full sm:w-auto sm:min-w-44">{busy ? '儲存中…' : retry ? '重試這筆調整' : portfolio.initialized ? '確認調整' : '開始模擬投資'}</Button>
    </form>
    {portfolio.initialized && portfolio.fund_movements.length ? <Expandable className="mt-5" expandLabel={`資金紀錄（${portfolio.fund_movements.length} 筆）`} collapseLabel="收起資金紀錄">
      <ul className="divide-y border-b">{portfolio.fund_movements.map((movement) => <li className="flex min-h-11 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2.5 text-sm" key={movement.id}>
        <span>{MOVEMENT_LABEL[movement.kind]} <span className="font-mono tabular-nums">{movement.kind === 'withdrawal' ? '−' : '+'}{paperMoney(movement.amount)}</span> 元</span>
        <span className="characteristic">{paperDateTime(movement.created_at)}</span>
      </li>)}</ul>
    </Expandable> : null}
  </div>;
}
