import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { figureClass, Ledger, LedgerPanel, LightGlyph, type LightState } from '@/components/common/Ledger';
import { EmptyState, LoadingRows, Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/button';
import { fetchAIFeedbackSummary, fetchAITrackRecord } from '@/lib/api/aiEffectiveness';
import { userFacingMessage } from '@/lib/api/errorDetail';
import { hasEnoughSamples, hitRateSummary, hitRateText, HORIZON_LABEL } from '@/lib/brief/trackRecord';
import type { AIFeedbackSummary, AITrackRecordResponse } from '@/lib/types/api';
import { formatTaipei } from '@/lib/utils/date';
import { fmtPercent } from '@/lib/utils/format';
import { cn } from '@/lib/cn';

/**
 * AI 成效：全站 AI 摘要的命中率（對照每次都猜漲）與使用者對 AI 對話的回饋。
 * 兩份資料各自載入，一份失敗不影響另一份。
 */
export function AIEffectivenessPanel({ onAccessError }: { onAccessError: (error: unknown) => boolean }) {
  const [track, setTrack] = useState<AITrackRecordResponse | null>(null);
  const [feedback, setFeedback] = useState<AIFeedbackSummary | null>(null);
  const [errors, setErrors] = useState<{ track?: string; feedback?: string }>({});
  const [revision, setRevision] = useState(0);
  const accessError = useRef(onAccessError);
  accessError.current = onAccessError;

  useEffect(() => {
    const ctrl = new AbortController();
    setErrors({});
    const fail = (key: 'track' | 'feedback', fallback: string) => (err: unknown) => {
      if (ctrl.signal.aborted || accessError.current(err)) return;
      setErrors((previous) => ({ ...previous, [key]: userFacingMessage(err, fallback) }));
    };
    fetchAITrackRecord(undefined, ctrl.signal).then(setTrack, fail('track', '無法載入 AI 摘要命中率。'));
    fetchAIFeedbackSummary(ctrl.signal).then(setFeedback, fail('feedback', '無法載入 AI 對話回饋。'));
    return () => ctrl.abort();
  }, [revision]);

  const failed = Boolean(errors.track || errors.feedback);
  const state: LightState = failed ? 'error' : track && feedback ? 'ready' : 'loading';
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
          : track.horizons.map((horizon) => (
            <LedgerPanel key={horizon.horizon} title={HORIZON_LABEL[horizon.horizon]} unit={`第 ${horizon.trading_days} 個交易日`}>
              <p className={cn(figureClass,!hasEnoughSamples(horizon) && 'text-muted-foreground')}>{hitRateText(horizon)}</p>
              <p className="mt-2 text-[13px] leading-relaxed text-subtle">{hitRateSummary(horizon)}</p>
              <p className="mt-1 text-xs text-muted-foreground">未表態 {horizon.no_call} 次 · 未到期 {horizon.pending} 次</p>
            </LedgerPanel>
          ))}
      </Ledger>

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
              <p className="mt-2 text-[13px] text-subtle">有幫助 {feedback.helpful} · 沒有幫助 {feedback.unhelpful}</p>
            </LedgerPanel>
            <LedgerPanel title="回饋率">
              <p className={figureClass}>{fmtPercent(feedback.completed_answers ? feedback.rated / feedback.completed_answers : null, { fromRatio: true, decimals: 1 })}</p>
              <p className="mt-2 text-[13px] text-subtle">{feedback.completed_answers} 則完成的回覆中，{feedback.rated} 則有回饋</p>
            </LedgerPanel>
            <LedgerPanel title="最近「沒有幫助」的回覆" className="sm:col-span-2">
              {feedback.recent_unhelpful.length ? (
                <ul className="divide-y border-y text-sm">
                  {feedback.recent_unhelpful.map((item) => (
                    <li key={item.message_id} className="py-2.5">
                      <p className="font-mono text-xs text-muted-foreground tabular-nums">{formatTaipei(item.rated_at)}</p>
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
