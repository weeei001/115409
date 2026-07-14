import React from 'react';
import { Newspaper } from 'lucide-react';
import { useNewsList } from '../../../lib/hooks/useNewsList';
import { BentoCardShell } from './BentoCardShell';

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
  const hasError = !newsList.loading && Boolean(newsList.error);
  const isEmpty = !newsList.loading && !hasError && items.length === 0;

  return (
    <BentoCardShell
      icon={Newspaper}
      title="最新新聞"
      rightSlot={
        newsList.data ? (
          <span className="text-[11px] text-[var(--color-text-muted)] tabular-nums">
            共 {newsList.data.total.toLocaleString()} 則
          </span>
        ) : null
      }
      loading={newsList.loading}
      isEmpty={isEmpty}
      emptyText="暫無相關新聞"
      action={{ label: '全部新聞', onClick: onOpenDetail }}
    >
      {hasError ? (
        <p className="flex-1 flex items-center justify-center text-xs text-up-emphasis text-center">
          {newsList.error}
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
    </BentoCardShell>
  );
};
