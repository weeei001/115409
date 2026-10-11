import { useMemo, useState, type FormEvent } from 'react';
import { History, Play, Square } from 'lucide-react';
import { EChart } from '@/components/charts/EChart';
import { cellClass, figureClass, headCellClass, Ledger, LedgerPanel } from '@/components/common/Ledger';
import { FoldSection } from '@/components/common/CollapsibleSection';
import { EmptyState, LoadingRows, Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/button';
import { inputClass, stackedFieldLabelClass } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { fetchAIBacktestResult, streamAIBacktest, type AIBacktestParams } from '@/lib/api/backtest';
import {
  baselineReturns, GROUP_ORDER, PRESET_RULES, presetText, returnGapText, STANCE_LABEL, STANCES, tradeText,
} from '@/lib/backtest/aiBacktest';
import { aiBacktestOption, BACKTEST_GROUP_COLORS } from '@/lib/charts/adapters';
import { useTheme } from '@/lib/theme/ThemeContext';
import type { AIBacktestResult, BacktestGroupResult, BacktestPreset } from '@/lib/types/api';
import { shiftYmdMonths, toYmdLocal } from '@/lib/utils/date';
import { rateText, signedText } from '@/lib/utils/format';
import { isTaiwanStockCode } from '@/lib/utils/stockValidation';
import { valueToneText } from '@/lib/utils/tone';
import { cn } from '@/lib/cn';
import { useAdminRequest } from './useAdminRequest';

function GroupPanel({ group, result, className }: { group: BacktestGroupResult; result: AIBacktestResult; className?: string }) {
  const { buyAndHold, market } = baselineReturns(result);
  return (
    <LedgerPanel className={className} title={<span className="inline-flex items-center gap-2"><span aria-hidden className="inline-block h-0.5 w-3.5" style={{ background: BACKTEST_GROUP_COLORS[group.key] }} />{group.label}</span>}>
      <p className={cn(figureClass, valueToneText(group.total_return_pct))}>{signedText(group.total_return_pct, 2, '%')}</p>
      <p className="mt-1 text-[13px] text-muted-foreground">扣成本後總報酬</p>
      <ul className="mt-3 space-y-0.5 text-[13px] leading-relaxed text-subtle">
        <li>{returnGapText(group.total_return_pct, buyAndHold, '買進持有')}</li>
        <li>{returnGapText(group.total_return_pct, market, '加權指數')}</li>
        <li>最大回撤 {group.max_drawdown_pct.toFixed(2)}% · 平均持股 {rateText(group.avg_exposure)}</li>
        <li>成交 {group.trades} 次 · 成本 {Math.round(group.costs_paid).toLocaleString('zh-TW')} 元</li>
        <li>方向判斷 {group.directional_calls} 次 · 命中 {rateText(group.hit_rate)} · 相對大盤 {rateText(group.beat_market_rate)}</li>
        {group.failed_calls ? <li className="text-danger">模型 {group.failed_calls} 次沒有回傳可用的判斷，那幾次持股不變</li> : null}
      </ul>
    </LedgerPanel>
  );
}

function TierTable({ result }: { result: AIBacktestResult }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <caption className="sr-only">各組在五個等級的判斷次數、之後 5 個交易日的平均漲跌與命中率</caption>
        <thead className="border-b border-border-strong bg-muted">
          <tr><th scope="col" className={headCellClass}>等級</th>{result.groups.map((group) => <th key={group.key} scope="col" className={headCellClass}>{group.label}</th>)}</tr>
        </thead>
        <tbody>
          {STANCES.map((stance) => (
            <tr key={stance} className="border-b last:border-b-0">
              <th scope="row" className={cn(cellClass, 'font-semibold')}>{STANCE_LABEL[stance]}</th>
              {result.groups.map((group) => {
                const tier = group.tiers.find((item) => item.stance === stance);
                return (
                  <td key={group.key} className={cn(cellClass, 'text-[13px] leading-relaxed')}>
                    {tier?.count ? (
                      <>
                        <span className="font-mono tabular-nums">{tier.count} 次</span>
                        <span className="ml-2">之後平均 <span className={cn('font-mono tabular-nums', valueToneText(tier.avg_forward_pct ?? 0))}>{signedText(tier.avg_forward_pct, 2, '%')}</span></span>
                        {stance !== 'neutral' ? <span className="ml-2 text-subtle">命中 {rateText(tier.hit_rate)}</span> : null}
                      </>
                    ) : <span className="text-muted-foreground">沒有</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CitationTable({ result }: { result: AIBacktestResult }) {
  const rule = result.groups.find((group) => group.key === 'rule');
  const ai = result.groups.find((group) => group.key === 'ai_signals');
  const rows = (ai ?? rule)?.citations ?? [];
  if (!rows.length) return <EmptyState className="py-4">這段期間的證據清單沒有出現任何訊號。</EmptyState>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <caption className="sr-only">每個訊號出現在證據清單的次數、當時已知的平均優勢，以及純規則與 AI 的使用情形</caption>
        <thead className="border-b border-border-strong bg-muted">
          <tr>{['訊號', '出現', '當時已知的平均優勢', '純規則用到', ...(ai ? ['AI 引用', 'AI 引用後命中'] : [])].map((heading) => <th key={heading} scope="col" className={headCellClass}>{heading}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const ruleRow = rule?.citations?.find((item) => item.key === row.key);
            return (
              <tr key={row.key} className="border-b last:border-b-0 text-[13px]">
                <th scope="row" className={cn(cellClass, 'font-semibold')}>{row.label}</th>
                <td className={cn(cellClass, 'font-mono tabular-nums')}>{row.available} 次</td>
                <td className={cn(cellClass, 'font-mono tabular-nums')}>{signedText(row.avg_edge_pct, 2, ' 個百分點')}</td>
                <td className={cn(cellClass, 'font-mono tabular-nums')}>{ruleRow ? `${ruleRow.cited} 次` : '--'}</td>
                {ai ? <td className={cn(cellClass, 'font-mono tabular-nums')}>{row.cited} 次（{rateText(row.available ? row.cited / row.available : null)}）</td> : null}
                {ai ? <td className={cn(cellClass, 'font-mono tabular-nums')}>{rateText(row.cited_hit_rate)}</td> : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DecisionLog({ result }: { result: AIBacktestResult }) {
  const labels = Object.fromEntries(result.groups.flatMap((group) => group.citations ?? []).map((item) => [item.key, item.label]));
  return (
    <ol className="divide-y">
      {result.decisions.map((record) => (
        <li key={record.date} className="px-4 py-3 sm:px-5">
          <p className="flex flex-wrap items-baseline gap-x-3 text-[13px]">
            <span className="font-mono font-semibold tabular-nums">{record.date}</span>
            <span className="text-muted-foreground">
              之後 5 日 <span className={cn('font-mono tabular-nums', valueToneText(record.forward_return_pct ?? 0))}>{signedText(record.forward_return_pct, 2, '%')}</span>
              （大盤 <span className={cn('font-mono tabular-nums', valueToneText(record.market_return_pct ?? 0))}>{signedText(record.market_return_pct, 2, '%')}</span>）
            </span>
          </p>
          <dl className="mt-2 grid gap-2 sm:grid-cols-3">
            {GROUP_ORDER.filter((key) => record.groups[key]).map((key) => {
              const decision = record.groups[key]!;
              return (
                <div key={key} className="min-w-0 text-[13px] leading-relaxed">
                  <dt className="text-muted-foreground">{result.groups.find((group) => group.key === key)?.label ?? key}</dt>
                  <dd>
                    <span className="font-semibold">{decision.stance ? STANCE_LABEL[decision.stance] : '沒有判斷'}</span>
                    <span className="block text-subtle">{tradeText(decision.target_exposure, decision.traded_shares, record.execution_date)}</span>
                    {decision.signal_keys?.length ? <span className="block text-xs text-muted-foreground">用到：{decision.signal_keys.map((name) => labels[name] ?? name).join('、')}</span> : null}
                    {decision.reason ? <span className="block text-xs text-muted-foreground">{decision.reason}</span> : null}
                  </dd>
                </div>
              );
            })}
          </dl>
        </li>
      ))}
    </ol>
  );
}

/** 回測結果：三組總結、資產曲線、五級統計、訊號使用情形、逐次紀錄 */
export function BacktestResults({ result }: { result: AIBacktestResult }) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const option = useMemo(() => aiBacktestOption(result, isDark), [result, isDark]);
  const { buyAndHold, market } = baselineReturns(result);
  const ordered = GROUP_ORDER.map((key) => result.groups.find((group) => group.key === key)).filter((group): group is BacktestGroupResult => Boolean(group));
  return (
    <>
      <LedgerPanel className="sm:col-span-3">
        <p className="text-[13px] leading-relaxed text-subtle">
          {result.symbol} · {result.start} ~ {result.end} · 每 {result.decision_every} 個交易日判斷一次 · 持股規則「{PRESET_RULES[result.preset].label}」（{presetText(result.preset)}）
          {result.model_name ? ` · 模型 ${result.model_name}` : ''}
        </p>
        <p className="mt-1 text-[13px] text-subtle">
          基準：買進持有 <span className={cn('font-mono tabular-nums', valueToneText(buyAndHold ?? 0))}>{signedText(buyAndHold, 2, '%')}</span>
          {' · '}加權指數 <span className={cn('font-mono tabular-nums', valueToneText(market ?? 0))}>{signedText(market, 2, '%')}</span>
        </p>
      </LedgerPanel>
      {/* 只跑純規則時只有一組，占滿整列，不露出空格的格線底色 */}
      {ordered.map((group) => <GroupPanel key={group.key} group={group} result={result} className={ordered.length === 1 ? 'sm:col-span-3' : undefined} />)}
      <LedgerPanel title="資產曲線" className="sm:col-span-3">
        {option ? <EChart title={`${result.symbol} 回測資產曲線`} option={option} height={300} /> : <EmptyState>沒有可畫的資料。</EmptyState>}
      </LedgerPanel>
      <LedgerPanel title="五個等級的結果" unit="之後 5 個交易日" className="sm:col-span-3">
        <div className="-mx-4 -mb-4 sm:-mx-5 sm:-mb-5"><TierTable result={result} /></div>
      </LedgerPanel>
      <LedgerPanel title="訊號使用情形" unit="AI 有沒有用對訊號" className="sm:col-span-3">
        <div className="-mx-4 -mb-4 sm:-mx-5 sm:-mb-5"><CitationTable result={result} /></div>
      </LedgerPanel>
      <FoldSection className="sm:col-span-3" title="逐次紀錄" summary={`${result.decisions.length} 次判斷，各組的等級、持股變化與理由`}>
        <DecisionLog result={result} />
      </FoldSection>
      <FoldSection className="sm:col-span-3" title="計算方式" summary="怎麼成交、怎麼算命中、為什麼要匿名" contentClassName="px-4 py-3 text-[13px] leading-relaxed text-subtle sm:px-5">
        <p>{result.method_note}</p>
      </FoldSection>
    </>
  );
}

/**
 * AI 回測：純規則、AI 不給訊號、AI 給訊號三組在同一檔股票、同一批判斷日比較。
 * 跑的過程用串流回報進度；同一組條件跑過一次會留在快取，按「讀取已跑完的結果」不再呼叫模型。
 */
export function AIBacktestPanel({ onAccessError }: { onAccessError: (error: unknown) => boolean }) {
  const [form, setForm] = useState<AIBacktestParams>({ symbol: '2330', start: shiftYmdMonths(toYmdLocal(), -12), end: toYmdLocal(), preset: 'standard', initial_cash: 1_000_000, ai: true });
  // 404 有兩種：還沒跑過，或股票不在清單裡；後端的訊息會說清楚是哪一種
  const { result, error, loading: running, run, cancel } = useAdminRequest<AIBacktestResult>(onAccessError, '回測暫時無法完成，請稍後重試。');
  const [progress, setProgress] = useState<{ done: number; total: number; date?: string; calls?: number; cached?: boolean } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const update = <K extends keyof AIBacktestParams>(key: K, value: AIBacktestParams[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setFormError(null);
  };

  const start = (mode: 'run' | 'load') => (event?: FormEvent) => {
    event?.preventDefault();
    if (!isTaiwanStockCode(form.symbol.trim())) return setFormError('請輸入 4 至 6 碼股票代號。');
    if (!(form.start < form.end)) return setFormError('開始日要早於結束日。');
    if (!(form.initial_cash >= 10_000 && form.initial_cash <= 100_000_000)) return setFormError('起始資金要在 1 萬到 1 億元之間。');
    setProgress(mode === 'run' ? { done: 0, total: 0 } : null);
    run((signal) => mode === 'run'
      ? streamAIBacktest(form, (item) => {
        if (item.type === 'init') setProgress({ done: 0, total: item.decisions, calls: item.llm_calls, cached: item.cached });
        if (item.type === 'progress') setProgress((previous) => ({ ...previous, done: item.done, total: item.total, date: item.date }));
      }, signal)
      : fetchAIBacktestResult(form, signal));
  };

  const stop = () => {
    cancel();
    setProgress(null);
  };

  const percent = progress?.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <Ledger title="AI 回測" stamp={result ? `${result.symbol} · ${result.start} ~ ${result.end}` : '每 5 個交易日判斷一次'} cols="grid-cols-1 sm:grid-cols-3">
      <LedgerPanel className="sm:col-span-3">
        <form onSubmit={start('run')} noValidate className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <label className={stackedFieldLabelClass}>股票代號<input className={cn(inputClass, 'font-mono tabular-nums')} value={form.symbol} onChange={(event) => update('symbol', event.target.value)} inputMode="numeric" maxLength={7} aria-describedby={formError ? 'backtest-form-error' : undefined} /></label>
            <label className={stackedFieldLabelClass}>開始日<input type="date" className={cn(inputClass, 'font-mono tabular-nums')} value={form.start} onChange={(event) => update('start', event.target.value)} /></label>
            <label className={stackedFieldLabelClass}>結束日<input type="date" className={cn(inputClass, 'font-mono tabular-nums')} value={form.end} onChange={(event) => update('end', event.target.value)} /></label>
            <label className={stackedFieldLabelClass}>
              持股規則
              <NativeSelect value={form.preset} onChange={(event) => update('preset', event.target.value as BacktestPreset)}>
                {(Object.keys(PRESET_RULES) as BacktestPreset[]).map((preset) => <option key={preset} value={preset}>{PRESET_RULES[preset].label}</option>)}
              </NativeSelect>
            </label>
            <label className={stackedFieldLabelClass}>起始資金（元）<input type="number" className={cn(inputClass, 'font-mono tabular-nums')} min={10_000} max={100_000_000} step={10_000} value={form.initial_cash} onChange={(event) => update('initial_cash', Number(event.target.value))} /></label>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">「{PRESET_RULES[form.preset].label}」：{presetText(form.preset)}。三組都套用同一套規則，AI 只決定等級。</p>
          <label className="flex items-center gap-2 text-[13px] text-subtle">
            <input type="checkbox" checked={form.ai} onChange={(event) => update('ai', event.target.checked)} className="size-4" />
            包含兩組 AI（每次判斷各呼叫一次模型；取消勾選只跑純規則）
          </label>
          {formError ? <p id="backtest-form-error" role="alert" className="text-[13px] text-danger">{formError}</p> : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={running}><Play aria-hidden />開始回測</Button>
            <Button type="button" variant="outline" disabled={running} onClick={() => start('load')()}><History aria-hidden />讀取已跑完的結果</Button>
            {running ? <Button type="button" variant="outline" onClick={stop}><Square aria-hidden />停止</Button> : null}
          </div>
        </form>
      </LedgerPanel>
      {progress && running ? (
        <LedgerPanel className="sm:col-span-3" aria-live="polite">
          <p className="text-[13px] text-subtle">
            {progress.total ? `第 ${progress.done}／${progress.total} 次判斷${progress.date ? `（${progress.date}）` : ''}` : '準備資料中…'}
            {progress.cached ? ' · 相同條件已有結果，直接讀取' : progress.calls ? ` · 共會呼叫模型 ${progress.calls} 次` : ''}
          </p>
          <div className="mt-2 h-1.5 w-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="回測進度">
            <div className="h-full bg-foreground" style={{ width: `${percent}%` }} />
          </div>
        </LedgerPanel>
      ) : null}
      {error ? <LedgerPanel className="sm:col-span-3"><Notice tone="danger">{error}</Notice></LedgerPanel> : null}
      {!result && !running && !error ? (
        <LedgerPanel className="sm:col-span-3"><EmptyState className="py-4">選好股票與期間後按「開始回測」。一年大約 50 次判斷、100 次模型呼叫。</EmptyState></LedgerPanel>
      ) : null}
      {!result && running && !progress ? <LedgerPanel padded={false} className="sm:col-span-3"><LoadingRows label="讀取結果中…" className="h-32" /></LedgerPanel> : null}
      {result ? <BacktestResults result={result} /> : null}
    </Ledger>
  );
}
