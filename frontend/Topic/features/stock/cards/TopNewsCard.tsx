import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { useNewsList } from '@/lib/hooks/useNewsList';
import { formatDate } from '@/lib/utils/date';
import { newsHref } from '@/lib/news/newsLinks';
import { impactTarget, visibleImpacts } from '@/lib/utils/newsImpact';
import { ImpactDirectionTag } from '@/features/news/ImpactTag';
import { Badge } from '@/components/ui/badge';
import { Ledger, LightGlyph, NextStep } from '@/components/common/Ledger';
import { EmptyState, LoadingRows, Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/button';
import { NEWS_IMPACT_DISCLAIMER } from '@/lib/disclaimers';

/** 相關新聞帳頁：三則一列（手機單欄），每則是一格有線分隔的條目，結尾一列「更多相關新聞」 */
export function TopNewsCard({ symbol, onOpenDetail }: { symbol: string; onOpenDetail: () => void }) {
  const newsList = useNewsList({ pageSize: 3, fixedStock: symbol, fixedRelation: 'direct', retrieval: true });
  const items = newsList.data?.items ?? [];
  const hasError = !newsList.loading && Boolean(newsList.error);
  const isEmpty = !newsList.loading && !hasError && items.length === 0;

  return (
    <Ledger
      title="相關新聞"
      // 影響標籤是 AI 判讀的事件影響：用一句燈質列文字說明（含免責），不用 AI 圖示或徽章
      stamp={
        <span className="inline-flex items-center gap-1.5">
          <LightGlyph state={newsList.loading ? 'loading' : hasError ? 'error' : 'ready'} />
          <span>
            {newsList.data ? `${newsList.data.total_is_exact === false ? '找到' : '共'} ${newsList.data.total.toLocaleString()} 則 · ` : null}
            {NEWS_IMPACT_DISCLAIMER}
          </span>
        </span>
      }
      cols="grid-cols-1 lg:grid-cols-3"
    >
      {newsList.loading ? (
        <LoadingRows label="載入相關新聞中…" className="h-[132px] bg-card lg:col-span-3" />
      ) : hasError ? (
        <div className="bg-card p-4 sm:p-5 lg:col-span-3">
          <Notice
            tone="danger"
            action={
              <Button size="sm" variant="outline" onClick={newsList.reload} className="min-h-11">
                <RefreshCw aria-hidden />
                重試
              </Button>
            }
          >
            {newsList.error}
          </Notice>
        </div>
      ) : isEmpty ? (
        <EmptyState
          className="bg-card lg:col-span-3"
          action={
            <Button size="sm" variant="outline" onClick={newsList.reload} className="min-h-11">
              <RefreshCw aria-hidden />
              重新整理
            </Button>
          }
        >
          目前沒有直接相關的新聞
        </EmptyState>
      ) : (
        items.map((news) => {
          const impact = visibleImpacts(news, symbol)[0];
          return (
            <Link
              key={news.article_id}
              href={newsHref(news.article_id, symbol)}
              data-stagger
              className="lamp-row flex min-w-0 flex-col gap-2 bg-card px-4 py-4 sm:px-5"
            >
              <span className="line-clamp-2 text-sm leading-6 font-medium">{news.title}</span>
              <span className="flex flex-wrap items-center gap-1.5">
                {impact ? (
                  <ImpactDirectionTag direction={impact.direction}>{impactTarget(impact)} ·</ImpactDirectionTag>
                ) : (
                  <Badge>尚無分析</Badge>
                )}
                {news.pub_time ? <span className="characteristic">{formatDate(news.pub_time)}</span> : null}
              </span>
              {impact?.reason ? (
                <span className="line-clamp-2 border-l-2 border-border pl-2 text-[13px] leading-relaxed text-subtle">
                  <span className="font-medium text-foreground">理由：</span>
                  {impact.reason}
                </span>
              ) : null}
            </Link>
          );
        })
      )}

      <div className="lg:col-span-3">
        <NextStep onClick={onOpenDetail}>更多相關新聞與原文依據</NextStep>
      </div>
    </Ledger>
  );
}
