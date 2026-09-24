import React, { useState } from 'react';
import { Newspaper, RefreshCw, Info } from 'lucide-react';
import { useNewsList } from '../../lib/hooks/useNewsList';
import { useHydrated } from '../../lib/useHydrated';
import { NewsCard } from '../NewsCard';
import { NewsListSkeleton } from '../news/NewsListSkeleton';

interface Props {
  symbol: string;
}

const PAGE_SIZE = 8;

export const StockNewsPanel: React.FC<Props> = ({ symbol }) => {
  const [relation, setRelation] = useState<'direct' | 'industry_context' | 'market_context'>('direct');
  const newsList = useNewsList({ pageSize: PAGE_SIZE, fixedStock: symbol, fixedRelation: relation, retrieval: true });
  const hydrated = useHydrated();

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Newspaper size={18} className="text-brand" aria-hidden />
          <h2 className="text-lg font-bold tracking-tight">相關新聞</h2>
          {newsList.data ? (
            <span className="text-xs text-[var(--color-text-muted)] tabular-nums">
              共 {newsList.data.total.toLocaleString()} 則候選
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
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

      <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)] bg-[var(--color-bg-elevated)]/60 px-3 py-1.5 rounded-lg mb-4">
        <Info size={12} className="text-brand shrink-0" aria-hidden />
        <span>以公司名稱、代號與語意檢索新聞；產業與大盤消息僅提供背景。</span>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <div className="flex gap-1.5 flex-wrap" role="group" aria-label="新聞關聯範圍">
          {([
            ['direct', '公司新聞'], ['industry_context', '產業背景'], ['market_context', '大盤背景'],
          ] as const).map(([value, label]) => (
            <button key={value} type="button" onClick={() => setRelation(value)} aria-pressed={relation === value}
              className={`min-h-[36px] rounded-lg border px-3 py-1.5 text-xs ${relation === value ? 'border-brand bg-brand/10 text-brand font-semibold' : 'border-[var(--color-border)] text-[var(--color-text-secondary)]'}`}>
              {label}
            </button>
          ))}
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
                key={n.article_id}
                news={n}
                index={i}
                targetStock={symbol}
                relation={relation}
              />
            ))}
          </div>

        </>
      ) : (
        <p className="text-sm text-[var(--color-text-muted)] py-6 text-center">暫無相關新聞</p>
      )}
    </section>
  );
};
