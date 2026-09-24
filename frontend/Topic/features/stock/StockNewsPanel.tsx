import React from 'react';
import { Info, Newspaper, RefreshCw } from 'lucide-react';
import { useNewsList } from '@/lib/hooks/useNewsList';
import { useHydrated } from '@/lib/hooks/useClientEnv';
import { NewsCard } from '@/features/news/NewsCard';
import { NewsFilters, NewsListSkeleton } from '@/features/news/NewsFilters';
import { EmptyState, Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/button';

const PAGE_SIZE = 8;

/** 「相關新聞」抽屜：股票固定、可依發布時間篩選、分頁 */
export function StockNewsPanel({ symbol }: { symbol: string }) {
  const newsList = useNewsList({ pageSize: PAGE_SIZE, fixedStock: symbol });
  const hydrated = useHydrated();
  const totalPages = newsList.totalPages;

  return (
    <section className="rounded-xl border bg-card p-4 shadow-card sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Newspaper size={18} className="text-brand" aria-hidden />
          <h3 className="text-lg font-bold tracking-tight">相關新聞</h3>
          {newsList.data ? <span className="text-xs text-muted-foreground tabular-nums">共 {newsList.data.total.toLocaleString()} 則</span> : null}
        </div>
        <div className="flex items-center gap-2">
          <NewsFilters
            draft={newsList.draft}
            setDraft={newsList.setDraft}
            onApply={() => newsList.applyFilters()}
            onClearAdvanced={newsList.clearAdvanced}
            disabled={newsList.loading}
          />
          <button
            type="button"
            onClick={newsList.reload}
            disabled={newsList.loading}
            aria-label="重新整理新聞"
            className="inline-flex size-11 items-center justify-center rounded-lg border text-muted-foreground transition-colors hover:border-border-strong hover:text-brand-text disabled:opacity-50"
          >
            <RefreshCw size={16} className={newsList.loading ? 'animate-spin' : ''} aria-hidden />
          </button>
        </div>
      </div>

      <p className="mb-4 flex items-center gap-1.5 rounded-lg bg-muted/60 px-3 py-1.5 text-[11px] text-muted-foreground">
        <Info size={12} className="shrink-0 text-brand" aria-hidden />
        情緒反映新聞訊息，不代表股價預測。
      </p>

      {!hydrated || newsList.loading ? (
        <NewsListSkeleton count={4} />
      ) : newsList.error ? (
        <Notice tone="danger">{newsList.error}</Notice>
      ) : newsList.data?.items.length ? (
        <>
          <div>
            {newsList.data.items.map((n) => (
              <NewsCard key={n.article_id} news={n} targetStock={symbol} />
            ))}
          </div>
          {totalPages > 1 ? (
            <div className="mt-4 flex items-center justify-between border-t pt-3">
              <span className="text-xs text-muted-foreground tabular-nums">
                第 {newsList.page} / {totalPages} 頁
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={newsList.page <= 1} onClick={() => newsList.goToPage(newsList.page - 1)} className="min-h-11">
                  上一頁
                </Button>
                <Button size="sm" variant="outline" disabled={newsList.page >= totalPages} onClick={() => newsList.goToPage(newsList.page + 1)} className="min-h-11">
                  下一頁
                </Button>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState className="py-6">暫無相關新聞</EmptyState>
      )}
    </section>
  );
}
