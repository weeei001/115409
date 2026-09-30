import React from 'react';
import Link from 'next/link';
import { ChevronRight, Newspaper, Sparkles } from 'lucide-react';
import { useNewsList } from '@/lib/hooks/useNewsList';
import { formatDate } from '@/lib/utils/date';
import { newsHref } from '@/lib/news/sentiment';
import { DIRECTION_CLASSES, DIRECTION_LABELS, impactTarget, visibleImpacts } from '@/lib/utils/newsImpact';
import { CardShell } from './CardShell';
import { cn } from '@/lib/cn';

export function TopNewsCard({ symbol, onOpenDetail }: { symbol: string; onOpenDetail: () => void }) {
  const newsList = useNewsList({ pageSize: 3, fixedStock: symbol, fixedRelation: 'direct', retrieval: true });
  const items = newsList.data?.items ?? [];
  const hasError = !newsList.loading && Boolean(newsList.error);

  return (
    <CardShell
      icon={Newspaper}
      title="相關新聞"
      rightSlot={
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1 rounded-full border border-brand/20 bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-foreground sm:inline-flex">
            <Sparkles size={10} aria-hidden />
            AI 事件影響
          </span>
          {newsList.data ? <span className="text-[11px] text-muted-foreground tabular-nums">檢索結果 {newsList.data.total.toLocaleString()} 則</span> : null}
        </div>
      }
      loading={newsList.loading}
      isEmpty={!newsList.loading && !hasError && items.length === 0}
      emptyText="暫無相關新聞"
      action={{ label: '更多相關新聞', onClick: onOpenDetail }}
      className="min-h-0"
    >
      {hasError ? (
        <p className="flex flex-1 items-center justify-center text-center text-xs text-danger">{newsList.error}</p>
      ) : (
        <div className="flex flex-1 flex-col justify-between">
          <ul className="grid gap-2 lg:grid-cols-3">
            {items.map((news) => {
              const impact = visibleImpacts(news, symbol)[0];
              return (
                <li key={news.article_id} className="rounded-lg border bg-muted/50 px-3 py-2 transition-colors hover:border-border-strong">
                  <Link href={newsHref(news.article_id, symbol)} className="group block rounded">
                    <p className="line-clamp-2 text-xs leading-snug transition-colors group-hover:text-brand-text">{news.title}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className={cn('inline-flex rounded border px-1.5 py-0.5 text-[11px] font-medium', impact ? DIRECTION_CLASSES[impact.direction] : 'border-border bg-muted text-muted-foreground')}>
                        {impact ? `${impactTarget(impact)} · ${DIRECTION_LABELS[impact.direction]}` : '尚無分析'}
                      </span>
                      {news.pub_time ? <span className="text-[11px] text-muted-foreground tabular-nums">{formatDate(news.pub_time)}</span> : null}
                    </div>
                    {impact?.reason ? (
                      <p className="mt-1.5 line-clamp-1 rounded border bg-card/90 px-2 py-1 text-[11px] text-subtle">
                        <span className="font-medium text-foreground">理由：</span>
                        {impact.reason}
                      </p>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-2.5">
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Sparkles size={11} className="shrink-0 text-brand" aria-hidden />
              事件影響反映新聞訊息，不代表股價預測
            </span>
            <button type="button" onClick={onOpenDetail} className="inline-flex min-h-8 items-center gap-0.5 text-[11px] font-medium text-brand-text hover:underline">
              開啟相關新聞抽屜查看原文依據
              <ChevronRight size={12} aria-hidden />
            </button>
          </div>
        </div>
      )}
    </CardShell>
  );
}
