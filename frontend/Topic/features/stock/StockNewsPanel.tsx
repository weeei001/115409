import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { Info, RefreshCw } from 'lucide-react';
import { useNewsList } from '@/lib/hooks/useNewsList';
import { useHydrated } from '@/lib/hooks/useClientEnv';
import { NewsCard, type NewsRelation } from '@/features/news/NewsCard';
import { AppliedNewsFilters, NewsFilters, NewsListSkeleton } from '@/features/news/NewsFilters';
import { EmptyState, Notice } from '@/components/common/Notice';
import { LightGlyph } from '@/components/common/Ledger';
import { Button } from '@/components/ui/button';
import { toggleVariants } from '@/components/ui/toggle';
import { cn } from '@/lib/cn';
import { summarizeNewsFilters } from '@/lib/utils/newsFilters';
import { RELATION_HINTS } from '@/lib/utils/newsImpact';
import { NEWS_IMPACT_DISCLAIMER } from '@/lib/disclaimers';
import { loadStockNewsPosition, saveStockNewsPosition, stockNewsViewHref, type StockNewsView } from '@/lib/news/stockNewsView';

const PAGE_SIZE = 8;

/** 「相關新聞」抽屜：股票固定、可依發布時間篩選、分頁 */
export function StockNewsPanel({ symbol, initialView }: { symbol: string; initialView?: StockNewsView }) {
  const router = useRouter();
  const sectionRef = useRef<HTMLElement>(null);
  const filterTrigger = useRef<HTMLButtonElement>(null);
  const restoredRef = useRef(false);
  const [relation, setRelation] = useState<NewsRelation>(initialView?.relation ?? 'direct');
  const newsList = useNewsList({ pageSize: PAGE_SIZE, fixedStock: symbol, fixedRelation: relation, retrieval: true, initialState: initialView });
  const hydrated = useHydrated();
  const totalPages = newsList.totalPages;
  const returnTo = stockNewsViewHref(router.asPath, {
    version: 1, symbol, relation, page: newsList.page, filters: newsList.filters,
  });

  // 換頁的退場動畫期間抽屜還在，router 已經是新聞頁：只在個股頁寫回，不然會用新聞頁的網址 replace，弄丟 ?stock=（麵包屑、返回列表都靠它）
  const ownRoute = useRef(router.pathname);
  useEffect(() => {
    if (router.pathname !== ownRoute.current) return;
    if (newsList.loading || newsList.error || !newsList.data) return;
    if (router.asPath !== returnTo) void router.replace(returnTo, undefined, { shallow: true, scroll: false });
  }, [newsList.loading, newsList.error, newsList.data, router, returnTo]);

  useEffect(() => {
    if (newsList.loading || newsList.error || !newsList.data) return;
    if (restoredRef.current) return;
    const position = loadStockNewsPosition(returnTo);
    if (!position) { restoredRef.current = true; return; }
    const frame = requestAnimationFrame(() => {
      restoredRef.current = true;
      const container = sectionRef.current?.closest<HTMLElement>('[data-detail-scroll]');
      if (container) container.scrollTop = position.scrollTop;
      const article = Array.from(sectionRef.current?.querySelectorAll<HTMLElement>('[data-news-article]') ?? [])
        .find((node) => node.dataset.newsArticle === position.articleId);
      article?.querySelector<HTMLAnchorElement>('h3 a')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [newsList.loading, newsList.error, newsList.data, router, returnTo]);

  return (
    <section ref={sectionRef} className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border-strong pb-2">
        {/* 抽屜標題已是「相關新聞」，這裡不再重複標題，直接從筆數與篩選開始 */}
        <p className="characteristic inline-flex min-w-0 items-center gap-1.5" aria-live="polite">
          <LightGlyph state={!hydrated || newsList.loading ? 'loading' : newsList.error ? 'error' : 'ready'} />
          {/* 失敗時沒有筆數可寫，只留熄燈的燈號，不寫「尚無筆數」 */}
          {newsList.data && !newsList.loading
            ? `${newsList.data.total_is_exact === false ? '找到' : '共'} ${newsList.data.total.toLocaleString()} 則`
            : newsList.loading || !hydrated
              ? '載入中…'
              : null}
        </p>
        <div className="flex items-center gap-2">
          <NewsFilters
            applied={newsList.filters}
            triggerRef={filterTrigger}
            fixedRelation
            draft={newsList.draft}
            setDraft={newsList.setDraft}
            onApply={() => newsList.applyFilters()}
            onClearAdvanced={newsList.clearAdvanced}
            disabled={newsList.loading}
          />
          <Button type="button" variant="outline" size="icon" onClick={newsList.reload} disabled={newsList.loading} aria-busy={newsList.loading || undefined} aria-label="重新整理新聞" className="text-subtle hover:text-foreground">
            <RefreshCw aria-hidden />
          </Button>
        </div>
      </div>

      <AppliedNewsFilters applied={newsList.filters} fixedRelation disabled={newsList.loading} triggerRef={filterTrigger} onClearAdvanced={newsList.clearAdvanced} />

      <p className="mb-4 flex items-start gap-1.5 border-l-2 border-border px-3 py-1 text-xs leading-5 text-muted-foreground">
        <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
        {NEWS_IMPACT_DISCLAIMER}事件影響不代表股價預測；這裡只列出找到的相關新聞，沒有結果不代表沒有新聞。
      </p>

      <div className="mb-2 flex flex-wrap gap-2" role="group" aria-label="新聞關聯範圍" aria-describedby="stock-news-relation-hint">
        {([
          ['direct', '直接關聯'],
          ['industry_context', '產業脈絡'],
          ['market_context', '市場脈絡'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={relation === value}
            onClick={() => setRelation(value)}
            className={cn(toggleVariants({ variant: 'square' }), 'text-xs')}
          >
            {label}
          </button>
        ))}
      </div>
      <p id="stock-news-relation-hint" className="mb-4 text-xs leading-5 text-muted-foreground">{RELATION_HINTS[relation]}</p>

      {!hydrated || newsList.loading ? (
        <NewsListSkeleton count={4} />
      ) : newsList.error ? (
        <Notice
          tone="danger"
          action={
            newsList.errorKind === 'filter' && summarizeNewsFilters(newsList.filters, true).length > 0 ? (
              <Button size="sm" variant="outline" onClick={newsList.clearAdvanced} className="min-h-11">清除篩選</Button>
            ) : (
              <Button size="sm" variant="outline" onClick={newsList.reload} className="min-h-11">
                <RefreshCw aria-hidden />
                重試
              </Button>
            )
          }
        >
          {newsList.error}
        </Notice>
      ) : newsList.data?.items.length ? (
        <>
          <div>
            {newsList.data.items.map((n) => (
                <NewsCard key={n.article_id} news={n} targetStock={symbol} relation={relation} returnTo={returnTo}
                  onNavigate={() => saveStockNewsPosition(returnTo, n.article_id, sectionRef.current?.closest<HTMLElement>('[data-detail-scroll]')?.scrollTop ?? 0)} />
            ))}
          </div>
          {totalPages > 1 ? (
            <div className="mt-4 flex items-center justify-between border-t pt-3">
              <span className="characteristic">
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
        <EmptyState
          className="py-6"
          action={
            <Button size="sm" variant="outline" onClick={newsList.reload} className="min-h-11">
              <RefreshCw aria-hidden />
              重新整理
            </Button>
          }
        >
          目前沒有相關新聞
        </EmptyState>
      )}
    </section>
  );
}
