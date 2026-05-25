import React from 'react';
import { Newspaper } from 'lucide-react';
import { useNewsList } from '../../../lib/hooks/useNewsList';
import { BentoActionButton } from './BentoActionButton';

interface Props {
  symbol: string;
  onOpenDetail: () => void;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export const TopNewsCard: React.FC<Props> = ({ symbol, onOpenDetail }) => {
  const newsList = useNewsList({ pageSize: 3, fixedStock: symbol });
  const items = newsList.data?.items ?? [];

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] shadow-[var(--shadow-card)] p-4 sm:p-5 flex flex-col gap-3 h-full min-h-[260px]">
      <div className="flex items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-text-primary)]">
          <Newspaper size={16} className="text-brand" aria-hidden />
          最新新聞
        </h3>
        {newsList.data ? (
          <span className="text-[11px] text-[var(--color-text-muted)] tabular-nums">
            共 {newsList.data.total.toLocaleString()} 則
          </span>
        ) : null}
      </div>

      {newsList.loading ? (
        <div className="space-y-2 flex-1" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 rounded-lg bg-[var(--color-bg-elevated)] animate-pulse" />
          ))}
        </div>
      ) : newsList.error ? (
        <p className="flex-1 flex items-center justify-center text-xs text-up-emphasis text-center">
          {newsList.error}
        </p>
      ) : items.length === 0 ? (
        <p className="flex-1 flex items-center justify-center text-xs text-[var(--color-text-muted)]">
          暫無相關新聞
        </p>
      ) : (
        <ul className="flex-1 flex flex-col gap-2">
          {items.map((news) => {
            const date = formatDate(news.publish_time);
            const linkable = Boolean(news.url);
            const content = (
              <>
                <p className="text-xs leading-snug text-[var(--color-text-primary)] line-clamp-2 group-hover:text-brand transition-colors">
                  {news.title}
                </p>
                {date ? (
                  <p className="mt-1 text-[10px] text-[var(--color-text-muted)] tabular-nums">{date}</p>
                ) : null}
              </>
            );
            return (
              <li
                key={news.id}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/50 px-3 py-2"
              >
                {linkable ? (
                  <a
                    href={news.url ?? '#'}
                    target="_blank"
                    rel="noreferrer"
                    className="group block focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded"
                  >
                    {content}
                  </a>
                ) : (
                  <div className="group">{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <BentoActionButton label="全部新聞" onClick={onOpenDetail} />
    </div>
  );
};
