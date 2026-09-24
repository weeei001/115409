import Link from 'next/link';
import type { NewsEventAnalysis, NewsEvidence } from '../../lib/types';
import {
  DIRECTION_CLASSES, DIRECTION_LABELS, IMPORTANCE_LABELS, SCOPE_LABELS,
  STATEMENT_LABELS, TOPIC_LABELS, impactTarget,
} from '../../lib/utils/newsImpact';

function Evidence({ items }: { items: NewsEvidence[] }) {
  if (!items.length) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium text-[var(--color-text-muted)]">原文依據</p>
      {items.map((item, index) => (
        <blockquote key={`${item.field}-${index}`} className="border-l-2 border-brand/50 pl-2 text-xs leading-relaxed text-[var(--color-text-secondary)]">
          <span className="mr-1 text-[var(--color-text-muted)]">[{item.field === 'title' ? '標題' : '內文'}]</span>
          {item.quote}
        </blockquote>
      ))}
    </div>
  );
}

export function NewsEventAnalysisPanel({ analysis }: { analysis: NewsEventAnalysis }) {
  if (analysis.status !== 'success') {
    return (
      <p className="py-4 text-center text-xs text-[var(--color-text-muted)]">
        {analysis.status === 'failed' ? '事件影響分析失敗，等待重試。' :
          analysis.status === 'skipped' ? '新聞資料不足，無法完成事件影響分析。' :
            '事件影響分析尚待處理。'}
      </p>
    );
  }

  if (!analysis.events.length) {
    return <p className="py-4 text-center text-xs text-[var(--color-text-muted)]">目前沒有可確認的新聞事件。</p>;
  }

  return (
    <div className="space-y-4">
      {analysis.events.map((event) => {
        const impacts = analysis.impacts.filter((impact) => impact.event_key === event.key);
        return (
          <section key={event.key} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/40 p-3 space-y-3">
            <div>
              <p className="text-sm font-semibold leading-relaxed text-[var(--color-text-primary)]">{event.summary}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] text-[var(--color-text-muted)]">
                <span>{STATEMENT_LABELS[event.statement_type] ?? event.statement_type}</span>
                {event.speaker && <span>· {event.speaker}</span>}
                {event.topics.map((topic) => <span key={topic} className="rounded bg-brand/10 px-1.5 py-0.5 text-brand">{TOPIC_LABELS[topic] ?? topic}</span>)}
              </div>
            </div>
            <Evidence items={event.evidence} />
            {impacts.length ? (
              <div className="space-y-2 border-t border-[var(--color-border)] pt-3">
                {impacts.map((impact, index) => (
                  <div key={`${impact.target_type}-${impact.target_id}-${index}`} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] p-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] text-[var(--color-text-muted)]">{SCOPE_LABELS[impact.target_type]}</span>
                      {impact.target_type === 'company' ? (
                        <Link href={`/stock/${impact.target_id}`} className="text-xs font-semibold text-brand hover:underline">{impactTarget(impact)}</Link>
                      ) : <span className="text-xs font-semibold">{impactTarget(impact)}</span>}
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${DIRECTION_CLASSES[impact.direction]}`}>{DIRECTION_LABELS[impact.direction]}</span>
                      <span className="text-[10px] text-[var(--color-text-muted)]">{IMPORTANCE_LABELS[impact.importance]}</span>
                    </div>
                    <p className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
                      <span className="font-medium text-[var(--color-text-primary)]">{impact.basis === 'reported' ? '原文明述：' : '系統推論：'}</span>{impact.reason}
                    </p>
                    <Evidence items={impact.evidence} />
                  </div>
                ))}
              </div>
            ) : <p className="text-xs text-[var(--color-text-muted)]">此事件尚無可支持的台股影響。</p>}
          </section>
        );
      })}
      {analysis.analyzed_at && <p className="text-[11px] text-[var(--color-text-muted)]">分析時間：{new Date(analysis.analyzed_at).toLocaleString('zh-TW')}</p>}
    </div>
  );
}
