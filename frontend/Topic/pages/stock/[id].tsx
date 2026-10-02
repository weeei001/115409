import React, { useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { Loader2, TrendingUp } from 'lucide-react';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/button';
import { StockDashboard } from '@/features/stock/StockDashboard';
import { isStockSymbol, useStockDashboard } from '@/lib/hooks/useStockDashboard';
import { formatStockLabel } from '@/lib/utils/symbolNames';
import { breadcrumbsForStock, breadcrumbsTrail } from '@/lib/nav';

function BackHome({ message }: { message: string }) {
  const router = useRouter();
  return (
    <main id="stock-page-main" className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-24">
      <Notice tone="danger" className="max-w-md">
        {message}
      </Notice>
      <Button size="lg" onClick={() => void router.push('/')} className="bg-brand-gradient text-on-brand">
        返回首頁
      </Button>
    </main>
  );
}

function StockDashboardView({ symbol }: { symbol: string }) {
  const dashboard = useStockDashboard(symbol);
  const label = formatStockLabel(symbol);
  const title = `股海明燈｜${label}`;
  const description = `查詢 ${label} 最近儲存收盤行情、K 線、籌碼、技術指標、AI 投資分析與新聞（非即時；展示／專題用途）。`;
  const header = (subtitle: string, titleWrap = false) => (
    <SiteHeader icon={TrendingUp} breadcrumbs={breadcrumbsForStock(symbol)} title={label} subtitle={subtitle} titleWrap={titleWrap} />
  );

  const head = (
    <Head>
      <title>{title}</title>
      <meta name="description" content={description} />
      <meta property="og:title" content={title} key="og:title" />
      <meta property="og:description" content={description} key="og:description" />
      <meta property="og:type" content="article" key="og:type" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
    </Head>
  );

  if (dashboard.loading) {
    return (
      <div className="flex min-h-[100dvh] flex-col">
        {head}
        {header('載入中…')}
        <main id="stock-page-main" className="flex flex-1 items-center justify-center py-24" aria-busy="true" aria-live="polite">
          <Loader2 size={40} className="animate-spin text-brand" aria-hidden />
          <span className="sr-only">載入中...</span>
        </main>
      </div>
    );
  }

  if (dashboard.error || !dashboard.latest) {
    return (
      <div className="flex min-h-[100dvh] flex-col">
        {head}
        {header(dashboard.error ? '無法載入資料' : '無法取得報價', Boolean(dashboard.error))}
        <BackHome message={dashboard.error ?? '無法取得報價資料'} />
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col">
      {head}
      {header('個股儀表板')}
      <a href="#stock-page-main" className="skip-link">
        跳至個股內容
      </a>
      <main id="stock-page-main" tabIndex={-1} aria-label="個股儀表板內容" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8">
        <StockDashboard dashboard={dashboard} />
      </main>
    </div>
  );
}

export default function StockDetailPage() {
  const router = useRouter();
  const raw = (Array.isArray(router.query.id) ? router.query.id[0] : router.query.id) || '';
  const symbol = raw.trim();
  // 舊連結相容：16～64 位十六進位字串視為新聞 id（決議 c51 保留）
  const isArticleId = symbol.length > 8 && /^[a-fA-F0-9]{16,64}$/.test(symbol);

  useEffect(() => {
    if (router.isReady && isArticleId) void router.replace(`/news/${symbol}`);
  }, [router, isArticleId, symbol]);

  if (!router.isReady || isArticleId) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center">
        <Loader2 size={36} className="mb-3 animate-spin text-brand" aria-hidden />
        <p className="text-sm text-muted-foreground">{isArticleId ? '偵測到新聞文章代碼，正在轉向至新聞閱讀頁面...' : '載入中...'}</p>
      </div>
    );
  }

  if (!isStockSymbol(symbol)) {
    return (
      <div className="flex min-h-[100dvh] flex-col">
        <SiteHeader
          icon={TrendingUp}
          breadcrumbs={breadcrumbsTrail('個股')}
          title={symbol ? `${symbol} 無效代號` : '個股儀表板'}
          subtitle="股票代號格式錯誤"
          titleWrap
        />
        <BackHome message="股票代號格式不正確，請輸入 4 至 6 碼股票代號。" />
      </div>
    );
  }

  return <StockDashboardView key={symbol} symbol={symbol} />;
}
