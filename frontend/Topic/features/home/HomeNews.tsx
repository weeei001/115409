import { useRef, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { useNewsList } from '@/lib/hooks/useNewsList';
import { useHydrated } from '@/lib/hooks/useClientEnv';
import { NewsCard } from '@/features/news/NewsCard';
import { AppliedNewsFilters, NewsFilters, NewsListSkeleton } from '@/features/news/NewsFilters';
import { summarizeNewsFilters } from '@/lib/utils/newsFilters';
import { EmptyState, Notice } from '@/components/common/Notice';
import { Pagination } from '@/components/common/Pagination';
import { LedgerHeading } from '@/components/common/Ledger';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/input';
import { cn } from '@/lib/cn';

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
      <LedgerHeading title="最新財經新聞" headingProps={{ id: 'home-news-heading' }} stamp={data ? `共 ${data.total.toLocaleString()} 則` : null} />

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
              placeholder="股票代號或關鍵字…"
              aria-label="搜尋新聞：股票代號或關鍵字"
              className={cn(inputClass, 'pr-3 pl-9')}
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
        // 直接跳頁：輸入頁碼後按「前往」或 Enter；超出範圍會落在第一頁或最後一頁
        <Pagination
          jump
          label="新聞分頁"
          className="mt-1 border-t pt-3"
          page={newsList.page}
          totalPages={totalPages}
          disabled={newsList.loading}
          onPageChange={newsList.goToPage}
        />
      ) : null}
    </section>
  );
}
