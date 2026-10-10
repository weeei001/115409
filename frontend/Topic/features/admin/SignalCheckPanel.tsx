import { useState, type FormEvent } from 'react';
import { Play } from 'lucide-react';
import { cellClass, headCellClass, Ledger, LedgerPanel } from '@/components/common/Ledger';
import { FoldSection } from '@/components/common/CollapsibleSection';
import { EmptyState, LoadingRows, Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/button';
import { inputClass, stackedFieldLabelClass } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { fetchSignalCheck, type SignalCheckParams } from '@/lib/api/signals';
import { dayBefore, edgeText, edgeVsBaseline, MIN_SIGNAL_EVENTS, signalVerdict, VERDICT_LABEL } from '@/lib/signals/signalCheck';
import type { SignalCheckResponse, SignalPeriodStats, SignalReading, SignalStats } from '@/lib/types/api';
import { toYmdLocal } from '@/lib/utils/date';
import { rateText, signedText } from '@/lib/utils/format';
import { isTaiwanStockCode } from '@/lib/utils/stockValidation';
import { valueToneText } from '@/lib/utils/tone';
import { cn } from '@/lib/cn';
import { ReadingMark } from './ReadingMark';
import { useAdminRequest } from './useAdminRequest';

const dateClass = cn(inputClass, 'font-mono tabular-nums');

/** 一期的讀數：平均漲跌（上色）、和任一天進場的差距、上漲與贏大盤比例、次數 */
function PeriodCell({ stats, baseline, reading }: { stats: SignalPeriodStats; baseline: SignalPeriodStats; reading: SignalReading | null }) {
  if (!stats.events) return <p className="text-sm text-muted-foreground">沒有事件</p>;
  const thin = stats.events < MIN_SIGNAL_EVENTS;
  return (
    <div className={cn('space-y-0.5 text-[13px] leading-relaxed', thin && 'text-muted-foreground')}>
      <p>
        平均 <span className={cn('font-mono font-semibold tabular-nums', !thin && valueToneText(stats.avg_return_pct ?? 0))}>{signedText(stats.avg_return_pct, 2, '%')}</span>
        {reading ? <span className="ml-2 text-subtle">{edgeText(edgeVsBaseline(stats, baseline))}</span> : null}
      </p>
      <p className="text-subtle">
        上漲 {rateText(stats.up_rate)} · 贏大盤 {rateText(stats.beat_market_rate)}
        {stats.net_return_pct != null ? ` · 扣成本 ${signedText(stats.net_return_pct, 2, '%')}` : ''}
      </p>
      <p className="font-mono text-xs tabular-nums text-muted-foreground">{stats.events} 次{thin ? `（不到 ${MIN_SIGNAL_EVENTS} 次）` : ''}</p>
    </div>
  );
}

export function SignalTable({ result }: { result: SignalCheckResponse }) {
  const baseline = result.baseline;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <caption className="sr-only">各訊號在挑選期與驗證期成立後第 {result.horizon} 個交易日的漲跌，和任一天進場比較</caption>
        <thead className="border-b border-border-strong bg-muted">
          <tr>
            <th scope="col" className={headCellClass}>訊號</th>
            <th scope="col" className={headCellClass}>挑選期 {result.start} ~ {dayBefore(result.split)}</th>
            <th scope="col" className={headCellClass}>驗證期 {result.split} ~ {result.end}</th>
            <th scope="col" className={headCellClass}>判讀</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b bg-muted/40">
            <th scope="row" className={cn(cellClass, 'font-normal')}>
              <p className="font-semibold">{baseline.label}</p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{baseline.definition}</p>
            </th>
            <td className={cellClass}><PeriodCell stats={baseline.discovery} baseline={baseline.discovery} reading={null} /></td>
            <td className={cellClass}><PeriodCell stats={baseline.validation} baseline={baseline.validation} reading={null} /></td>
            <td className={cn(cellClass, 'text-[13px] text-muted-foreground')}>對照組</td>
          </tr>
          {result.signals.map((signal: SignalStats) => {
            const verdict = signalVerdict(signal, baseline);
            return (
              <tr key={signal.key} className="border-b last:border-b-0">
                <th scope="row" className={cn(cellClass, 'font-normal')}>
                  <p className="font-semibold">{signal.label}</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{signal.definition}</p>
                  <p className="mt-1 flex flex-wrap gap-x-2"><ReadingMark reading={signal.reading} /><span className="text-xs text-muted-foreground">{signal.source}</span></p>
                </th>
                <td className={cellClass}><PeriodCell stats={signal.discovery} baseline={baseline.discovery} reading={signal.reading} /></td>
                <td className={cellClass}><PeriodCell stats={signal.validation} baseline={baseline.validation} reading={signal.reading} /></td>
                <td className={cn(cellClass, 'text-[13px] leading-relaxed', verdict === 'thin' && 'text-muted-foreground')}>
                  {VERDICT_LABEL[verdict]}
                  {signal.pending ? <span className="mt-0.5 block text-xs text-muted-foreground">另有 {signal.pending} 次未到期</span> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 訊號檢驗：標準技術、籌碼與營收訊號成立後的實際漲跌，分成挑選期與驗證期，對照「任一天進場」與加權指數。
 * 只用已存的行情資料，不呼叫 AI；判讀規則寫在畫面上，不另外產生分數。
 */
export function SignalCheckPanel({ onAccessError }: { onAccessError: (error: unknown) => boolean }) {
  const [form, setForm] = useState<SignalCheckParams>({ symbol: '', start: '2021-01-01', split: '2025-01-01', end: toYmdLocal(), horizon: 5 });
  const { result, error, loading, run } = useAdminRequest<SignalCheckResponse>(onAccessError, '訊號檢驗暫時無法完成，請稍後重試。');
  const [formError, setFormError] = useState<string | null>(null);

  const update = <K extends keyof SignalCheckParams>(key: K, value: SignalCheckParams[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setFormError(null);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const symbol = form.symbol.trim();
    if (symbol && !isTaiwanStockCode(symbol)) return setFormError('股票代號是 4 至 6 碼；留空代表股票清單裡的全部股票。');
    if (!(form.start < form.split && form.split <= form.end)) return setFormError('日期要依序：挑選期起日早於驗證期起日，驗證期起日不晚於迄日。');
    run((signal) => fetchSignalCheck({ ...form, symbol }, signal));
  };

  const stamp = result
    ? `${result.symbol ?? '全部股票'} · ${result.stock_count} 檔 · 資料到 ${result.latest_date ?? '--'}`
    : '只用已存行情，不呼叫 AI';

  return (
    <div className="space-y-10">
      <Ledger title="訊號檢驗" stamp={stamp} cols="grid-cols-1">
        <LedgerPanel>
          <form onSubmit={submit} noValidate className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <label className={stackedFieldLabelClass}>
                股票代號
                <input className={cn(inputClass, 'font-mono tabular-nums')} value={form.symbol} onChange={(event) => update('symbol', event.target.value)} placeholder="留空＝全部股票" inputMode="numeric" maxLength={7} aria-describedby={formError ? 'signal-form-error' : undefined} />
              </label>
              <label className={stackedFieldLabelClass}>挑選期起日<input type="date" className={dateClass} value={form.start} onChange={(event) => update('start', event.target.value)} /></label>
              <label className={stackedFieldLabelClass}>驗證期起日<input type="date" className={dateClass} value={form.split} onChange={(event) => update('split', event.target.value)} /></label>
              <label className={stackedFieldLabelClass}>驗證期迄日<input type="date" className={dateClass} value={form.end} onChange={(event) => update('end', event.target.value)} /></label>
              <label className={stackedFieldLabelClass}>
                觀察天數
                <NativeSelect value={form.horizon} onChange={(event) => update('horizon', Number(event.target.value) as 5 | 20)}>
                  <option value={5}>成立後第 5 個交易日</option>
                  <option value={20}>成立後第 20 個交易日</option>
                </NativeSelect>
              </label>
            </div>
            {formError ? <p id="signal-form-error" role="alert" className="text-[13px] text-danger">{formError}</p> : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={loading}><Play aria-hidden />{loading ? '檢驗中…' : '開始檢驗'}</Button>
              <p className="text-xs leading-5 text-muted-foreground">挑選期用來找訊號，驗證期用來確認；只在挑選期好看的訊號多半是運氣。全部股票約需數秒。</p>
            </div>
          </form>
        </LedgerPanel>
        {error ? <LedgerPanel><Notice tone="danger">{error}</Notice></LedgerPanel>
          : loading && !result ? <LedgerPanel padded={false}><LoadingRows label="計算各訊號的事後表現中…" className="h-40" /></LedgerPanel>
          : !result ? <LedgerPanel><EmptyState className="py-4">選好期間後按「開始檢驗」，會列出每個訊號成立後的實際漲跌。</EmptyState></LedgerPanel>
          : (
            <>
              <LedgerPanel padded={false} aria-busy={loading || undefined}>
                <SignalTable result={result} />
              </LedgerPanel>
              {result.symbol ? (
                <LedgerPanel title={`${result.symbol} 最近 10 個交易日成立的訊號`}>
                  {result.recent?.length ? (
                    <ul className="divide-y border-y text-sm">
                      {result.recent.map((item) => (
                        <li key={`${item.date}-${item.key}`} className="flex flex-wrap items-baseline gap-x-3 py-2.5">
                          <span className="font-mono text-xs tabular-nums text-muted-foreground">{item.date}</span>
                          <span className="font-medium">{item.label}</span>
                          <ReadingMark reading={item.reading} />
                        </li>
                      ))}
                    </ul>
                  ) : <EmptyState className="py-4">最近 10 個交易日沒有訊號成立。</EmptyState>}
                </LedgerPanel>
              ) : null}
              <FoldSection title="計算方式" summary="怎麼算事件、為什麼要和任一天進場比" contentClassName="px-4 py-3 text-[13px] leading-relaxed text-subtle sm:px-5">
                <p>{result.method_note}</p>
                <p className="mt-2">
                  判讀只看兩段各自和任一天進場的平均差距正負，任一段不到 {MIN_SIGNAL_EVENTS} 次就不判讀；不是統計檢定，也不是分數。
                  一次買賣的成本以 {result.round_trip_cost_pct}% 計。
                </p>
              </FoldSection>
            </>
          )}
      </Ledger>
    </div>
  );
}
