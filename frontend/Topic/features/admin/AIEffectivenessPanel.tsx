import { useEffect, useRef, useState } from 'react';
import { FoldSection } from '@/components/common/CollapsibleSection';
import { RefreshCw } from 'lucide-react';
import { cellClass, figureClass, headCellClass, Ledger, LedgerPanel, LightGlyph, type LightState } from '@/components/common/Ledger';
import { EmptyState, LoadingRows, Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/button';
import { fetchAIFeedbackSummary, fetchAITrackRecord, fetchAIUsageSummary } from '@/lib/api/aiEffectiveness';
import { userFacingMessage } from '@/lib/api/errorDetail';
import { hasEnoughSamples, hitRateSummary, hitRateText, HORIZON_LABEL, relativeSummary } from '@/lib/brief/trackRecord';
import { avgTokensText, costNote, featureCallsText, featureLabel, featureUsageNote, latencyText, retryText, tokenSplitText, usdText } from '@/lib/brief/usage';
import type { AIFeedbackSummary, AITrackRecordResponse, AIUsageSummary } from '@/lib/types/api';
import { formatTaipei } from '@/lib/utils/date';
import { fmtNum, fmtPercent } from '@/lib/utils/format';
import { cn } from '@/lib/cn';

const numCell = cn(cellClass, 'text-right font-mono text-sm tabular-nums');

/** ai_usage_logs 依功能彙整的模型呼叫：AI 對話（含小燈）、AI 摘要、新聞事件判讀 */
export function FeatureUsageLedger({ usage }: { usage: AIUsageSummary }) {
  const features = usage.features ?? [];
  return (
    <Ledger aria-labelledby="ai-feature-usage-heading" title={<span id="ai-feature-usage-heading">各功能的模型呼叫</span>} stamp={`近 ${usage.days} 天`}>
      {!features.length ? (
        <LedgerPanel><EmptyState className="py-4">近 {usage.days} 天沒有模型呼叫紀錄。</EmptyState></LedgerPanel>
      ) : <>
        <LedgerPanel padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <caption className="sr-only">各功能的請求數、模型呼叫次數、每次請求的平均 token 與估算成本（美元）</caption>
              <thead className="border-b border-border-strong bg-muted">
                <tr>
                  <th scope="col" className={headCellClass}>功能</th>
                  {['請求', '模型呼叫', '每次請求平均 token', '每次請求估算成本', '期間合計'].map((heading) => (
                    <th key={heading} scope="col" className={cn(headCellClass, 'text-right')}>{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {features.map((feature) => (
                  <tr key={feature.feature} className="border-b last:border-b-0">
                    <th scope="row" className={cn(cellClass, 'font-medium')}>{featureLabel(feature.feature)}</th>
                    <td className={numCell}>{fmtNum(feature.requests)} 次</td>
                    <td className={numCell}>{featureCallsText(feature)}</td>
                    <td className={numCell}>
                      {avgTokensText(feature)}
                      <span className="block text-sm text-muted-foreground">{tokenSplitText(feature)}</span>
                    </td>
                    <td className={numCell}>{usdText(feature.avg_cost_usd)}</td>
                    <td className={numCell}>{usdText(feature.total_cost_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </LedgerPanel>
        <FoldSection title="用量計算方式" contentClassName="px-4 py-3 text-sm leading-relaxed text-muted-foreground sm:px-5">
          <p>{featureUsageNote(usage)}</p>
        </FoldSection>
      </>}
    </Ledger>
  );
}

/**
 * AI 成效：全站 AI 摘要的命中率（對照每次都猜漲與大盤）、使用者對 AI 對話的回饋、摘要的用量與估算成本，
 * 以及各功能（AI 對話、AI 摘要、新聞事件判讀）的模型呼叫用量。三份資料各自載入，一份失敗不影響其他。
 */
export function AIEffectivenessPanel({ onAccessError }: { onAccessError: (error: unknown) => boolean }) {
  const [track, setTrack] = useState<AITrackRecordResponse | null>(null);
  const [feedback, setFeedback] = useState<AIFeedbackSummary | null>(null);
  const [usage, setUsage] = useState<AIUsageSummary | null>(null);
  const [errors, setErrors] = useState<{ track?: string; feedback?: string; usage?: string }>({});
  const [revision, setRevision] = useState(0);
  const accessError = useRef(onAccessError);
  accessError.current = onAccessError;

  useEffect(() => {
    const ctrl = new AbortController();
    setErrors({});
    const fail = (key: 'track' | 'feedback' | 'usage', fallback: string) => (err: unknown) => {
      if (ctrl.signal.aborted || accessError.current(err)) return;
      setErrors((previous) => ({ ...previous, [key]: userFacingMessage(err, fallback) }));
    };
    fetchAITrackRecord(undefined, ctrl.signal).then(setTrack, fail('track', '無法載入 AI 摘要命中率。'));
    fetchAIFeedbackSummary(ctrl.signal).then(setFeedback, fail('feedback', '無法載入 AI 對話回饋。'));
    fetchAIUsageSummary(ctrl.signal).then(setUsage, fail('usage', '無法載入 AI 摘要用量。'));
    return () => ctrl.abort();
  }, [revision]);

  const failed = Boolean(errors.track || errors.feedback || errors.usage);
  const state: LightState = failed ? 'error' : track && feedback && usage ? 'ready' : 'loading';
  const retry = <Button variant="outline" size="sm" onClick={() => setRevision((value) => value + 1)}><RefreshCw aria-hidden />重試</Button>;

  return (
    <div className="space-y-10">
      <Ledger
        title="AI 摘要命中率（全站）"
        stamp={<span className="inline-flex items-center gap-1.5"><LightGlyph state={state} />{track ? `近 ${track.days} 天 · ${track.snapshot_count} 份摘要` : '載入中'}</span>}
        cols="grid-cols-1 sm:grid-cols-3"
      >
        {errors.track ? <LedgerPanel className="sm:col-span-3"><Notice tone="danger" action={retry}>{errors.track}</Notice></LedgerPanel>
          : !track ? <LedgerPanel padded={false} className="sm:col-span-3"><LoadingRows className="h-32" /></LedgerPanel>
          : track.horizons.map((horizon) => {
            const relative = relativeSummary(horizon);
            return (
              <LedgerPanel key={horizon.horizon} title={HORIZON_LABEL[horizon.horizon]} unit={`第 ${horizon.trading_days} 個交易日`}>
                <p className={cn(figureClass,!hasEnoughSamples(horizon) && 'text-muted-foreground')}>{hitRateText(horizon)}</p>
                <p className="mt-2 text-sm leading-relaxed text-subtle">{hitRateSummary(horizon)}</p>
                {relative ? <p className="mt-1 text-sm leading-relaxed text-subtle">{relative}</p> : null}
                <p className="mt-1 text-sm text-muted-foreground">未表態 {horizon.no_call} 次 · 未到期 {horizon.pending} 次</p>
              </LedgerPanel>
            );
          })}
      </Ledger>

      <Ledger
        title="AI 摘要用量與估算成本"
        stamp={usage ? `近 ${usage.days} 天 · ${usage.briefs} 份摘要` : undefined}
        cols="grid-cols-1 sm:grid-cols-3"
      >
        {errors.usage ? <LedgerPanel className="sm:col-span-3"><Notice tone="danger" action={retry}>{errors.usage}</Notice></LedgerPanel>
          : !usage ? <LedgerPanel padded={false} className="sm:col-span-3"><LoadingRows className="h-32" /></LedgerPanel>
          : !usage.briefs ? <LedgerPanel className="sm:col-span-3"><EmptyState className="py-4">近 {usage.days} 天沒有 AI 摘要紀錄。</EmptyState></LedgerPanel>
          : <>
            <LedgerPanel title="每份平均 token">
              <p className={figureClass}>{avgTokensText(usage)}</p>
              <p className="mt-2 text-sm text-subtle">{tokenSplitText(usage)}</p>
            </LedgerPanel>
            <LedgerPanel title="每份平均產生時間">
              <p className={figureClass}>{latencyText(usage)}</p>
              <p className="mt-2 text-sm text-subtle">{retryText(usage)}</p>
            </LedgerPanel>
            <LedgerPanel title="每份估算成本">
              <p className={figureClass}>{usdText(usage.avg_cost_usd)}</p>
              <p className="mt-2 text-sm text-subtle">近 {usage.days} 天合計 {usdText(usage.total_cost_usd)}</p>
            </LedgerPanel>
            <FoldSection title="成本估算方式" className="sm:col-span-3" contentClassName="px-4 py-3 text-sm leading-relaxed text-muted-foreground sm:px-5">
              <p>{costNote(usage)}</p>
            </FoldSection>
          </>}
      </Ledger>

      {/* 和上一張共用同一份用量資料：載入中、失敗都只在上一張說明 */}
      {usage ? <FeatureUsageLedger usage={usage} /> : null}

      <Ledger
        title="AI 對話回饋"
        stamp={feedback ? `近 ${feedback.days} 天` : undefined}
        cols="grid-cols-1 sm:grid-cols-2"
      >
        {errors.feedback ? <LedgerPanel className="sm:col-span-2"><Notice tone="danger" action={retry}>{errors.feedback}</Notice></LedgerPanel>
          : !feedback ? <LedgerPanel padded={false} className="sm:col-span-2"><LoadingRows className="h-32" /></LedgerPanel>
          : !feedback.ready ? <LedgerPanel className="sm:col-span-2"><Notice tone="warning">回饋資料表尚未建立，請先執行資料庫初始化（init-schema）。</Notice></LedgerPanel>
          : <>
            <LedgerPanel title="有幫助比例">
              <p className={figureClass}>{fmtPercent(feedback.helpful_rate, { fromRatio: true, decimals: 1 })}</p>
              <p className="mt-2 text-sm text-subtle">有幫助 {feedback.helpful} · 沒有幫助 {feedback.unhelpful}</p>
            </LedgerPanel>
            <LedgerPanel title="回饋率">
              <p className={figureClass}>{fmtPercent(feedback.completed_answers ? feedback.rated / feedback.completed_answers : null, { fromRatio: true, decimals: 1 })}</p>
              <p className="mt-2 text-sm text-subtle">{feedback.completed_answers} 則完成的回覆中，{feedback.rated} 則有回饋</p>
            </LedgerPanel>
            <LedgerPanel title="最近「沒有幫助」的回覆" className="sm:col-span-2">
              {feedback.recent_unhelpful.length ? (
                <ul className="divide-y border-y text-sm">
                  {feedback.recent_unhelpful.map((item) => (
                    <li key={item.message_id} className="py-2.5">
                      <p className="font-mono text-sm text-muted-foreground tabular-nums">{formatTaipei(item.rated_at)}</p>
                      <p className="mt-1 leading-relaxed break-words">{item.answer_excerpt || '（回覆沒有文字內容）'}</p>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState className="py-4">期間內沒有「沒有幫助」的回饋。</EmptyState>}
            </LedgerPanel>
          </>}
      </Ledger>
    </div>
  );
}
