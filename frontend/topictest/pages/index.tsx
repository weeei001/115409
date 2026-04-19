import React, { useCallback, useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

import { motion } from 'motion/react';
import { usePrefersReducedMotionClient } from '../lib/usePrefersReducedMotionClient';
import {
  TrendingUp,
  GitCompareArrows,
  Newspaper,
  BarChart3,
  RefreshCw,
  Search,
  Bot,
  Sparkles,
} from 'lucide-react';
import { fetchSymbols, fetchLatestPrice } from '../lib/api/stock';
import { fetchNews } from '../lib/api/news';
import type { DailyPriceResponse, PaginatedNewsResponse } from '../lib/types';
import { StockSearch } from '../components/StockSearch';
import { StockPriceCard } from '../components/StockPriceCard';
import { NewsCard } from '../components/NewsCard';
import { AppNavDrawer } from '../components/AppNavDrawer';
import { BentoGrid, BentoCell } from '../components/BentoGrid';
import { toast } from 'sonner';
import { parseBulkSymbolInput } from '../lib/utils/stockSelection';

const FEATURED_COUNT = 6;
const NEWS_PAGE_SIZE = 10;

export default function Home() {
  const router = useRouter();
  const newsRequestIdRef = useRef(0);

  const [symbols, setSymbols] = useState<string[]>([]);
  const [prices, setPrices] = useState<DailyPriceResponse[]>([]);
  const [newsData, setNewsData] = useState<PaginatedNewsResponse | null>(null);

  const [loadingSymbols, setLoadingSymbols] = useState(true);
  const [loadingPrices, setLoadingPrices] = useState(true);
  const [loadingNews, setLoadingNews] = useState(true);

  const [errorSymbols, setErrorSymbols] = useState<string | null>(null);
  const [errorPrices, setErrorPrices] = useState<string | null>(null);
  const [errorNews, setErrorNews] = useState<string | null>(null);

  const [newsKeyword, setNewsKeyword] = useState('');
  const [newsPage, setNewsPage] = useState(1);

  const navigateToStock = useCallback(
    (sym: string) => {
      void router.push(`/stock/${sym}`);
    },
    [router],
  );

  useEffect(() => {
    fetchSymbols()
      .then((syms) => {
        setSymbols(syms);
        setErrorSymbols(null);
      })
      .catch((err) => setErrorSymbols(err instanceof Error ? err.message : '無法載入股票清單'))
      .finally(() => setLoadingSymbols(false));
  }, []);

  useEffect(() => {
    if (symbols.length === 0) return;

    setLoadingPrices(true);
    const featured = symbols.slice(0, FEATURED_COUNT);
    Promise.allSettled(featured.map((sym) => fetchLatestPrice(sym)))
      .then((results) => {
        const loaded: DailyPriceResponse[] = [];
        const failedSyms: string[] = [];
        results.forEach((r, i) => {
          if (r.status === 'fulfilled') loaded.push(r.value);
          else failedSyms.push(featured[i] ?? '');
        });
        setPrices(loaded);
        setErrorPrices(loaded.length === 0 ? '無法載入股價資料' : null);
        if (failedSyms.length > 0) {
          toast.warning(`部分股價未載入：${failedSyms.filter(Boolean).join('、')}`);
        }
      })
      .finally(() => setLoadingPrices(false));
  }, [symbols]);

  const loadNews = useCallback((page: number, searchTerm?: string) => {
    const requestId = (newsRequestIdRef.current += 1);
    setLoadingNews(true);
    const trimmed = searchTerm?.trim();
    const isStockCode = trimmed && /^\d+$/.test(trimmed);
    fetchNews({
      page,
      page_size: NEWS_PAGE_SIZE,
      sort_by: 'publish_time',
      sort_order: 'desc',
      stock: isStockCode ? trimmed : undefined,
      keyword: trimmed && !isStockCode ? trimmed : undefined,
    })
      .then((data) => {
        if (requestId !== newsRequestIdRef.current) return;
        setNewsData(data);
        setErrorNews(null);
      })
      .catch((err) => {
        if (requestId !== newsRequestIdRef.current) return;
        setErrorNews(err instanceof Error ? err.message : '無法載入新聞');
      })
      .finally(() => {
        if (requestId !== newsRequestIdRef.current) return;
        setLoadingNews(false);
      });
  }, []);

  useEffect(() => {
    loadNews(1);
  }, [loadNews]);

  const handleNewsSearch = () => {
    setNewsPage(1);
    loadNews(1, newsKeyword);
  };

  const handleNewsPageChange = (page: number) => {
    setNewsPage(page);
    loadNews(page, newsKeyword);
  };

  const totalNewsPages = newsData ? Math.ceil(newsData.total / NEWS_PAGE_SIZE) : 0;

  const reduceMotion = usePrefersReducedMotionClient();

  return (
    <div className="min-h-screen text-[var(--color-text-primary)]">
      <Head>
        <title>股海明燈｜即時股價與財經新聞</title>
        <meta
          name="description"
          content="即時股價、財經新聞、多股比較與模擬下單等展示功能（學習／專題用途）。"
        />
      </Head>

      {/* ═══ Hero + Header ═══ */}
      <div className="relative overflow-hidden">
        <header className="sticky top-0 z-50 m-0 sm:mx-4 sm:mt-3">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 sm:py-4 rounded-none sm:rounded-2xl glass shadow-[var(--shadow-elevated)]">
            <motion.div
              className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -20 }}
              animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
              transition={reduceMotion ? { duration: 0 } : { duration: 0.5 }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-11 h-11 rounded-xl bg-[var(--brand-gradient)] flex items-center justify-center shadow-lg"
                  style={{ background: 'var(--brand-gradient)', animation: 'glow-pulse 3s ease-in-out infinite' }}
                >
                  <TrendingUp size={22} className="text-white" />
                </div>
                <div>
                  <h1 className="text-2xl font-extrabold tracking-tight gradient-text text-glow">股海明燈</h1>
                  <p className="text-xs text-[var(--color-text-muted)]">即時股價 &middot; 財經新聞 &middot; AI 趨勢分析</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3 w-full sm:w-auto">
                <div className="w-full sm:w-80 min-w-0">
                  {loadingSymbols ? (
                    <div className="h-12 rounded-xl bg-[var(--color-bg-elevated)] animate-pulse" aria-hidden />
                  ) : errorSymbols ? (
                    <div
                      role="alert"
                      className="rounded-xl border border-up/25 bg-up-muted/40 px-3 py-2.5 text-sm text-up flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <span>{errorSymbols}</span>
                      <button
                        type="button"
                        onClick={() => window.location.reload()}
                        className="shrink-0 text-xs font-semibold underline underline-offset-2 hover:text-brand-deep"
                      >
                        重新載入頁面
                      </button>
                    </div>
                  ) : (
                    <StockSearch
                      symbols={symbols}
                      onSelect={navigateToStock}
                      onBulkSelect={(input) => {
                        const parsed = parseBulkSymbolInput(input);
                        const first = parsed.find((symbol) => symbols.includes(symbol));
                        if (first) navigateToStock(first);
                        return {
                          added: first ? [first] : [],
                          duplicates: [],
                          invalid: first ? [] : parsed,
                          overflow: [],
                        };
                      }}
                      maxSelection={1}
                      selectedCount={0}
                      placeholder="搜尋股票代號 (例如: 2330)"
                    />
                  )}
                </div>
                <AppNavDrawer />
              </div>
            </motion.div>
          </div>
        </header>
      </div>

      {/* ═══ Bento Main Content ═══ */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <BentoGrid columns={3}>
          {/* ── Stock Price Section (span-2) ── */}
          <BentoCell span={2} delay={0.05}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2.5">
                <BarChart3 size={18} className="text-brand" />
                <h2 className="text-lg font-bold tracking-tight">即時股價</h2>
              </div>
              {!loadingSymbols && symbols.length > 0 && (
                <button
                  onClick={() => router.push('/compare')}
                  className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] hover:text-brand transition-colors"
                >
                  <GitCompareArrows size={14} />
                  多股比較
                </button>
              )}
            </div>

            {loadingPrices ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {Array.from({ length: FEATURED_COUNT }).map((_, i) => (
                  <div key={i} className="h-32 rounded-2xl bg-[var(--color-bg-elevated)] animate-pulse" />
                ))}
              </div>
            ) : errorPrices ? (
              <div
                role="alert"
                className="text-center py-8 px-4 rounded-2xl border border-up/20 bg-up-muted/30 text-up text-sm flex flex-col items-center gap-3"
              >
                <span>{errorPrices}</span>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="px-4 py-2 rounded-xl text-xs font-semibold border border-up/30 hover:bg-up-muted transition-colors"
                >
                  重新載入頁面
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {prices.map((p, i) => (
                  <StockPriceCard
                    key={p.symbol}
                    data={p}
                    index={i}
                    onNavigate={navigateToStock}
                  />
                ))}
              </div>
            )}

            {!loadingSymbols && symbols.length > FEATURED_COUNT && (
              <motion.div
                className="mt-5"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
              >
                <p className="text-xs text-[var(--color-text-muted)] mb-2">更多股票</p>
                <div className="flex flex-wrap gap-2">
                  {symbols.slice(FEATURED_COUNT, FEATURED_COUNT + 12).map((s) => (
                    <button
                      key={s}
                      onClick={() => router.push(`/stock/${s}`)}
                      className="px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-xs font-mono
                                 text-[var(--color-text-secondary)] hover:border-brand hover:text-brand
                                 hover:bg-brand/5 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </BentoCell>

          {/* ── Quick Access Panel (span-1) ── */}
          <BentoCell delay={0.1}>
            <div className="flex flex-col gap-4 h-full">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles size={16} className="text-brand" />
                <h3 className="text-sm font-bold tracking-tight">快速功能</h3>
              </div>

              <button
                onClick={() => router.push('/ai')}
                className="group flex items-center gap-3 p-4 rounded-xl border border-[var(--color-border)]
                           hover:border-brand/40 hover:bg-brand/5 transition-colors text-left"
              >
                <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                     style={{ background: 'var(--brand-gradient)' }}>
                  <Bot size={18} className="text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold group-hover:text-brand transition-colors">AI 投資顧問</p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">與 AI 對話分析市場</p>
                </div>
              </button>

              <button
                onClick={() => router.push('/advisor')}
                className="group flex items-center gap-3 p-4 rounded-xl border border-[var(--color-border)]
                           hover:border-brand/40 hover:bg-brand/5 transition-colors text-left"
              >
                <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-[var(--color-bg-elevated)]">
                  <BarChart3 size={18} className="text-brand" />
                </div>
                <div>
                  <p className="text-sm font-semibold group-hover:text-brand transition-colors">投資顧問報告</p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">整合分析與建議</p>
                </div>
              </button>

              <button
                onClick={() => router.push('/compare')}
                className="group flex items-center gap-3 p-4 rounded-xl border border-[var(--color-border)]
                           hover:border-brand/40 hover:bg-brand/5 transition-colors text-left"
              >
                <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-[var(--color-bg-elevated)]">
                  <GitCompareArrows size={18} className="text-brand" />
                </div>
                <div>
                  <p className="text-sm font-semibold group-hover:text-brand transition-colors">多股比較</p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">交叉分析走勢差異</p>
                </div>
              </button>
            </div>
          </BentoCell>

          {/* ── News Section (span-2, row-2) ── */}
          <BentoCell span={2} rowSpan={2} delay={0.15} noPad>
            <div className="p-5 sm:p-6 h-full flex flex-col">
              <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
                <div className="flex items-center gap-2.5">
                  <Newspaper size={18} className="text-brand" />
                  <h2 className="text-lg font-bold tracking-tight">最新財經新聞</h2>
                  {newsData && (
                    <span className="text-xs text-[var(--color-text-muted)] ml-1 tabular-nums">
                      共 {newsData.total.toLocaleString()} 則
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search size={16} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                    <input
                      id="home-news-keyword"
                      type="text"
                      value={newsKeyword}
                      onChange={(e) => setNewsKeyword(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleNewsSearch()}
                      placeholder="股票代號或關鍵字..."
                      aria-label="搜尋新聞：股票代號或關鍵字"
                      className="pl-9 pr-3 py-2.5 text-base sm:text-sm rounded-xl border border-[var(--color-border)]
                                 bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)]
                                 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand
                                 w-[min(100%,11rem)] sm:w-52 min-h-[44px] transition-shadow"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleNewsSearch}
                    aria-label="重新整理新聞"
                    className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-[var(--color-border)] text-[var(--color-text-muted)]
                               hover:text-brand hover:border-brand/40 transition-colors"
                  >
                    <RefreshCw size={18} aria-hidden="true" />
                  </button>
                </div>
              </div>

              <div className="flex-1 min-h-0">
                {loadingNews ? (
                  <div className="flex flex-col gap-4">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="flex flex-col gap-2">
                        <div className="h-3 w-24 rounded bg-[var(--color-bg-elevated)] animate-pulse" />
                        <div className="h-4 w-3/4 rounded bg-[var(--color-bg-elevated)] animate-pulse" />
                        <div className="h-3 w-full rounded bg-[var(--color-bg-elevated)] animate-pulse" />
                      </div>
                    ))}
                  </div>
                ) : errorNews ? (
                  <div
                    role="alert"
                    className="text-center py-8 px-4 rounded-2xl border border-up/20 bg-up-muted/30 text-up text-sm flex flex-col items-center gap-3"
                  >
                    <span>{errorNews}</span>
                    <button
                      type="button"
                      onClick={() => loadNews(newsPage, newsKeyword)}
                      className="px-4 py-2 rounded-xl text-xs font-semibold border border-up/30 hover:bg-up-muted transition-colors"
                    >
                      重試載入新聞
                    </button>
                  </div>
                ) : newsData && newsData.items.length > 0 ? (
                  <div>
                    {newsData.items.map((n, i) => (
                      <NewsCard key={n.id} news={n} index={i} />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-[var(--color-text-muted)] text-sm">暫無新聞資料</div>
                )}
              </div>

              {newsData && totalNewsPages > 1 && (
                <div className="border-t border-[var(--color-border)] pt-3 mt-3 flex items-center justify-between">
                  <span className="text-xs text-[var(--color-text-muted)] tabular-nums">
                    第 {newsData.page} / {totalNewsPages} 頁
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={newsPage <= 1}
                      onClick={() => handleNewsPageChange(newsPage - 1)}
                      className="px-4 py-2 text-sm rounded-lg border border-[var(--color-border)]
                                 text-[var(--color-text-secondary)] hover:border-brand hover:text-brand
                                 transition-colors disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px] min-w-[4.5rem]"
                    >
                      上一頁
                    </button>
                    <button
                      type="button"
                      disabled={newsPage >= totalNewsPages}
                      onClick={() => handleNewsPageChange(newsPage + 1)}
                      className="px-4 py-2 text-sm rounded-lg border border-[var(--color-border)]
                                 text-[var(--color-text-secondary)] hover:border-brand hover:text-brand
                                 transition-colors disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px] min-w-[4.5rem]"
                    >
                      下一頁
                    </button>
                  </div>
                </div>
              )}
            </div>
          </BentoCell>

          {/* ── Market Pulse Mini Card ── */}
          <BentoCell delay={0.2}>
            <div className="flex flex-col items-center justify-center text-center py-4">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3"
                   style={{ background: 'var(--brand-gradient)' }}>
                <TrendingUp size={22} className="text-white" />
              </div>
              <h3 className="text-sm font-bold mb-1">市場脈動</h3>
              <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                追蹤台股即時動態，掌握投資先機
              </p>
              <button
                onClick={() => router.push('/order')}
                className="mt-4 px-4 py-2 rounded-xl text-xs font-semibold text-white min-h-[40px]
                           shadow-lg transition-shadow hover:shadow-xl"
                style={{ background: 'var(--brand-gradient)' }}
              >
                模擬下單
              </button>
            </div>
          </BentoCell>
        </BentoGrid>
      </main>
    </div>
  );
}
