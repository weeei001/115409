import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { AlertCircle, ArrowLeft, Loader2, Newspaper } from 'lucide-react';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { Button } from '@/components/ui/button';
import { NewsArticle } from '@/features/news/NewsArticle';
import { NewsEventAnalysisPanel } from '@/features/news/NewsEventAnalysisPanel';
import { fetchNewsDetail } from '@/lib/api/news';
import type { News } from '@/lib/types/api';
import { breadcrumbsTrail } from '@/lib/nav';
import { parseRelatedStocks } from '@/lib/news/sentiment';
import { formatStockLabel } from '@/lib/utils/symbolNames';
import { userFacingMessage } from '@/lib/api/errorDetail';

const isStockCode = (code: string | null | undefined): code is string => Boolean(code && /^\d{4,6}$/.test(code));
const firstQuery = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || '';

function pickStock(news: News, stockParam: string): string {
  const companies = news.event_analysis?.impacts.filter((impact) => impact.target_type === 'company') ?? [];
  if (isStockCode(stockParam) && companies.some((impact) => impact.target_id === stockParam)) return stockParam;
  if (isStockCode(companies[0]?.target_id)) return companies[0].target_id;
  if (isStockCode(news.stock_id)) return news.stock_id;
  return '';
}

export default function NewsDetailPage() {
  const router = useRouter();
  const articleId = firstQuery(router.query.id);
  const stockParam = firstQuery(router.query.stock);
  const [news, setNews] = useState<News | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStock, setSelectedStock] = useState('');

  useEffect(() => {
    if (!router.isReady || !articleId) return;
    setLoading(true);
    setError(null);
    fetchNewsDetail(articleId)
      .then((data) => {
        setNews(data);
        setSelectedStock(pickStock(data, stockParam));
      })
      .catch((err) => setError(userFacingMessage(err, '無法載入新聞文章')))
      .finally(() => setLoading(false));
  }, [router.isReady, articleId, stockParam]);

  const analysis = news?.event_analysis;
  const quotes = useMemo(() => {
    if (!analysis || analysis.status !== 'success') return [];
    return [...analysis.events.flatMap((event) => event.evidence), ...analysis.impacts.flatMap((impact) => impact.evidence)]
      .map((evidence) => evidence.quote)
      .filter(Boolean);
  }, [analysis]);
  const stockCodes = useMemo(() => {
    if (!news) return [];
    return Array.from(new Set([
      ...parseRelatedStocks(news, true),
      ...(analysis?.impacts.filter((impact) => impact.target_type === 'company').map((impact) => impact.target_id) ?? []),
    ]));
  }, [analysis, news]);

  const breadcrumbs = useMemo(
    () => isStockCode(selectedStock)
      ? breadcrumbsTrail({ label: formatStockLabel(selectedStock), href: `/stock/${selectedStock}` }, '新聞內容與事件影響')
      : breadcrumbsTrail('新聞內容與事件影響'),
    [selectedStock],
  );
  const pageTitle = news?.title ? `${news.title} - 新聞事件影響 | 股海明燈` : '新聞事件影響 | 股海明燈';

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <Head>
        <title>{pageTitle}</title>
        <meta name="description" content={news?.title ? `新聞：${news.title} 完整內容與事件影響分析。` : '新聞內容與事件影響分析'} />
      </Head>

      <SiteHeader
        icon={Newspaper}
        title="新聞內容與事件影響"
        subtitle={news?.title ? `${news.source ?? '新聞'} 報導與事件影響分析` : !loading && (error || !news) ? '無法讀取新聞' : '載入中...'}
        breadcrumbs={breadcrumbs}
      />

      <main aria-label="新聞內容" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-28" aria-busy="true" aria-live="polite">
            <Loader2 size={36} className="animate-spin text-brand" aria-hidden />
            <p className="text-sm text-muted-foreground">載入新聞內容與事件分析...</p>
          </div>
        ) : error || !news ? (
          <div role="alert" className="mx-auto my-16 max-w-md space-y-4 rounded-xl border bg-card p-6 text-center shadow-card">
            <AlertCircle size={40} className="mx-auto text-danger" aria-hidden />
            <h2 className="text-lg font-semibold">無法讀取新聞</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">{error ?? '找不到指定的新聞文章。'}</p>
            <Button variant="outline" onClick={() => router.back()} className="min-h-11"><ArrowLeft aria-hidden />返回上一頁</Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
            <NewsArticle news={news} stockCodes={stockCodes} selectedStock={selectedStock} quotes={quotes} />
            <aside className="space-y-4 rounded-xl border bg-card p-5 shadow-card lg:sticky lg:top-[calc(var(--app-header-height)+1rem)] lg:col-span-4" aria-label="新聞事件影響分析">
              <div className="flex items-center justify-between gap-2 border-b pb-3">
                <h2 className="text-sm font-semibold">新聞事件影響分析</h2>
                {selectedStock ? <span className="text-xs text-muted-foreground">{formatStockLabel(selectedStock)}</span> : null}
              </div>
              {analysis ? <NewsEventAnalysisPanel analysis={analysis} /> : <p className="py-4 text-center text-xs text-muted-foreground">尚無事件影響分析。</p>}
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
