import React, { memo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ChevronDown, Clock, ExternalLink, Quote, Tag } from 'lucide-react';
import type { News } from '@/lib/types/api';
import { formatTime } from '@/lib/utils/date';
import { getStockDisplayName } from '@/lib/utils/symbolNames';
import { safeHttpUrl } from '@/lib/utils/url';
import { newsHref, parseRelatedStocks, sentimentMeta, stripHtml } from '@/lib/news/sentiment';
import { cn } from '@/lib/cn';

interface Props {
  news: News;
  /** 指定股票時只顯示該股的情緒與理由 */
  targetStock?: string;
}

function snippet(content: string | null, maxLen = 120): string {
  if (!content) return '';
  const plain = stripHtml(content).replace(/\s+/g, ' ').trim();
  return plain.length > maxLen ? `${plain.slice(0, maxLen)}…` : plain;
}

function SentimentBadge({ stockId, label }: { stockId: string; label: string }) {
  const meta = sentimentMeta(label);
  return (
    <span className={cn('inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium', meta.badge)}>
      {getStockDisplayName(stockId)} ｜ {meta.label}
    </span>
  );
}

export const NewsCard = memo(function NewsCard({ news, targetStock }: Props) {
  const [expanded, setExpanded] = useState(false);
  const stocks = parseRelatedStocks(news).slice(0, 3);
  const hasContent = Boolean(news.content?.trim());
  const originUrl = safeHttpUrl(news.url);
  const panelId = `news-content-${news.article_id}`;
  const sentiment = targetStock ? news.sentiments?.find((s) => s.target_stock_id === targetStock) : undefined;
  const href = newsHref(news.article_id, targetStock);

  return (
    <article className="group relative border-b py-4 pl-4 last:border-b-0 first:pt-0">
      <span className="absolute top-4 bottom-4 left-0 w-0.5 rounded-full bg-gradient-to-b from-brand to-brand-light opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            {stocks.map((s) => (
              <span key={s} className="inline-flex items-center gap-0.5 rounded bg-accent px-1.5 py-0.5 font-mono text-[11px] font-medium text-accent-foreground">
                <Tag size={10} aria-hidden />
                {s}
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

          {targetStock ? (
            sentiment ? (
              <div className="my-2 rounded-lg border bg-muted/60 p-2.5 text-xs">
                <SentimentBadge stockId={sentiment.target_stock_id} label={sentiment.label} />
                <p className="mt-1 text-[11px] leading-relaxed text-subtle">
                  <span className="font-medium text-foreground">理由：</span>
                  {sentiment.reason}
                </p>
                {expanded && sentiment.evidence?.length ? (
                  <div className="mt-2 space-y-1.5 border-t pt-2">
                    <p className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                      <Quote size={11} className="text-brand" aria-hidden />
                      原文依據：
                    </p>
                    {sentiment.evidence.map((ev, i) => (
                      <p key={i} className="border-l-2 border-brand/50 pl-2 text-[11px] leading-snug text-subtle">
                        <span className="mr-1.5 font-mono text-[11px] text-muted-foreground">[{ev.field === 'title' ? '標題' : '內文'}]</span>
                        「{ev.quote}」
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="my-1.5">
                <span className="inline-flex items-center rounded border bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {getStockDisplayName(targetStock)} ｜ 尚無分析結果
                </span>
              </p>
            )
          ) : news.sentiments?.length ? (
            <div className="my-1.5 flex flex-wrap items-center gap-1.5">
              {news.sentiments.map((s) => (
                <SentimentBadge key={s.target_stock_id} stockId={s.target_stock_id} label={s.label} />
              ))}
            </div>
          ) : null}

          {!expanded && snippet(news.content) ? (
            <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{snippet(news.content)}</p>
          ) : null}
          {hasContent && expanded ? (
            <p id={panelId} className="mt-1 text-xs leading-relaxed whitespace-pre-line text-subtle">
              {stripHtml(news.content ?? '').trim()}
            </p>
          ) : null}

          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
            <Link href={href} className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-text hover:underline">
              查看新聞全文與 AI 情緒分析
              <ArrowUpRight size={12} aria-hidden />
            </Link>
            {originUrl ? (
              <a href={originUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-brand-text hover:underline">
                原始新聞來源
                <ExternalLink size={11} aria-hidden />
              </a>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-center gap-1 pt-1">
          {hasContent ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              aria-controls={panelId}
              aria-label={expanded ? '收合新聞內文' : '展開新聞內文'}
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
              aria-label={`開啟原文：${news.title ?? '新聞'}（新分頁）`}
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
