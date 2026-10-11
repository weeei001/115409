import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { figureClass, Ledger, LedgerPanel, LightGlyph, type LightState } from '@/components/common/Ledger';
import { FoldSection } from '@/components/common/CollapsibleSection';
import { EmptyState, LoadingRows, Notice } from '@/components/common/Notice';
import { signedText } from '@/lib/utils/format';
import { Button } from '@/components/ui/button';
import { fetchAITrackRecord } from '@/lib/api/aiEffectiveness';
import { userFacingMessage } from '@/lib/api/errorDetail';
import { STANCE } from '@/lib/brief/textBriefLabels';
import {
  hasEnoughSamples, hitRateSummary, hitRateText, HORIZON_LABEL, relativeSummary, TRACK_RESULT_LABEL,
} from '@/lib/brief/trackRecord';
import type { AITrackRecordResponse, TrackRecordItem } from '@/lib/types/api';
import { valueToneText } from '@/lib/utils/tone';
import { cn } from '@/lib/cn';

/** 一份摘要的三個區間結果：立場、實際漲跌、是否命中 */
function RecentRow({ item }: { item: TrackRecordItem }) {
  return (
    <li className="px-4 py-3 sm:px-5">
      <p className="text-[13px] text-muted-foreground">
        <span className="font-mono tabular-nums">{item.as_of_date}</span> 的分析
        {item.overall_stance ? ` · 整體 ${STANCE[item.overall_stance] ?? item.overall_stance}` : ''}
      </p>
      <dl className="mt-1.5 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
        {item.outcomes.map((outcome) => (
          <div key={outcome.horizon} className="flex flex-wrap items-baseline justify-between gap-x-2 sm:block">
            <dt className="text-muted-foreground">{HORIZON_LABEL[outcome.horizon]}</dt>
            <dd>
              {outcome.stance ? (STANCE[outcome.stance] ?? outcome.stance) : '--'}
              {outcome.return_pct != null ? (
                <span className={cn('ml-1.5 font-mono tabular-nums', valueToneText(outcome.return_pct))}>
                  {signedText(outcome.return_pct, 2, '%')}
                </span>
              ) : null}
              {outcome.benchmark_return_pct != null ? (
                <span className="ml-1 text-muted-foreground">
                  （大盤{' '}
                  <span className={cn('font-mono tabular-nums', valueToneText(outcome.benchmark_return_pct))}>
                    {signedText(outcome.benchmark_return_pct, 2, '%')}
                  </span>
                  ）
                </span>
              ) : null}
              <span className="ml-1.5 text-muted-foreground">· {TRACK_RESULT_LABEL[outcome.result]}</span>
            </dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

/**
 * AI 判斷回顧：拿這檔股票過去的 AI 摘要立場，對照之後實際漲跌算命中率，並列出「每次都猜漲」的基準與相對大盤的命中率。
 * 命中率是品質，不是漲跌方向：讀數不上漲跌色；只有實際漲跌幅依正負上色。
 */
export function AITrackRecordCard({ symbol }: { symbol: string }) {
  const [data, setData] = useState<AITrackRecordResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    const ctrl = new AbortController();
    setError(null);
    fetchAITrackRecord(symbol, ctrl.signal)
      .then((result) => { if (!ctrl.signal.aborted) setData(result); })
      .catch((err) => { if (!ctrl.signal.aborted) setError(userFacingMessage(err, 'AI 判斷回顧暫時無法載入，請稍後重試。')); });
    return () => ctrl.abort();
  }, [symbol, revision]);

  const current = data?.symbol === symbol ? data : null;
  const state: LightState = error ? 'error' : current ? 'ready' : 'loading';
  const stamp = (
    <span className="inline-flex items-center gap-1.5">
      <LightGlyph state={state} />
      {current ? `近 ${current.days} 天 · ${current.snapshot_count} 份摘要` : error ? '載入失敗' : '載入中'}
    </span>
  );

  let body: ReactNode;
  if (error && !current) {
    body = (
      <LedgerPanel className="sm:col-span-3">
        <Notice tone="danger" action={<Button variant="outline" size="sm" onClick={retry}><RefreshCw aria-hidden />重試</Button>}>{error}</Notice>
      </LedgerPanel>
    );
  } else if (!current) {
    body = <LedgerPanel padded={false} className="sm:col-span-3"><LoadingRows label="讀取 AI 判斷回顧中…" className="h-32" /></LedgerPanel>;
  } else if (current.snapshot_count === 0) {
    body = (
      <LedgerPanel padded={false} className="sm:col-span-3">
        <EmptyState>這檔股票近 {current.days} 天還沒有可以回顧的 AI 摘要；排程每天產生摘要後，到期的判斷會出現在這裡。</EmptyState>
      </LedgerPanel>
    );
  } else {
    body = (
      <>
        {current.horizons.map((horizon) => {
          const relative = relativeSummary(horizon);
          return (
            <LedgerPanel key={horizon.horizon} title={HORIZON_LABEL[horizon.horizon]} unit={`第 ${horizon.trading_days} 個交易日`}>
              {/* 樣本不足時讀數改淡色，避免少數幾次的結果被當成結論 */}
              <p className={cn(figureClass, !hasEnoughSamples(horizon) && 'text-muted-foreground')}>{hitRateText(horizon)}</p>
              <p className="mt-1 text-[13px] text-muted-foreground">命中率</p>
              <p className="mt-2 text-[13px] leading-relaxed text-subtle">{hitRateSummary(horizon)}</p>
              {relative ? <p className="mt-1 text-[13px] leading-relaxed text-subtle">{relative}</p> : null}
            </LedgerPanel>
          );
        })}
        <FoldSection
          className="sm:col-span-3"
          title="計算方式"
          summary="怎麼算命中、哪些摘要不列入"
          contentClassName="px-4 py-3 text-[13px] leading-relaxed text-subtle sm:px-5"
        >
          <p>{current.method_note}</p>
        </FoldSection>
        {current.recent.length ? (
          <FoldSection className="sm:col-span-3" title="最近的 AI 判斷" summary={`最新 ${current.recent.length} 份，由新到舊`}>
            <ul className="divide-y">{current.recent.map((item) => <RecentRow key={item.as_of_date} item={item} />)}</ul>
          </FoldSection>
        ) : null}
      </>
    );
  }

  return (
    <Ledger title="AI 判斷回顧" stamp={stamp} cols="grid-cols-1 sm:grid-cols-3">
      {body}
    </Ledger>
  );
}
