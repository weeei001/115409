import React, { memo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ChevronDown, Clock, ExternalLink, Quote, Tag } from 'lucide-react';
import type { News, NewsImpact } from '@/lib/types/api';
import { formatTime } from '@/lib/utils/date';
import { formatStockLabel } from '@/lib/utils/symbolNames';
import { newsHref, parseRelatedStocks, stripHtml } from '@/lib/news/sentiment';
import {
  DIRECTION_CLASSES,
  DIRECTION_LABELS,
  IMPORTANCE_LABELS,
  impactTarget,
  visibleImpacts,
} from '@/lib/utils/newsImpact';
import { safeHttpUrl } from '@/lib/utils/url';
import { cn } from '@/lib/cn';

export type NewsRelation = 'direct' | 'market_context' | 'industry_context';

interface Props {
  news: News;
  targetStock?: string;
  relation?: NewsRelation;
}

function snippet(content: string | null, maxLen = 120): string {
  if (!content) return '';
  const plain = stripHtml(content).replace(/\s+/g, ' ').trim();
  return plain.length > maxLen ? `${plain.slice(0, maxLen)}…` : plain;
}

function impactLabel(impact: NewsImpact): string {
  return impact.target_name || (impact.target_type === 'company' ? impact.target_id : impactTarget(impact));
}

function ImpactBadge({ impact }: { impact: NewsImpact }) {
  return (
    <span className={cn('inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium', DIRECTION_CLASSES[impact.direction])}>
      {impactLabel(impact)} · {DIRECTION_LABELS[impact.direction]} · {IMPORTANCE_LABELS[impact.importance]}
    </span>
  );
}

export const NewsCard = memo(function NewsCard({ news, targetStock, relation = 'direct' }: Props) {
  const [expanded, setExpanded] = useState(false);
  const sourceStatus = news.source_state?.status;
  const sourceLabel = sourceStatus === 'conflict' ? '來源版本衝突，尚未確認有效內容'
    : sourceStatus === 'superseded' ? '已被同來源其他版本取代'
      : sourceStatus === 'historical' ? '保存的歷史原文，並非現行版本' : null;
  const stocks = Array.from(
    new Set([
      ...(!sourceLabel && news.event_analysis?.status === 'success'
        ? news.event_analysis.impacts.filter((impact) => impact.target_type === 'company').map((impact) => impact.target_id)
        : []),
      ...parseRelatedStocks(news),
    ]),
  ).slice(0, 3);
  const hasContent = Boolean(news.content?.trim());
  const originUrl = safeHttpUrl(news.url);
  const panelId = `news-content-${news.article_id}`;
  const impacts = sourceLabel ? [] : visibleImpacts(news, targetStock, relation);
  const allImpacts = sourceLabel ? [] : visibleImpacts(news).slice(0, 3);
  const baseHref = newsHref(news.article_id, targetStock);
  const href = sourceStatus === 'historical' && /^[0-9a-f]{64}$/.test(news.source_state?.revision_id ?? '')
    ? `${baseHref}${baseHref.includes('?') ? '&' : '?'}revision_id=${news.source_state!.revision_id}` : baseHref;

  return (
    <article className="group relative border-b py-4 pl-4 last:border-b-0 first:pt-0">
      <span className="absolute top-4 bottom-4 left-0 w-0.5 rounded-full bg-gradient-to-b from-brand to-brand-light opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            {stocks.map((stock) => (
              <span key={stock} className="inline-flex items-center gap-0.5 rounded bg-accent px-1.5 py-0.5 font-mono text-[11px] font-medium text-accent-foreground">
                <Tag size={10} aria-hidden />
                {formatStockLabel(stock)}
              </span>
            ))}
            {news.pub_time ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Clock size={11} aria-hidden />
                {formatTime(news.pub_time)}
              </span>
            ) : null}
          </div>

          <h3 className="mb-1 line-clamp-2 text-sm leading-snug font-semibold transition-colors group-hover:text-brand-text">
            <Link href={href} className="hover:underline">
              {news.title}
            </Link>
          </h3>
          {sourceLabel ? <p className="mb-1 text-xs font-medium text-muted-foreground">{sourceLabel}；不套用現行 AI 影響。</p> : null}
          {news.event_analysis?.content_truncated ? (
            <p className="text-xs text-muted-foreground">分析僅使用部分內文，可能未涵蓋後段資訊。</p>
          ) : null}

          {targetStock ? (
            <div className="my-2 rounded-lg border bg-muted/60 p-2.5 text-xs">
              {impacts.length ? (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {impacts.slice(0, 3).map((impact) => <ImpactBadge key={`${impact.event_key}:${impact.target_id}`} impact={impact} />)}
                  </div>
                  {impacts[0]?.reason ? <p className="mt-1 text-[11px] leading-relaxed text-subtle"><span className="font-medium text-foreground">理由：</span>{impacts[0].reason}</p> : null}
                </>
              ) : (
                <span className="inline-flex items-center rounded border bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {formatStockLabel(targetStock)} · 尚無事件影響分析
                </span>
              )}
              {expanded && impacts.some((impact) => impact.evidence?.length) ? (
                <div className="mt-2 space-y-1.5 border-t pt-2">
                  <p className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                    <Quote size={11} className="text-brand" aria-hidden />
                    原文依據
                  </p>
                  {impacts.flatMap((impact) => impact.evidence ?? []).map((ev, i) => (
                    <p key={i} className="border-l-2 border-brand/50 pl-2 text-[11px] leading-snug text-subtle">
                      <span className="mr-1.5 font-mono text-[11px] text-muted-foreground">[{ev.field === 'title' ? '標題' : '內文'}]</span>
                      「{ev.quote}」
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : allImpacts.length ? (
            <div className="my-1.5 flex flex-wrap items-center gap-1.5">
              {allImpacts.map((impact) => <ImpactBadge key={`${impact.event_key}:${impact.target_id}`} impact={impact} />)}
            </div>
          ) : null}

          {!expanded && snippet(news.content) ? <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{snippet(news.content)}</p> : null}
          {hasContent && expanded ? <p id={panelId} className="mt-1 text-xs leading-relaxed whitespace-pre-line text-subtle">{stripHtml(news.content ?? '').trim()}</p> : null}

          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
            <Link href={href} className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-text hover:underline">
              {sourceLabel ? '查看原文與版本狀態' : '查看事件影響分析'}
              <ArrowUpRight size={12} aria-hidden />
            </Link>
            {originUrl ? (
              <a href={originUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-brand-text hover:underline">
                查看原始來源
                <ExternalLink size={11} aria-hidden />
              </a>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-center gap-1 pt-1">
          {hasContent ? (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
              aria-controls={panelId}
              aria-label={expanded ? '收起新聞內文' : '展開新聞內文'}
              className="flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-subtle"
            >
              <ChevronDown size={16} aria-hidden className={cn('transition-transform', expanded && 'rotate-180')} />
            </button>
          ) : null}
          {originUrl ? (
            <a
              href={originUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`開啟原始來源：${news.title ?? '新聞'}`}
              className="flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-brand-text"
            >
              <ExternalLink size={16} aria-hidden />
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
});
