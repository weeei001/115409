import React from 'react';
import { Newspaper, RefreshCw } from 'lucide-react';
import { useNewsList } from '../../lib/hooks/useNewsList';
import { useHydrated } from '../../lib/useHydrated';
import { NewsCard } from '../NewsCard';
import { NewsAdvancedFilters } from '../news/NewsAdvancedFilters';
import { NewsListSkeleton } from '../news/NewsListSkeleton';

interface Props {
  symbol: string;
}

const PAGE_SIZE = 8;

export const StockNewsPanel: React.FC<Props> = ({ symbol }) => {
  const newsList = useNewsList({ pageSize: PAGE_SIZE, fixedStock: symbol });
  const hydrated = useHydrated();

  const totalPages = newsList.data ? Math.max(1, Math.ceil(newsList.data.total / PAGE_SIZE)) : 1;

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Newspaper size={18} className="text-brand" aria-hidden />
          <h2 className="text-lg font-bold tracking-tight">相關新聞</h2>
          {newsList.data ? (
            <span className="text-xs text-[var(--color-text-muted)] tabular-nums">
              共 {newsList.data.total.toLocaleString()} 則
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <NewsAdvancedFilters
            layout="toolbar"
            draft={newsList.draft}
            setDraft={newsList.setDraft}
            onApply={newsList.applyFilters}
            onClearAdvanced={newsList.clearAdvanced}
            disabled={newsList.loading}
          />
          <button
            type="button"
            onClick={newsList.reload}
            disabled={newsList.loading}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-brand hover:border-brand/40 transition-colors disabled:opacity-50"
            aria-label="重新整理新聞"
          >
            <RefreshCw size={16} className={newsList.loading ? 'animate-spin' : ''} aria-hidden />
          </button>
        </div>
      </div>

      {!hydrated || newsList.loading ? (
        <NewsListSkeleton count={4} />
      ) : newsList.error ? (
        <p className="text-sm text-up py-4 text-center">{newsList.error}</p>
      ) : newsList.data && newsList.data.items.length > 0 ? (
        <>
          <div>
            {newsList.data.items.map((n, i) => (
              <NewsCard
                key={n.id}
                news={n}
                index={i}
              />
            ))}
          </div>
          {totalPages > 1 ? (
            <div className="mt-4 flex items-center justify-between border-t border-[var(--color-border)] pt-3">
              <span className="text-xs text-[var(--color-text-muted)] tabular-nums">
                第 {newsList.page} / {totalPages} 頁
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={newsList.page <= 1}
                  onClick={() => newsList.goToPage(newsList.page - 1)}
                  className="min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--color-border)] disabled:opacity-50"
                >
                  上一頁
                </button>
                <button
                  type="button"
                  disabled={newsList.page >= totalPages}
                  onClick={() => newsList.goToPage(newsList.page + 1)}
                  className="min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--color-border)] disabled:opacity-50"
                >
                  下一頁
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-[var(--color-text-muted)] py-6 text-center">暫無相關新聞</p>
      )}
    </section>
  );
};
