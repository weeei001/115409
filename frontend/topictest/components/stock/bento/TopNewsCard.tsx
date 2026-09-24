import React from 'react';
import Link from 'next/link';
import { Newspaper, Sparkles, ChevronRight } from 'lucide-react';
import { useNewsList } from '../../../lib/hooks/useNewsList';
import { parseNewsDate } from '../../../lib/utils/date';
import { BentoCardShell } from './BentoCardShell';
import { DIRECTION_CLASSES, DIRECTION_LABELS, visibleImpacts } from '../../../lib/utils/newsImpact';

interface Props {
  symbol: string;
  onOpenDetail: () => void;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  const d = parseNewsDate(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export const TopNewsCard: React.FC<Props> = ({ symbol, onOpenDetail }) => {
  const newsList = useNewsList({ pageSize: 3, fixedStock: symbol, fixedRelation: 'direct', retrieval: true });
  const items = newsList.data?.items ?? [];
  const hasError = !newsList.loading && Boolean(newsList.error);
  const isEmpty = !newsList.loading && !hasError && items.length === 0;

  return (
    <BentoCardShell
      icon={Newspaper}
      title="最新新聞"
      rightSlot={
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-medium text-brand bg-brand/10 border border-brand/20 px-2 py-0.5 rounded-full">
            <Sparkles size={10} aria-hidden />
            AI 事件影響
          </span>
          {newsList.data ? (
            <span className="text-[11px] text-[var(--color-text-muted)] tabular-nums">
              共 {newsList.data.total.toLocaleString()} 則
            </span>
          ) : null}
        </div>
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
        <div className="flex-1 flex flex-col justify-between">
          <ul className="flex flex-col gap-2">
            {items.map((news) => {
              const date = formatDate(news.pub_time);
              const impact = visibleImpacts(news, symbol)[0];
              const badge = impact ? { text: DIRECTION_LABELS[impact.direction], cls: DIRECTION_CLASSES[impact.direction] } : null;

              const content = (
                <>
                  <p className="text-xs leading-snug text-[var(--color-text-primary)] line-clamp-2 group-hover:text-brand transition-colors">
                    {news.title}
                  </p>
                  <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                    {badge ? (
                      <span className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border ${badge.cls}`}>
                        {badge.text}
                      </span>
                    ) : (
                      <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border text-zinc-400 bg-zinc-500/10 border-zinc-500/20">
                        {news.event_analysis.status === 'success' ? '未確認直接影響' :
                          news.event_analysis.status === 'failed' ? '分析失敗' :
                            news.event_analysis.status === 'skipped' ? '資料無法分析' : '尚待分析'}
                      </span>
                    )}
                    {date ? (
                      <p className="text-[10px] text-[var(--color-text-muted)] tabular-nums">{date}</p>
                    ) : null}
                  </div>
                  {impact?.reason ? (
                    <div className="mt-1.5 text-[11px] text-[var(--color-text-secondary)] line-clamp-1 bg-[var(--color-bg-card)]/90 px-2 py-1 rounded border border-[var(--color-border)]/60">
                      <span className="text-[var(--color-text-primary)] font-medium">理由：</span>
                      {impact.reason}
                    </div>
                  ) : null}
                </>
              );

              return (
                <li
                  key={news.article_id}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/50 px-3 py-2 hover:border-brand/40 transition-colors"
                >
                  <Link
                    href={`/news/${encodeURIComponent(news.article_id)}?stock=${symbol}`}
                    className="group block focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded"
                  >
                    {content}
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="mt-3 pt-2.5 border-t border-[var(--color-border)]/50 flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[10px] text-[var(--color-text-muted)] flex items-center gap-1">
              <Sparkles size={11} className="text-brand shrink-0" aria-hidden />
              新聞影響判讀不代表股價預測
            </span>
            <button
              type="button"
              onClick={onOpenDetail}
              className="inline-flex items-center gap-0.5 text-[11px] text-brand font-medium hover:underline cursor-pointer"
            >
              開啟相關新聞抽屜查看原文依據
              <ChevronRight size={12} aria-hidden />
            </button>
          </div>
        </div>
      )}
    </BentoCardShell>
  );
};
