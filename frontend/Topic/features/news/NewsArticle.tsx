import React, { useMemo } from 'react';
import Link from 'next/link';
import { Clock, ExternalLink, Newspaper, Tag } from 'lucide-react';
import type { News } from '@/lib/types/api';
import { splitHighlightedParagraphs } from '@/lib/news/highlight';
import { formatDateTime } from '@/lib/utils/date';
import { formatStockLabel } from '@/lib/utils/symbolNames';
import { safeHttpUrl } from '@/lib/utils/url';
import { cn } from '@/lib/cn';

interface Props {
  news: News;
  stockCodes: string[];
  selectedStock: string;
  /** 目前選取股票的 AI 引用句，用來高亮內文 */
  quotes: string[];
}

/** 新聞內容頁左欄：關聯股票、來源、時間、標題、原始連結、內文 */
export function NewsArticle({ news, stockCodes, selectedStock, quotes }: Props) {
  const paragraphs = useMemo(() => splitHighlightedParagraphs(news.content, quotes), [news.content, quotes]);
  const originalLink = safeHttpUrl(news.url);

  return (
    <article className="rounded-xl border bg-card p-5 shadow-card sm:p-8 lg:col-span-8">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {stockCodes.map((code) => {
          const current = code === selectedStock;
          return (
            <Link
              key={code}
              href={`/stock/${code}`}
              aria-current={current ? 'true' : undefined}
              className={cn(
                'inline-flex min-h-11 items-center gap-1 rounded-md border px-2 py-0.5 font-mono sm:min-h-7 text-xs font-medium transition-colors',
                current ? 'border-brand/40 bg-accent text-accent-foreground' : 'bg-muted text-subtle hover:border-border-strong',
              )}
            >
              <Tag size={11} aria-hidden />
              {formatStockLabel(code)}
            </Link>
          );
        })}
        {news.source ? (
          <span className="inline-flex items-center gap-1 rounded-md border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            <Newspaper size={11} aria-hidden />
            {news.source.toUpperCase()}
          </span>
        ) : null}
        {news.pub_time ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
            <Clock size={11} aria-hidden />
            {formatDateTime(news.pub_time)}
          </span>
        ) : null}
      </div>

      <h2 className="mb-4 text-xl leading-snug font-bold text-balance sm:text-2xl">{news.title}</h2>

      {originalLink ? (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/60 p-3">
          <p className="text-xs text-subtle">本文由第三方媒體報導，點擊右側按鈕可查看原始發布報導。</p>
          <a
            href={originalLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-brand/40 bg-accent px-3.5 py-1.5 text-xs font-medium text-accent-foreground transition-colors hover:border-brand"
          >
            前往原始新聞來源
            <ExternalLink size={13} aria-hidden />
          </a>
        </div>
      ) : null}

      <div className="border-t pt-6">
        {news.content ? (
          paragraphs.map((segments, i) => (
            <p key={i} className="mb-4 text-sm leading-relaxed text-subtle sm:text-base">
              {segments.map((seg, j) =>
                seg.quote ? (
                  <mark
                    key={j}
                    title="AI 情緒分析原文引用依據"
                    className="rounded border-b border-brand/60 bg-brand/15 px-1 py-0.5 font-medium text-foreground"
                  >
                    {seg.text}
                  </mark>
                ) : (
                  <React.Fragment key={j}>{seg.text}</React.Fragment>
                ),
              )}
            </p>
          ))
        ) : (
          <p className="text-sm text-muted-foreground italic">此新聞無內文記錄。</p>
        )}
      </div>
    </article>
  );
}
