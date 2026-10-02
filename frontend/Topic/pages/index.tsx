import React, { useCallback, useMemo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { BarChart3, ChevronRight, GitCompareArrows, RefreshCw } from 'lucide-react';
import { EmptyState, Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/button';
import { BentoCell, BentoGrid } from '@/features/home/BentoGrid';
import { HomeHeader } from '@/features/home/HomeHeader';
import { HomeNews } from '@/features/home/HomeNews';
import { QuickLinks } from '@/features/home/QuickLinks';
import { StockPriceCard } from '@/features/home/StockPriceCard';
import { FEATURED_COUNT, useFeaturedQuotes } from '@/features/home/useFeaturedQuotes';
import { useFavorites } from '@/lib/favorites/FavoritesContext';
import { parseBulkSymbolInput } from '@/lib/utils/stockSelection';

const DESCRIPTION = '最近儲存收盤行情（非即時）、財經新聞、多股比較與模擬下單等展示功能（學習／專題用途）。';

export default function HomePage() {
  const router = useRouter();
  const favorites = useFavorites();
  // 只有已登入且清單載入成功才排收藏股；未登入、沒有收藏或載入失敗都維持原本的輪播
  const favoriteItems = favorites.status === 'ready' ? favorites.items : null;
  const favoriteSymbols = useMemo(() => favoriteItems?.map((item) => item.symbol) ?? [], [favoriteItems]);
  const favoriteNames = useMemo(() => new Map(favoriteItems?.map((item) => [item.symbol, item.name] as const)), [favoriteItems]);
  const quotes = useFeaturedQuotes(favoriteSymbols, favorites.status !== 'idle' && favorites.status !== 'loading');
  const { symbols } = quotes;

  const goToStock = useCallback((symbol: string) => void router.push(`/stock/${symbol}`), [router]);

  // 輸入或貼上多個代號時，取第一個存在於清單的代號
  const handleBulkSelect = useCallback(
    (input: string) => {
      const first = parseBulkSymbolInput(input).find((symbol) => symbols.includes(symbol));
      if (first) goToStock(first);
    },
    [symbols, goToStock],
  );

  const symbolsReady = !quotes.loadingSymbols && symbols.length > 0;

  return (
    <div className="flex min-h-[100dvh] flex-col overflow-x-hidden">
      <Head>
        <title>股海明燈｜最近儲存收盤行情與財經新聞</title>
        <meta name="description" content={DESCRIPTION} />
      </Head>

      <HomeHeader
        symbols={symbols}
        stockInfos={quotes.stockInfos}
        loading={quotes.loadingSymbols}
        error={quotes.errorSymbols}
        onRetry={quotes.reloadSymbols}
        onSelect={goToStock}
        onBulkSelect={handleBulkSelect}
      />

      <main aria-label="首頁內容" className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <BentoGrid>
          <BentoCell span={2} delay={0.05} orderMobile={1}>
            <div className="mb-5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <BarChart3 size={18} className="text-brand" aria-hidden />
                <h2 className="text-lg font-bold tracking-tight">最近儲存收盤行情</h2>
              </div>
              {symbolsReady ? (
                <button
                  type="button"
                  onClick={() => void router.push('/compare')}
                  className="inline-flex min-h-11 items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-brand-text"
                >
                  <GitCompareArrows size={14} aria-hidden />
                  多股比較
                </button>
              ) : null}
            </div>

            <p className="mb-4 text-xs text-muted-foreground">非即時行情；依已匯入資料顯示，收盤日見各筆資料。</p>

            {quotes.emptySymbols ? (
              <EmptyState className="py-8">目前沒有可顯示的股票</EmptyState>
            ) : quotes.loadingPrices ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
                {Array.from({ length: FEATURED_COUNT }).map((_, i) => (
                  <div key={i} className="h-32 animate-pulse rounded-xl bg-muted" aria-hidden />
                ))}
                <span className="sr-only">載入股價中…</span>
              </div>
            ) : quotes.errorPrices ? (
              <Notice
                tone="danger"
                action={
                  <Button size="sm" variant="outline" onClick={quotes.retryPrices} className="min-h-9">
                    <RefreshCw aria-hidden />
                    重試載入
                  </Button>
                }
              >
                {quotes.errorPrices}
              </Notice>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {quotes.prices.map((p, i) => (
                    <StockPriceCard
                      key={p.symbol}
                      data={p}
                      stockName={quotes.stockInfos.find((stock) => stock.symbol === p.symbol)?.name ?? (favoriteNames.get(p.symbol) || undefined)}
                      index={i}
                      sparkline={quotes.sparklines[p.symbol]}
                      favorite={quotes.favoriteFeatured.has(p.symbol)}
                      onNavigate={goToStock}
                    />
                  ))}
                </div>
                {favoriteSymbols.length > FEATURED_COUNT ? (
                  <div className="mt-3 flex justify-end">
                    <Link
                      href="/me"
                      className="inline-flex min-h-11 items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-brand-text"
                    >
                      查看全部收藏
                      <ChevronRight size={14} aria-hidden />
                    </Link>
                  </div>
                ) : null}
              </>
            )}
          </BentoCell>

          <BentoCell delay={0.08} orderMobile={2}>
            <QuickLinks />
          </BentoCell>

          <BentoCell span={3} delay={0.12} orderMobile={3}>
            <HomeNews />
          </BentoCell>
        </BentoGrid>
      </main>
    </div>
  );
}
