import React, { useLayoutEffect, useRef, useState } from 'react';
import { Info, Loader2, Play, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  CASH_MAX,
  CASH_MIN,
  CONFIDENCE_MAX,
  CONFIDENCE_MIN,
  DEFAULT_FORM,
  DEMO_SYMBOL,
  formatCashInput,
  validateForm,
  type FormErrors,
  type SimulateFormValues,
} from '../params';
import type { SimulateParams } from '../types';
import { DemoCard } from './DemoCard';

const inputBase =
  'min-h-11 w-full min-w-0 rounded-lg border bg-muted px-3 py-2 font-mono text-base text-foreground outline-none transition-[border-color,box-shadow] focus:border-brand focus:ring-2 focus:ring-brand/25 disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm';
const inputClass = (invalid: boolean) => cn(inputBase, invalid ? 'border-danger' : 'border-input');
const labelClass = 'mb-1.5 block text-sm font-medium text-subtle';

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} className="mt-1.5 text-xs text-danger">
      {message}
    </p>
  ) : null;
}

interface Props {
  /** 沒有設定 API 網址時整個表單停用 */
  disabled: boolean;
  running: boolean;
  onStart: (params: SimulateParams) => void;
}

export function SimulateForm({ disabled, running, onStart }: Props) {
  const [values, setValues] = useState<SimulateFormValues>(DEFAULT_FORM);
  const [touched, setTouched] = useState<Partial<Record<keyof FormErrors, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const cashRef = useRef<HTMLInputElement>(null);
  /** 重新加千分位後，游標要回到同一個數字後面 */
  const cashCaretDigitsRef = useRef<number | null>(null);

  const validation = validateForm(values);
  const errors: FormErrors = validation.ok ? {} : validation.errors;
  const shown = (field: keyof FormErrors) => (submitted || touched[field] ? errors[field] : undefined);
  const locked = disabled || running;

  useLayoutEffect(() => {
    const input = cashRef.current;
    const digits = cashCaretDigitsRef.current;
    cashCaretDigitsRef.current = null;
    if (!input || digits === null || document.activeElement !== input) return;
    let pos = 0;
    for (let seen = 0; pos < input.value.length && seen < digits; pos++) {
      if (/\d/.test(input.value[pos])) seen++;
    }
    input.setSelectionRange(pos, pos);
  }, [values.cash]);

  const update = (field: keyof SimulateFormValues, value: string | number) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  const handleCashChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const caret = e.target.selectionStart ?? e.target.value.length;
    cashCaretDigitsRef.current = e.target.value.slice(0, caret).replace(/\D/g, '').length;
    update('cash', formatCashInput(e.target.value));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (locked) return;
    setSubmitted(true);
    if (validation.ok) onStart(validation.params);
  };

  return (
    <DemoCard title="模擬參數" icon={SlidersHorizontal} description="AI 依風險偏好逐日決定買進或賣出，後端回測後以串流逐日回傳結果。">
      <form onSubmit={handleSubmit} noValidate aria-busy={running}>
        <fieldset disabled={locked} className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <legend className="sr-only">模擬參數</legend>
          <div className="min-w-0">
            <label htmlFor="ai-demo-symbol" className={labelClass}>
              股票代號
            </label>
            <input
              id="ai-demo-symbol"
              value={DEMO_SYMBOL}
              readOnly
              aria-describedby="ai-demo-symbol-hint"
              className={cn(inputClass(false), 'cursor-default text-subtle')}
            />
            <p id="ai-demo-symbol-hint" className="mt-1.5 text-xs text-muted-foreground">
              目前僅開放 2330
            </p>
          </div>

          <div className="min-w-0">
            <label htmlFor="ai-demo-start" className={labelClass}>
              起始日
            </label>
            <input
              id="ai-demo-start"
              type="date"
              value={values.start}
              max={values.end || undefined}
              onChange={(e) => update('start', e.target.value)}
              aria-invalid={!!shown('start')}
              aria-describedby={shown('start') ? 'ai-demo-start-error' : undefined}
              className={inputClass(!!shown('start'))}
            />
            <FieldError id="ai-demo-start-error" message={shown('start')} />
          </div>

          <div className="min-w-0">
            <label htmlFor="ai-demo-end" className={labelClass}>
              結束日
            </label>
            <input
              id="ai-demo-end"
              type="date"
              value={values.end}
              min={values.start || undefined}
              onChange={(e) => update('end', e.target.value)}
              aria-invalid={!!shown('end')}
              aria-describedby={shown('end') ? 'ai-demo-end-error' : undefined}
              className={inputClass(!!shown('end'))}
            />
            <FieldError id="ai-demo-end-error" message={shown('end')} />
          </div>

          <div className="min-w-0">
            <label htmlFor="ai-demo-cash" className={labelClass}>
              初始資金（元）
            </label>
            <input
              ref={cashRef}
              id="ai-demo-cash"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={values.cash}
              onChange={handleCashChange}
              aria-invalid={!!shown('cash')}
              aria-describedby={shown('cash') ? 'ai-demo-cash-error' : 'ai-demo-cash-hint'}
              className={inputClass(!!shown('cash'))}
            />
            {shown('cash') ? (
              <FieldError id="ai-demo-cash-error" message={shown('cash')} />
            ) : (
              <p id="ai-demo-cash-hint" className="mt-1.5 text-xs text-muted-foreground">
                {CASH_MIN.toLocaleString('en-US')}～{CASH_MAX.toLocaleString('en-US')} 元
              </p>
            )}
          </div>

          <div className="min-w-0 sm:col-span-2">
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <label htmlFor="ai-demo-confidence" className="text-sm font-medium text-subtle">
                風險偏好
              </label>
              <span className="font-mono text-sm font-semibold tabular-nums">{values.confidence}</span>
            </div>
            <input
              id="ai-demo-confidence"
              type="range"
              min={CONFIDENCE_MIN}
              max={CONFIDENCE_MAX}
              step={1}
              value={values.confidence}
              onChange={(e) => update('confidence', Number(e.target.value))}
              aria-valuetext={`${values.confidence}（1 保守～10 激進）`}
              className="h-11 w-full cursor-pointer accent-brand disabled:cursor-not-allowed"
            />
            <div className="flex justify-between text-xs text-muted-foreground" aria-hidden>
              <span>1 保守</span>
              <span>10 激進</span>
            </div>
            <FieldError id="ai-demo-confidence-error" message={shown('confidence')} />
          </div>
        </fieldset>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex min-w-0 items-start gap-1.5 text-xs leading-5 text-muted-foreground">
            <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
            沒命中快取時，每個交易日都要跑一次模型，區間越長等越久；五個參數完全相同時會重放上次的結果。
          </p>
          <button
            type="submit"
            disabled={locked}
            className="flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-brand-gradient px-6 py-2.5 text-sm font-semibold text-on-brand shadow-card transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Play size={16} aria-hidden />}
            {running ? '模擬中…' : '開始模擬'}
          </button>
        </div>
      </form>
    </DemoCard>
  );
}
