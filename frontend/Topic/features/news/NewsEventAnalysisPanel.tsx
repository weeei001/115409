import Link from 'next/link';
import type { NewsEvent, NewsEventAnalysis, NewsEvidence } from '@/lib/types/api';
import {
  DIRECTION_CLASSES,
  DIRECTION_LABELS,
  IMPORTANCE_LABELS,
  STATEMENT_LABELS,
  TOPIC_LABELS,
  impactTarget,
} from '@/lib/utils/newsImpact';

function Evidence({ items }: { items: NewsEvidence[] }) {
  if (!items.length) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium text-muted-foreground">原文依據</p>
      {items.map((item, index) => (
        <blockquote key={`${item.field}-${index}`} className="border-l-2 border-brand/50 pl-2 text-xs leading-relaxed text-subtle">
          <span className="mr-1 text-muted-foreground">[{item.field === 'title' ? '標題' : '內文'}]</span>
          {item.quote}
        </blockquote>
      ))}
    </div>
  );
}

function EventContext({ event }: { event: NewsEvent }) {
  return (
    <div className="space-y-2 border-t pt-3">
      <p className="text-xs font-medium leading-relaxed">{event.summary}</p>
      <div className="flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
        <span>{STATEMENT_LABELS[event.statement_type] ?? event.statement_type}</span>
        {event.speaker ? <span>· {event.speaker}</span> : null}
        {event.topics.map((topic) => <span key={topic} className="rounded bg-brand/10 px-1.5 py-0.5 text-brand">{TOPIC_LABELS[topic] ?? topic}</span>)}
      </div>
      <Evidence items={event.evidence} />
    </div>
  );
}

const CATEGORIES = [
  { scope: 'market', label: '大盤' },
  { scope: 'industry', label: '產業' },
  { scope: 'company', label: '個股' },
] as const;

export function NewsEventAnalysisPanel({ analysis }: { analysis: NewsEventAnalysis }) {
  if (analysis.status !== 'success') {
    return (
      <p className="py-4 text-center text-xs text-muted-foreground">
        {analysis.status === 'failed' ? '事件影響分析失敗，等待重試。' : analysis.status === 'skipped' ? '新聞資料不足，無法完成事件影響分析。' : '事件影響分析尚待處理。'}
      </p>
    );
  }

  if (!analysis.events.length && !analysis.impacts.length) return <p className="py-4 text-center text-xs text-muted-foreground">目前沒有可確認的新聞事件。</p>;

  const otherEvents = analysis.events.filter((event) => !analysis.impacts.some((impact) => impact.event_key === event.key));

  return (
    <div className="space-y-3">
      {CATEGORIES.map(({ scope, label }) => {
        const impacts = analysis.impacts.filter((impact) => impact.target_type === scope);
        return (
          <details key={scope} className="rounded-xl border bg-muted/40">
            <summary className="cursor-pointer rounded-xl p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
              <h3 className="inline text-sm font-semibold">{label}<span className="ml-2 text-xs font-normal text-muted-foreground">{impacts.length} 筆影響</span></h3>
            </summary>
            <div className="space-y-2 px-3 pb-3">
              {impacts.length ? impacts.map((impact, index) => {
                const event = analysis.events.find((item) => item.key === impact.event_key);
                return (
                  <details key={`${impact.event_key}-${impact.target_id}-${index}`} className="rounded-lg border bg-card">
                    <summary className="cursor-pointer rounded-lg p-3 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
                      <span className="font-semibold">{impactTarget(impact)}</span>
                      <span className={`ml-2 inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold ${DIRECTION_CLASSES[impact.direction]}`}>{DIRECTION_LABELS[impact.direction]}</span>
                      <span className="ml-2 inline-block text-[10px] text-muted-foreground">{IMPORTANCE_LABELS[impact.importance]}</span>
                    </summary>
                    <div className="space-y-3 px-3 pb-3">
                      {impact.target_type === 'company' ? <Link href={`/stock/${impact.target_id}`} className="inline-block text-xs font-semibold text-brand hover:underline">查看 {impactTarget(impact)} 個股</Link> : null}
                      <p className="text-xs leading-relaxed text-subtle">
                        <span className="font-medium text-foreground">{impact.basis === 'reported' ? '原文明述：' : '系統推論：'}</span>{impact.reason}
                      </p>
                      <Evidence items={impact.evidence} />
                      {event ? <EventContext event={event} /> : null}
                    </div>
                  </details>
                );
              }) : <p className="text-xs text-muted-foreground">目前沒有此類影響。</p>}
            </div>
          </details>
        );
      })}
      {otherEvents.length ? (
        <details className="rounded-xl border bg-muted/40">
          <summary className="cursor-pointer rounded-xl p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
            <h3 className="inline text-sm font-semibold">其他事件<span className="ml-2 text-xs font-normal text-muted-foreground">{otherEvents.length} 筆</span></h3>
          </summary>
          <div className="space-y-3 px-3 pb-3">
            <p className="text-xs text-muted-foreground">以下事件尚無可支持的台股影響。</p>
            {otherEvents.map((event) => <EventContext key={event.key} event={event} />)}
          </div>
        </details>
      ) : null}
      {analysis.analyzed_at ? <p className="text-[11px] text-muted-foreground">分析時間：{new Date(analysis.analyzed_at).toLocaleString('zh-TW')}</p> : null}
    </div>
  );
}
