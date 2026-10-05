import React, { useEffect, useRef } from 'react';
import Link from 'next/link';
import type { NewsEvent, NewsEventAnalysis, NewsEvidence } from '@/lib/types/api';
import { EmptyState } from '@/components/common/Notice';
import { cn } from '@/lib/cn';
import {
  IMPORTANCE_LABELS,
  STATEMENT_LABELS,
  TOPIC_LABELS,
} from '@/lib/utils/newsImpact';
import { ImpactDirectionTag } from './ImpactTag';
import { groupImpactsByTarget } from './impactGroups';
import { eventCitationId, groupCitationId, impactCitationId } from './citations';
import { formatTaipei } from '@/lib/utils/date';
import { Badge } from '@/components/ui/badge';
import { textLinkClass } from '@/components/ui/button';
import { Disclosure } from '@/components/common/Disclosure';
import { taiwanStockHref, UNSUPPORTED_STOCK_MARKET_MESSAGE } from '@/lib/news/newsLinks';

/** 對照中的項目：中性底色＋左側粗線（與內文的底色同一個 token）。粗線用 ::before 畫，不佔 box-shadow，focus 的燈色內圈才不會被蓋掉 */
const activeItem = 'relative before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-border-strong before:opacity-0 data-[active=true]:bg-accent data-[active=true]:before:opacity-100';

/** 與內文引用句的雙向對照；不給時面板只是靜態內容（例如測試、其他頁面） */
export interface CitationLink {
  /** 對照中的項目（滑過、聚焦或選取） */
  activeId: string | null;
  /** 已選取的項目與引用句 */
  selected: { id: string; quote?: string } | null;
  /** 這句引用是否確實出現在內文（只有出現的才能定位） */
  locatable: (quote: string) => boolean;
  onPreview: (id: string | null) => void;
  /** scroll：是否把內文中的對應句捲進視窗 */
  onSelect: (target: { id: string; quote?: string } | null, scroll: boolean) => void;
  /** 內文點了引用句：展開並捲到這個項目（nonce 每次遞增） */
  reveal: { id: string; nonce: number } | null;
}

const isWide = () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 滑鼠滑過或鍵盤聚焦時預覽對應句，離開時取消（觸控點按不算滑過，避免預覽黏住） */
function previewHandlers(link: CitationLink | undefined, id: string) {
  if (!link) return {};
  return {
    onPointerEnter: (event: React.PointerEvent) => { if (event.pointerType === 'mouse') link.onPreview(id); },
    onPointerLeave: (event: React.PointerEvent) => { if (event.pointerType === 'mouse') link.onPreview(null); },
    onFocus: () => link.onPreview(id),
    onBlur: (event: React.FocusEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) link.onPreview(null);
    },
  };
}

/** 原文依據：引用句左側一條 2px 中性標線；出現在內文的句子可以點選，在內文中標出並捲到該句 */
function Evidence({ items, ownerId, link }: { items: NewsEvidence[]; ownerId: string; link?: CitationLink }) {
  if (!items.length) return null;
  const anyLocatable = Boolean(link) && items.some((item) => item.field === 'content' && link!.locatable(item.quote));
  return (
    <div className="space-y-1.5">
      <p className="characteristic">原文依據{anyLocatable ? '・點選在內文標出' : ''}</p>
      {items.map((item, index) => {
        const label = <span className="mr-1 font-mono text-[11px] text-muted-foreground">[{item.field === 'title' ? '標題' : '內文'}]</span>;
        if (!link || item.field !== 'content' || !link.locatable(item.quote)) {
          return (
            <blockquote key={`${item.field}-${index}`} className="border-l-2 border-input pl-2.5 text-[13px] leading-relaxed text-subtle">
              {label}
              {item.quote}
            </blockquote>
          );
        }
        const pressed = link.selected?.id === ownerId && link.selected.quote === item.quote.trim();
        return (
          <button
            key={`${item.field}-${index}`}
            type="button"
            aria-pressed={pressed}
            onClick={() => link.onSelect(pressed ? null : { id: ownerId, quote: item.quote.trim() }, !pressed)}
            className={cn(
              'block min-h-11 w-full rounded-sm border-l-2 py-1.5 pr-2 pl-2.5 text-left text-[13px] leading-relaxed text-subtle outline-none transition-colors duration-(--dur-flash) hover:bg-accent hover:text-foreground focus-lamp',
              pressed ? 'border-border-strong bg-accent text-foreground' : 'border-input',
            )}
          >
            {label}
            {item.quote}
          </button>
        );
      })}
    </div>
  );
}

function EventContext({ event, ownerId, link }: { event: NewsEvent; ownerId: string; link?: CitationLink }) {
  return (
    <div className="space-y-2 border-t pt-3">
      <p className="text-[13px] leading-relaxed font-medium">{event.summary}</p>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <span>{STATEMENT_LABELS[event.statement_type] ?? event.statement_type}</span>
        {event.speaker ? <span>· {event.speaker}</span> : null}
        {event.topics.map((topic) => <Badge key={topic} tone="outline" size="sm" className="py-0 leading-5 font-normal">{TOPIC_LABELS[topic] ?? topic}</Badge>)}
      </div>
      <Evidence items={event.evidence} ownerId={ownerId} link={link} />
    </div>
  );
}

const CATEGORIES = [
  { scope: 'market', label: '大盤' },
  { scope: 'industry', label: '產業' },
  { scope: 'company', label: '個股' },
] as const;

/**
 * 新聞事件影響：大盤／產業／個股三段，以共用的 1px 線分隔、方角。
 * 段內依影響對象歸併：同一家公司只出現一次（彙總方向＋事件數＋最高重要性），展開後逐筆列出該對象的每一個事件影響，
 * 每筆：帶正負號的方向標籤 → 重要性（純文字）→ 理由 → 原文依據 → 事件脈絡。不丟任何一筆。
 * 給了 link 時與內文雙向對照：滑過／聚焦項目＝內文對應句加底色；點原文依據＝在內文標出並捲到該句。
 */
export function NewsEventAnalysisPanel({ analysis, link }: { analysis: NewsEventAnalysis; link?: CitationLink }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const reveal = link?.reveal;

  // 內文點了引用句：展開所在的分類與對象，並把該項目捲進面板可見範圍
  useEffect(() => {
    if (!reveal || !rootRef.current) return;
    const target = rootRef.current.querySelector(`[data-citation-id="${CSS.escape(reveal.id)}"]`);
    if (!target) return;
    for (let el: Element | null = target; el && el !== rootRef.current; el = el.parentElement) {
      if (el instanceof HTMLDetailsElement) el.open = true;
    }
    const frame = requestAnimationFrame(() => target.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }));
    return () => cancelAnimationFrame(frame);
  }, [reveal]);

  if (analysis.status !== 'success') {
    return (
      <EmptyState className="py-6 text-[13px]">
        {analysis.status === 'failed' ? '事件影響分析失敗，等待重試。' : analysis.status === 'skipped' ? '新聞資料不足，無法完成事件影響分析。' : '事件影響分析尚待處理。'}
      </EmptyState>
    );
  }

  if (!analysis.events.length && !analysis.impacts.length) return <EmptyState className="py-6 text-[13px]">目前沒有可確認的新聞事件。</EmptyState>;

  const otherEvents = analysis.events.filter((event) => !analysis.impacts.some((impact) => impact.event_key === event.key));
  const isActive = (id: string) => (link?.activeId === id ? 'true' : undefined);
  const isSelected = (id: string) => link?.selected?.id === id;

  return (
    <div ref={rootRef}>
      <div className="border-t">
        {CATEGORIES.map(({ scope, label }) => {
          const impacts = analysis.impacts.filter((impact) => impact.target_type === scope);
          return (
            <Disclosure
              key={scope}
              className="border-b"
              summaryProps={{ className: 'py-2 text-foreground' }}
              summary={<h3 className="inline text-sm font-bold tracking-[0.04em]">{label}<span className="ml-2 font-mono text-xs font-normal tracking-normal text-muted-foreground tabular-nums">{impacts.length} 筆影響</span></h3>}
            >
              <div className="pb-3">
                {impacts.length ? (
                  <div className="border">
                    {groupImpactsByTarget(impacts).map((group) => {
                      const stockHref = group.targetType === 'company' ? taiwanStockHref(group.targetId) : null;
                      const groupId = groupCitationId(group.key);
                      const memberIds = group.impacts.map((impact) => impactCitationId(analysis.impacts.indexOf(impact)));
                      return (
                        <Disclosure
                          key={group.key}
                          data-citation-id={groupId}
                          className="border-b bg-card last:border-b-0"
                          summaryProps={{
                            ...previewHandlers(link, groupId),
                            'data-active': isActive(groupId),
                            'aria-current': isSelected(groupId) ? 'true' : undefined,
                            onClick: link ? (event) => {
                              const opening = !(event.currentTarget.parentElement as HTMLDetailsElement).open;
                              // 展開＝選取這個對象（寬版把內文對應句捲進視窗；手機版只加底色，不把人拉離面板）
                              if (opening) link.onSelect({ id: groupId }, isWide());
                              else if (link.selected && [groupId, ...memberIds].includes(link.selected.id)) link.onSelect(null, false);
                            } : undefined,
                            className: cn('px-3 py-2 text-[13px] text-foreground hover:bg-accent', activeItem),
                          }}
                          summary={
                            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="font-medium">{group.label}</span>
                              <ImpactDirectionTag direction={group.direction} />
                              {group.eventCount > 1 ? <span className="text-xs text-muted-foreground"><span className="font-mono tabular-nums">{group.eventCount}</span> 項事件</span> : null}
                              <span className="text-xs text-muted-foreground">{IMPORTANCE_LABELS[group.importance]}</span>
                            </span>
                          }
                        >
                          <div className="border-t px-3 pt-1 pb-3">
                            {stockHref ? (
                              <Link
                                href={stockHref}
                                className={cn('inline-flex min-h-11 items-center rounded-sm text-[13px] font-medium outline-none focus-lamp', textLinkClass)}
                              >
                                查看 {group.label} 個股
                              </Link>
                            ) : group.targetType === 'company' ? <p className="py-2 text-[13px] text-muted-foreground">{UNSUPPORTED_STOCK_MARKET_MESSAGE}</p> : null}
                            <ol className="space-y-0">
                              {group.impacts.map((impact, index) => {
                                const event = analysis.events.find((item) => item.key === impact.event_key);
                                const id = memberIds[index];
                                return (
                                  <li
                                    key={`${impact.event_key}-${index}`}
                                    data-citation-id={id}
                                    data-active={isActive(id)}
                                    aria-current={isSelected(id) ? 'true' : undefined}
                                    {...previewHandlers(link, id)}
                                    className={cn('-mx-3 space-y-3 border-t px-3 py-3 transition-colors duration-(--dur-flash) first:border-t-0 first:pt-2 last:pb-0 data-[active=true]:last:pb-3', activeItem)}
                                  >
                                    {group.impacts.length > 1 ? (
                                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                        <span className="characteristic">第 <span className="font-mono tabular-nums">{index + 1}</span> 筆</span>
                                        <ImpactDirectionTag direction={impact.direction} />
                                        <span className="text-xs text-muted-foreground">{IMPORTANCE_LABELS[impact.importance]}</span>
                                      </div>
                                    ) : null}
                                    <p className="text-[13px] leading-relaxed text-subtle">
                                      <span className="font-medium text-foreground">{impact.basis === 'reported' ? '原文明述：' : '系統推論：'}</span>{impact.reason}
                                    </p>
                                    <Evidence items={impact.evidence} ownerId={id} link={link} />
                                    {event ? <EventContext event={event} ownerId={id} link={link} /> : null}
                                  </li>
                                );
                              })}
                            </ol>
                          </div>
                        </Disclosure>
                      );
                    })}
                  </div>
                ) : <p className="text-[13px] text-muted-foreground">目前沒有此類影響。</p>}
              </div>
            </Disclosure>
          );
        })}
        {otherEvents.length ? (
          <Disclosure
            className="border-b"
            summaryProps={{ className: 'py-2 text-foreground' }}
            summary={<h3 className="inline text-sm font-bold tracking-[0.04em]">其他事件<span className="ml-2 font-mono text-xs font-normal tracking-normal text-muted-foreground tabular-nums">{otherEvents.length} 筆</span></h3>}
          >
            <div className="space-y-3 pb-3">
              <p className="text-[13px] text-muted-foreground">以下事件尚無可支持的台股影響。</p>
              {otherEvents.map((event) => {
                const id = eventCitationId(event.key);
                return (
                  <div key={event.key} data-citation-id={id} data-active={isActive(id)} aria-current={isSelected(id) ? 'true' : undefined} {...previewHandlers(link, id)} className={cn('-mx-1 px-1', activeItem)}>
                    <EventContext event={event} ownerId={id} link={link} />
                  </div>
                );
              })}
            </div>
          </Disclosure>
        ) : null}
      </div>
      {analysis.analyzed_at ? <p className="characteristic mt-3">分析時間：{formatTaipei(analysis.analyzed_at, {})}</p> : null}
    </div>
  );
}
