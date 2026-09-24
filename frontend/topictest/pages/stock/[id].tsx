import React from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { TrendingUp, Loader2 } from 'lucide-react';
import { SubpageHeader } from '../../components/SubpageHeader';
import { StockDashboardLayout } from '../../components/stock/StockDashboardLayout';
import { useStockDashboard } from '../../lib/hooks/useStockDashboard';
import { useStockDisplayName } from '../../lib/utils/symbolNames';
import { breadcrumbsForStock, breadcrumbsTrail } from '../../lib/nav';

function StockDashboardView({ symbol }: { symbol: string }) {
  const router = useRouter();
  const dashboard = useStockDashboard(symbol, true);

  const displayName = useStockDisplayName(symbol);
  const stockBreadcrumbs = breadcrumbsForStock(symbol, displayName);

  const stockTitle = `股海明燈｜${symbol} ${displayName}`;
  const stockDesc = `查詢 ${symbol} ${displayName} 即時股價、K 線、籌碼、技術指標、AI 投資分析與新聞（展示／專題用途）。`;

  const stockPageHead = (
    <Head>
      <title>{stockTitle}</title>
      <meta name="description" content={stockDesc} />
      <meta property="og:title" content={stockTitle} />
      <meta property="og:description" content={stockDesc} />
      <meta property="og:type" content="article" />
      <meta name="twitter:card" content="summary" />
      <meta name="twitter:title" content={stockTitle} />
      <meta name="twitter:description" content={stockDesc} />
    </Head>
  );

  if (dashboard.loading) {
    return (
      <div className="min-h-[100dvh] flex flex-col text-[var(--color-text-primary)]">
        {stockPageHead}
        <SubpageHeader
          icon={TrendingUp}
          breadcrumbs={stockBreadcrumbs}
          autoBreadcrumbs={false}
          title={`${symbol} ${displayName}`}
          subtitle="載入中…"
        />
        <main
          id="stock-page-main"
          className="flex flex-1 items-center justify-center py-24"
          aria-busy="true"
          aria-live="polite"
        >
          <Loader2 size={40} className="text-brand animate-spin" aria-hidden />
          <span className="sr-only">載入中...</span>
        </main>
      </div>
    );
  }

  if (dashboard.error) {
    return (
      <div className="min-h-[100dvh] flex flex-col text-[var(--color-text-primary)]">
        {stockPageHead}
        <SubpageHeader
          icon={TrendingUp}
          breadcrumbs={stockBreadcrumbs}
          autoBreadcrumbs={false}
          title={`${symbol} ${displayName}`}
          subtitle="無法載入資料"
          titleWrap
        />
        <main
          id="stock-page-main"
          className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-24"
        >
          <p className="px-4 py-3 rounded-xl bg-up-muted border border-up/20 text-sm text-up-emphasis max-w-md text-center">
            {dashboard.error}
          </p>
          <button
            type="button"
            onClick={() => router.push('/')}
            className="min-h-11 px-5 py-2.5 rounded-xl text-[var(--color-on-brand)] font-semibold shadow-lg transition-[opacity,box-shadow,transform] cursor-pointer"
            style={{ background: 'var(--brand-gradient)' }}
          >
            返回首頁
          </button>
        </main>
      </div>
    );
  }

  if (!dashboard.latest) {
    return (
      <div className="min-h-[100dvh] flex flex-col text-[var(--color-text-primary)]">
        {stockPageHead}
        <SubpageHeader
          icon={TrendingUp}
          breadcrumbs={stockBreadcrumbs}
          autoBreadcrumbs={false}
          title={`${symbol} ${displayName}`}
          subtitle="無法取得報價"
        />
        <main
          id="stock-page-main"
          className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-24"
        >
          <p className="px-4 py-3 rounded-xl bg-up-muted border border-up/20 text-sm text-up-emphasis max-w-md text-center">
            無法取得報價資料
          </p>
          <button
            type="button"
            onClick={() => router.push('/')}
            className="min-h-11 px-5 py-2.5 rounded-xl text-[var(--color-on-brand)] font-semibold shadow-lg transition-[opacity,box-shadow,transform] cursor-pointer"
            style={{ background: 'var(--brand-gradient)' }}
          >
            返回首頁
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col text-[var(--color-text-primary)]">
      {stockPageHead}
      <SubpageHeader
        icon={TrendingUp}
        breadcrumbs={stockBreadcrumbs}
        autoBreadcrumbs={false}
        title={`${symbol} ${displayName}`}
        subtitle="個股儀表板"
      />
      <a
        href="#stock-page-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-20 focus:z-[60] focus:rounded-xl focus:bg-[var(--color-bg-card)] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:shadow-[var(--shadow-elevated)] focus:outline focus:outline-2 focus:outline-brand"
      >
        跳至個股內容
      </a>
      <main
        id="stock-page-main"
        className="flex-1 w-full max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6 outline-none"
        aria-label="個股儀表板內容"
        tabIndex={-1}
      >
        <StockDashboardLayout dashboard={dashboard} stockName={displayName} />
      </main>
    </div>
  );
}

export default function StockDetail() {
  const router = useRouter();
  const rawId = (Array.isArray(router.query.id) ? router.query.id[0] : router.query.id) || '';
  const symbol = rawId.trim();
  const isArticleId = symbol.length > 8 && /^[a-fA-F0-9]{16,64}$/.test(symbol);
  const isStockSymbol = /^\d{4,6}$/.test(symbol);

  React.useEffect(() => {
    if (!router.isReady) return;
    if (isArticleId) {
      void router.replace(`/news/${symbol}`);
    }
  }, [router.isReady, isArticleId, symbol, router]);

  if (!router.isReady) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center text-[var(--color-text-primary)]">
        <Loader2 size={36} className="text-brand animate-spin mb-3" aria-hidden />
        <p className="text-sm text-[var(--color-text-muted)]">載入中...</p>
      </div>
    );
  }

  if (isArticleId) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center text-[var(--color-text-primary)]">
        <Loader2 size={36} className="text-brand animate-spin mb-3" aria-hidden />
        <p className="text-sm text-[var(--color-text-muted)]">偵測到新聞文章代碼，正在轉向至新聞閱讀頁面...</p>
      </div>
    );
  }

  if (!isStockSymbol) {
    return (
      <div className="min-h-[100dvh] flex flex-col text-[var(--color-text-primary)]">
        <SubpageHeader
          icon={TrendingUp}
          breadcrumbs={breadcrumbsTrail('個股')}
          autoBreadcrumbs={false}
          title={symbol ? `${symbol} 無效代號` : '個股儀表板'}
          subtitle="股票代號格式錯誤"
          titleWrap
        />
        <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-24">
          <p className="px-4 py-3 rounded-xl bg-up-muted border border-up/20 text-sm text-up-emphasis max-w-md text-center">
            股票代號格式不正確，請輸入 4 至 6 碼股票代號。
          </p>
          <button
            type="button"
            onClick={() => router.push('/')}
            className="min-h-11 px-5 py-2.5 rounded-xl text-[var(--color-on-brand)] font-semibold shadow-lg transition-[opacity,box-shadow,transform] cursor-pointer"
            style={{ background: 'var(--brand-gradient)' }}
          >
            返回首頁
          </button>
        </main>
      </div>
    );
  }

  return <StockDashboardView key={symbol} symbol={symbol} />;
}
