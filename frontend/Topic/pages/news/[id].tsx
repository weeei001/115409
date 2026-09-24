import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { AlertCircle, ArrowLeft, Loader2, Newspaper } from 'lucide-react';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { Button } from '@/components/ui/button';
import { NewsArticle } from '@/features/news/NewsArticle';
import { NewsSentimentPanel } from '@/features/news/NewsSentimentPanel';
import { fetchNewsDetail } from '@/lib/api/news';
import type { News } from '@/lib/types/api';
import { breadcrumbsTrail } from '@/lib/nav';
import { parseRelatedStocks } from '@/lib/news/sentiment';
import { formatStockLabel } from '@/lib/utils/symbolNames';
import { userFacingMessage } from '@/lib/api/errorDetail';

const isStockCode = (code: string | null | undefined): code is string => Boolean(code && /^\d{4,6}$/.test(code));
const firstQuery = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || '';

/** 目前股票：query 的 stock 有對應情緒就用它，否則第一筆情緒，再不行用 stock_id */
function pickStock(news: News, stockParam: string): string {
  const sentiments = news.sentiments ?? [];
  if (isStockCode(stockParam) && sentiments.some((s) => s.target_stock_id === stockParam)) return stockParam;
  if (isStockCode(sentiments[0]?.target_stock_id)) return sentiments[0].target_stock_id;
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
    // 不帶 stock：後端會只回傳該檔的情緒，其他檔的分析就看不到了（決議 c67）
    fetchNewsDetail(articleId)
      .then((data) => {
        setNews(data);
        setSelectedStock(pickStock(data, stockParam));
      })
      .catch((err) => setError(userFacingMessage(err, '無法載入新聞文章')))
      .finally(() => setLoading(false));
  }, [router.isReady, articleId, stockParam]);

  const sentiments = useMemo(() => news?.sentiments ?? [], [news]);
  const active = useMemo(
    () => (selectedStock ? (sentiments.find((s) => s.target_stock_id === selectedStock) ?? sentiments[0]) : sentiments[0]),
    [sentiments, selectedStock],
  );
  const quotes = useMemo(() => (active?.evidence ?? []).map((e) => e.quote).filter(Boolean), [active]);
  const stockCodes = useMemo(() => (news ? parseRelatedStocks(news, true) : []), [news]);

  const breadcrumbs = useMemo(
    () =>
      isStockCode(selectedStock)
        ? breadcrumbsTrail({ label: formatStockLabel(selectedStock), href: `/stock/${selectedStock}` }, '新聞內容與 AI 分析')
        : breadcrumbsTrail('新聞內容與 AI 分析'),
    [selectedStock],
  );

  const pageTitle = news?.title ? `${news.title} - 新聞與 AI 情緒分析 | 股海明燈` : '新聞內容與 AI 情緒分析 | 股海明燈';

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <Head>
        <title>{pageTitle}</title>
        <meta name="description" content={news?.title ? `新聞：${news.title} 完整內容與 AI 金融情緒分析。` : '新聞內容與 AI 情緒分析'} />
      </Head>

      <SiteHeader
        icon={Newspaper}
        title="新聞內容與 AI 情緒分析"
        subtitle={news?.title ? `${news.source ?? '新聞'} 報導與大語言模型引證` : !loading && (error || !news) ? '無法讀取新聞' : '載入中...'}
        breadcrumbs={breadcrumbs}
      />

      <main aria-label="新聞內容" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-28" aria-busy="true" aria-live="polite">
            <Loader2 size={36} className="animate-spin text-brand" aria-hidden />
            <p className="text-sm text-muted-foreground">載入新聞內容與 AI 分析...</p>
          </div>
        ) : error || !news ? (
          <div role="alert" className="mx-auto my-16 max-w-md space-y-4 rounded-xl border bg-card p-6 text-center shadow-card">
            <AlertCircle size={40} className="mx-auto text-danger" aria-hidden />
            <h2 className="text-lg font-semibold">無法讀取新聞</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">{error ?? '找不到指定的新聞文章。'}</p>
            <Button variant="outline" onClick={() => router.back()} className="min-h-11">
              <ArrowLeft aria-hidden />
              返回上一頁
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
            <NewsArticle news={news} stockCodes={stockCodes} selectedStock={selectedStock} quotes={quotes} />
            <NewsSentimentPanel
              sentiments={sentiments}
              active={active}
              selectedStock={selectedStock}
              onSelectStock={setSelectedStock}
              fallbackStock={stockCodes[0]}
            />
          </div>
        )}
      </main>
    </div>
  );
}
