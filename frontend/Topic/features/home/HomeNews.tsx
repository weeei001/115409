import React, { useRef, useState } from 'react';
import { Newspaper, RefreshCw, Search } from 'lucide-react';
import { useNewsList } from '@/lib/hooks/useNewsList';
import { useHydrated } from '@/lib/hooks/useClientEnv';
import { NewsCard } from '@/features/news/NewsCard';
import { AppliedNewsFilters, NewsFilters, NewsListSkeleton } from '@/features/news/NewsFilters';
import { EmptyState, Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/button';

const PAGE_SIZE = 10;

/** 首頁「最新財經新聞」：關鍵字（純數字視為股票代號）＋發布時間篩選＋分頁 */
export function HomeNews() {
  const newsList = useNewsList({ pageSize: PAGE_SIZE });
  const hydrated = useHydrated();
  const [keyword, setKeyword] = useState('');
  const filterTrigger = useRef<HTMLButtonElement>(null);
  const search = () => newsList.applyFilters({ keyword });
  const { data, totalPages } = newsList;

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Newspaper size={18} className="text-brand" aria-hidden />
          <h2 className="text-lg font-bold tracking-tight">最新財經新聞</h2>
          {data ? <span className="ml-1 text-xs text-muted-foreground tabular-nums">共 {data.total.toLocaleString()} 則</span> : null}
        </div>

        <div className="flex w-full items-center gap-2 sm:w-auto">
          <NewsFilters
            applied={newsList.filters}
            triggerRef={filterTrigger}
            draft={newsList.draft}
            setDraft={newsList.setDraft}
            onApply={search}
            onClearAdvanced={newsList.clearAdvanced}
            disabled={newsList.loading}
          />
          <div className="relative min-w-0 flex-1 sm:w-52 sm:flex-none">
            <Search size={16} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') search();
              }}
              placeholder="股票代號或關鍵字..."
              aria-label="搜尋新聞：股票代號或關鍵字"
              className="h-11 w-full rounded-lg border border-input bg-muted pr-3 pl-9 text-base text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus:border-brand focus:ring-2 focus:ring-brand/25 sm:text-sm"
            />
          </div>
          <button
            type="button"
            onClick={search}
            aria-label="搜尋新聞"
            className="inline-flex size-11 items-center justify-center rounded-lg border text-muted-foreground transition-colors hover:border-border-strong hover:text-brand-text"
          >
            <Search size={18} aria-hidden />
          </button>
        </div>
      </div>

      <AppliedNewsFilters applied={newsList.filters} disabled={newsList.loading} triggerRef={filterTrigger} onClearAdvanced={newsList.clearAdvanced} />

      <div className="min-h-0 flex-1">
        {!hydrated || newsList.loading ? (
          <NewsListSkeleton count={5} />
        ) : newsList.error ? (
          <Notice
            tone="danger"
            action={
              <Button size="sm" variant="outline" onClick={newsList.reload} className="min-h-9">
                <RefreshCw aria-hidden />
                重試載入新聞
              </Button>
            }
          >
            {newsList.error}
          </Notice>
        ) : data?.items.length ? (
          <div>
            {data.items.map((n) => (
              <NewsCard key={n.article_id} news={n} />
            ))}
          </div>
        ) : (
          <EmptyState className="py-8">暫無新聞資料</EmptyState>
        )}
      </div>

      {data && totalPages > 1 ? (
        <div className="mt-3 flex items-center justify-between border-t pt-3">
          <span className="text-xs text-muted-foreground tabular-nums">
            第 {data.page} / {totalPages} 頁
          </span>
          <div className="flex gap-2">
            <Button variant="outline" disabled={newsList.page <= 1} onClick={() => newsList.goToPage(newsList.page - 1)} className="min-h-11 min-w-[4.5rem]">
              上一頁
            </Button>
            <Button variant="outline" disabled={newsList.page >= totalPages} onClick={() => newsList.goToPage(newsList.page + 1)} className="min-h-11 min-w-[4.5rem]">
              下一頁
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
