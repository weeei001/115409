import React, { useRef, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { useNewsList } from '@/lib/hooks/useNewsList';
import { useHydrated } from '@/lib/hooks/useClientEnv';
import { NewsCard } from '@/features/news/NewsCard';
import { AppliedNewsFilters, NewsFilters, NewsListSkeleton } from '@/features/news/NewsFilters';
import { summarizeNewsFilters } from '@/lib/utils/newsFilters';
import { EmptyState, Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/button';

const PAGE_SIZE = 10;

/**
 * 首頁「最新財經新聞」：關鍵字（純數字視為股票代號）＋發布時間篩選＋分頁。
 * 放在觀測台的外框面板（bg-card）裡使用：自帶帳頁式標題（襯線 h2＋則數＋粗線），新聞列用細線分隔，寬版每列 8／4 切。
 */
export function HomeNews() {
  const newsList = useNewsList({ pageSize: PAGE_SIZE });
  const hydrated = useHydrated();
  const [keyword, setKeyword] = useState('');
  const filterTrigger = useRef<HTMLButtonElement>(null);
  const search = () => newsList.applyFilters({ keyword });
  const { data, totalPages } = newsList;
  const hasAdvanced = summarizeNewsFilters(newsList.filters).length > 0;
  const hasKeyword = Boolean(newsList.filters.keyword?.trim());
  const clearKeyword = () => {
    setKeyword('');
    newsList.applyFilters({ keyword: '' });
  };

  return (
    <section aria-labelledby="home-news-heading" className="flex h-full flex-col">
      {/* 帳頁標題：襯線 h2＋右側燈質列（則數）＋一條粗線，與「觀測台以外」同一套語法 */}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-b border-border-strong pb-2">
        <h2 id="home-news-heading" className="font-serif text-xl leading-snug font-black tracking-[0.06em]">最新財經新聞</h2>
        {data ? <span className="characteristic">共 {data.total.toLocaleString()} 則</span> : null}
      </div>

      <div className="mt-3 mb-3 flex justify-end">
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
              className="h-11 w-full rounded-sm border border-input bg-card pr-3 pl-9 text-base text-foreground outline-none transition-colors duration-(--dur-flash) placeholder:text-muted-foreground hover:border-border-strong focus:border-border-strong focus-lamp sm:text-sm"
            />
          </div>
          <Button type="button" variant="outline" size="icon" onClick={search} aria-label="搜尋新聞" className="text-muted-foreground hover:text-foreground">
            <Search size={18} aria-hidden />
          </Button>
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
              <Button variant="outline" onClick={newsList.reload}>
                <RefreshCw aria-hidden />
                重試載入新聞
              </Button>
            }
          >
            {newsList.error}
          </Notice>
        ) : data?.items.length ? (
          <div className="border-t">
            {data.items.map((n) => (
              <NewsCard key={n.article_id} news={n} layout="ledger" />
            ))}
          </div>
        ) : (
          <EmptyState
            className="border-t py-10"
            action={
              hasAdvanced ? (
                <Button variant="outline" onClick={newsList.clearAdvanced}>清除篩選條件</Button>
              ) : hasKeyword ? (
                <Button variant="outline" onClick={clearKeyword}>清除關鍵字</Button>
              ) : undefined
            }
          >
            {hasAdvanced || hasKeyword ? '找不到符合條件的新聞。' : '暫無新聞資料。'}
          </EmptyState>
        )}
      </div>

      {data && totalPages > 1 ? (
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t pt-3">
          {/* 直接跳頁：輸入頁碼後按「前往」或 Enter；超出範圍會落在第一頁或最後一頁 */}
          <form
            key={data.page}
            onSubmit={(event) => {
              event.preventDefault();
              const value = Number(new FormData(event.currentTarget).get('page'));
              if (!Number.isFinite(value)) return;
              const target = Math.min(Math.max(1, Math.trunc(value)), totalPages);
              if (target !== newsList.page) newsList.goToPage(target);
            }}
            className="flex items-center gap-2"
          >
            <label htmlFor="home-news-page" className="characteristic">第</label>
            <input
              id="home-news-page"
              name="page"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              defaultValue={data.page}
              aria-label={`頁碼，共 ${totalPages.toLocaleString()} 頁`}
              className="h-11 w-20 rounded-sm border border-input bg-card px-2 text-center font-mono text-base tabular-nums text-foreground outline-none transition-colors duration-(--dur-flash) hover:border-border-strong focus:border-border-strong focus-lamp sm:text-sm"
            />
            <span className="characteristic">/ {totalPages.toLocaleString()} 頁</span>
            <Button type="submit" variant="outline" size="sm" disabled={newsList.loading}>前往</Button>
          </form>
          <div className="flex gap-2">
            <Button variant="outline" disabled={newsList.page <= 1} onClick={() => newsList.goToPage(newsList.page - 1)} className="min-w-[4.5rem]">
              上一頁
            </Button>
            <Button variant="outline" disabled={newsList.page >= totalPages} onClick={() => newsList.goToPage(newsList.page + 1)} className="min-w-[4.5rem]">
              下一頁
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
