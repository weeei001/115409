import { useState, type FormEvent } from 'react';
import { ListChecks } from 'lucide-react';
import { Ledger, LedgerPanel } from '@/components/common/Ledger';
import { FoldSection } from '@/components/common/CollapsibleSection';
import { EmptyState, LoadingRows, Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/button';
import { inputClass, stackedFieldLabelClass } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { fetchSignalEvidence, type SignalEvidenceParams } from '@/lib/api/signals';
import { edgeText, firedText, historyText, MIN_SIGNAL_EVENTS } from '@/lib/signals/signalCheck';
import type { SignalEvidenceItem, SignalEvidenceResponse } from '@/lib/types/api';
import { toYmdLocal } from '@/lib/utils/date';
import { isTaiwanStockCode } from '@/lib/utils/stockValidation';
import { cn } from '@/lib/cn';
import { ReadingMark } from './ReadingMark';
import { useAdminRequest } from './useAdminRequest';

/** 一則證據：編號、訊號、成立時間，以及判斷日當天已知的全部股票與本檔統計 */
export function EvidenceRow({ item, horizon }: { item: SignalEvidenceItem; horizon: number }) {
  const thin = item.all_stocks.events < MIN_SIGNAL_EVENTS;
  return (
    <li className="space-y-1 py-3">
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{item.id}</span>
        <span className="font-semibold">{item.label}</span>
        <ReadingMark reading={item.reading} />
        <span className="text-xs text-muted-foreground">{firedText(item)}</span>
      </p>
      <p className="text-xs leading-5 text-muted-foreground">{item.definition}</p>
      <p className={cn('text-[13px] leading-relaxed', thin ? 'text-muted-foreground' : 'text-subtle')}>
        全部股票：{historyText(item.all_stocks, horizon)}
        {item.all_stocks.events ? `；${edgeText(item.edge_vs_baseline_pct ?? null)}` : ''}
        {item.all_stocks.events && thin ? `（不到 ${MIN_SIGNAL_EVENTS} 次，只能參考）` : ''}
      </p>
      <p className="text-[13px] leading-relaxed text-muted-foreground">這檔股票：{historyText(item.this_stock, horizon)}</p>
    </li>
  );
}

/**
 * 指定日期的證據清單：AI 在那一天做判斷時可以引用的訊號，統計只用當天收盤時已經走完觀察期的事件。
 * 換一個比較早的日期，次數會變少；這就是回測時沒有偷看未來的樣子。
 */
export function SignalEvidencePanel({ onAccessError }: { onAccessError: (error: unknown) => boolean }) {
  const [form, setForm] = useState<SignalEvidenceParams>({ symbol: '2330', as_of: toYmdLocal(), horizon: 5 });
  const { result, error, loading, run } = useAdminRequest<SignalEvidenceResponse>(onAccessError, '證據清單暫時無法產生，請稍後重試。');
  const [formError, setFormError] = useState<string | null>(null);

  const update = <K extends keyof SignalEvidenceParams>(key: K, value: SignalEvidenceParams[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setFormError(null);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!isTaiwanStockCode(form.symbol.trim())) return setFormError('請輸入 4 至 6 碼股票代號。');
    if (!form.as_of) return setFormError('請選擇判斷日。');
    run((signal) => fetchSignalEvidence(form, signal));
  };

  const stamp = result ? `${result.symbol} · 判斷日 ${result.decision_date}` : '觀察 5 日時，AI 回測用的是同一份統計';

  return (
    <Ledger title="指定日期的證據清單" stamp={stamp} cols="grid-cols-1">
      <LedgerPanel>
        <form onSubmit={submit} noValidate className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className={stackedFieldLabelClass}>
              股票代號
              <input className={cn(inputClass, 'font-mono tabular-nums')} value={form.symbol} onChange={(event) => update('symbol', event.target.value)} inputMode="numeric" maxLength={7} aria-describedby={formError ? 'evidence-form-error' : undefined} />
            </label>
            <label className={stackedFieldLabelClass}>判斷日<input type="date" className={cn(inputClass, 'font-mono tabular-nums')} value={form.as_of} onChange={(event) => update('as_of', event.target.value)} /></label>
            <label className={stackedFieldLabelClass}>
              觀察天數
              <NativeSelect value={form.horizon} onChange={(event) => update('horizon', Number(event.target.value) as 5 | 20)}>
                <option value={5}>成立後第 5 個交易日</option>
                <option value={20}>成立後第 20 個交易日</option>
              </NativeSelect>
            </label>
          </div>
          {formError ? <p id="evidence-form-error" role="alert" className="text-[13px] text-danger">{formError}</p> : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={loading}><ListChecks aria-hidden />{loading ? '產生中…' : '產生證據清單'}</Button>
            <p className="text-xs leading-5 text-muted-foreground">列出判斷日往前觀察天數內成立的訊號；統計只用判斷日收盤時已經知道結果的事件。</p>
          </div>
        </form>
      </LedgerPanel>
      {error ? <LedgerPanel><Notice tone="danger">{error}</Notice></LedgerPanel>
        : loading && !result ? <LedgerPanel padded={false}><LoadingRows label="整理當天可用的訊號證據中…" className="h-32" /></LedgerPanel>
        : !result ? <LedgerPanel><EmptyState className="py-4">選股票和判斷日，看那一天 AI 可以引用哪些訊號、當時知道多少。</EmptyState></LedgerPanel>
        : (
          <>
            <LedgerPanel aria-busy={loading || undefined}>
              {result.decision_date !== result.as_of ? (
                <p className="mb-2 text-[13px] text-muted-foreground">{result.as_of} 不是 {result.symbol} 的交易日，改用之前最近的交易日 {result.decision_date}。</p>
              ) : null}
              <p className="text-[13px] leading-relaxed text-subtle">對照：截至判斷日，全部股票任一天進場 {historyText(result.baseline, result.horizon)}。</p>
              {result.items.length ? (
                <ul className="mt-3 divide-y border-y">{result.items.map((item) => <EvidenceRow key={item.id} item={item} horizon={result.horizon} />)}</ul>
              ) : <EmptyState className="py-4">判斷日往前 {result.horizon} 個交易日內沒有訊號成立。</EmptyState>}
            </LedgerPanel>
            <FoldSection title="原始資料" summary="這份證據清單的完整內容（JSON）" contentClassName="px-4 py-3 sm:px-5">
              {/* 送給模型的版本在 backend/app/features/backtest/prompts.py 的 with_evidence */}
              <p className="mb-2 text-[13px] leading-relaxed text-subtle">
                AI 回測只收到觀察 5 日的版本，而且是匿名的：沒有股票代號、判斷日、成立日期（只說幾個交易日前成立）、訊號代碼與資料來源，也不含扣成本後報酬。
              </p>
              <pre className="max-h-96 overflow-auto border bg-muted p-3 font-mono text-xs leading-5 break-words whitespace-pre-wrap">
                {JSON.stringify({ decision_date: result.decision_date, horizon: result.horizon, baseline: result.baseline, signals: result.items }, null, 2)}
              </pre>
            </FoldSection>
            <FoldSection title="計算方式" summary="為什麼不會偷看未來" contentClassName="px-4 py-3 text-[13px] leading-relaxed text-subtle sm:px-5">
              <p>{result.method_note}</p>
            </FoldSection>
          </>
        )}
    </Ledger>
  );
}
