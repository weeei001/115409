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
  Search,
  Bot,
  Sparkles,
  ShoppingCart,
  FileText,
} from 'lucide-react';
import { fetchSymbols, fetchLatestPrice } from '../lib/api/stock';
import type { DailyPriceResponse } from '../lib/types';
import { useNewsList } from '../lib/hooks/useNewsList';
import { NewsAdvancedFilters } from '../components/news/NewsAdvancedFilters';
import { NewsListSkeleton } from '../components/news/NewsListSkeleton';
import { useHydrated } from '../lib/useHydrated';
import { StockSearch } from '../components/StockSearch';
import { StockPriceCard } from '../components/StockPriceCard';
import { NewsCard } from '../components/NewsCard';
import { AppNavDrawer } from '../components/AppNavDrawer';
import { BentoGrid, BentoCell } from '../components/BentoGrid';
import { toast } from 'sonner';
import { parseBulkSymbolInput } from '../lib/utils/stockSelection';
import { fetchSparklineCloses } from '../lib/utils/sparklineHistory';

const FEATURED_COUNT = 6;
const NEWS_PAGE_SIZE = 10;

export default function Home() {
  const router = useRouter();
  const pricesRequestIdRef = useRef(0);
  const symbolsReloadRef = useRef(0);
  const pricesAbortRef = useRef<AbortController | null>(null);
  const sparklineAbortRef = useRef<AbortController | null>(null);

  const [symbols, setSymbols] = useState<string[]>([]);
  const [prices, setPrices] = useState<DailyPriceResponse[]>([]);
  const [sparklines, setSparklines] = useState<Record<string, number[]>>({});
  const [loadingSymbols, setLoadingSymbols] = useState(true);
  const [loadingPrices, setLoadingPrices] = useState(true);

  const [errorSymbols, setErrorSymbols] = useState<string | null>(null);
  const [errorPrices, setErrorPrices] = useState<string | null>(null);

  const [newsKeyword, setNewsKeyword] = useState('');
  const newsList = useNewsList({ pageSize: NEWS_PAGE_SIZE });

  const navigateToStock = useCallback(
    (sym: string) => {
      void router.push(`/stock/${sym}`);
    },
    [router],
  );

  const reloadSymbols = useCallback(() => {
    symbolsReloadRef.current += 1;
    setLoadingSymbols(true);
    setErrorSymbols(null);
    fetchSymbols()
      .then((syms) => {
        setSymbols(syms);
        setErrorSymbols(null);
      })
      .catch((err) => setErrorSymbols(err instanceof Error ? err.message : '無法載入股票清單'))
      .finally(() => setLoadingSymbols(false));
  }, []);

  useEffect(() => {
    reloadSymbols();
  }, [reloadSymbols]);

  useEffect(() => {
    if (symbols.length === 0) return;

    const requestId = (pricesRequestIdRef.current += 1);
    // 切換股票清單時取消尚未完成的舊請求，避免浪費網路與舊資料覆蓋
    pricesAbortRef.current?.abort();
    const ctrl = new AbortController();
    pricesAbortRef.current = ctrl;

    setLoadingPrices(true);
    const featured = symbols.slice(0, FEATURED_COUNT);
    Promise.allSettled(featured.map((sym) => fetchLatestPrice(sym, { signal: ctrl.signal })))
      .then((results) => {
        if (ctrl.signal.aborted || requestId !== pricesRequestIdRef.current) return;
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
      .finally(() => {
        if (requestId === pricesRequestIdRef.current && !ctrl.signal.aborted) setLoadingPrices(false);
      });

    return () => ctrl.abort();
  }, [symbols]);

  useEffect(() => {
    if (prices.length === 0) {
      setSparklines({});
      return;
    }
    sparklineAbortRef.current?.abort();
    const ctrl = new AbortController();
    sparklineAbortRef.current = ctrl;

    void Promise.allSettled(
      prices.map(async (p) => {
        const closes = await fetchSparklineCloses(p.symbol);
        return { symbol: p.symbol, closes };
      }),
    ).then((results) => {
      if (ctrl.signal.aborted) return;
      const next: Record<string, number[]> = {};
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.closes.length >= 2) {
          next[r.value.symbol] = r.value.closes;
        }
      }
      setSparklines(next);
    });
    return () => ctrl.abort();
  }, [prices]);

  const handleNewsSearch = () => {
    newsList.applyFilters({ keyword: newsKeyword });
  };

  const handleNewsPageChange = (page: number) => {
    newsList.goToPage(page);
  };

  const reduceMotion = usePrefersReducedMotionClient();
  const hydrated = useHydrated();

  return (
    <motion.div className="min-h-[100dvh] text-[var(--color-text-primary)] overflow-x-hidden">
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
          <motion.div className="max-w-7xl mx-auto flex min-w-0 items-center px-4 sm:px-6 lg:px-8 py-3 rounded-none sm:rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] shadow-[var(--shadow-elevated)]">
            <motion.div
              className="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={reduceMotion ? { duration: 0 } : { duration: 0.35 }}
            >
              <div className="flex min-h-11 min-w-0 shrink-0 items-center gap-3">
                <div
                  className={`w-11 h-11 shrink-0 rounded-xl flex items-center justify-center shadow-lg${reduceMotion ? '' : ' anim-glow-pulse'}`}
                  style={{ background: 'var(--brand-gradient)' }}
                >
                  <TrendingUp size={22} className="text-white" aria-hidden />
                </div>
                <div className="flex min-w-0 flex-col justify-center gap-0.5">
                  <h1 className="m-0 text-xl sm:text-2xl font-extrabold leading-tight tracking-tight text-[var(--color-text-primary)] truncate">
                    股海明燈
                  </h1>
                  <p className="m-0 text-xs leading-snug text-[var(--color-text-secondary)] text-pretty">
                    AI分析平台
                  </p>
                </div>
              </div>

              <div className="flex w-full min-w-0 flex-col gap-2.5 sm:w-auto sm:min-h-11 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
                <motion.div className="min-h-0 min-w-0 w-full sm:w-80">
                  {loadingSymbols ? (
                    <div className="h-11 w-full rounded-xl bg-[var(--color-bg-elevated)] animate-pulse" aria-hidden />
                  ) : errorSymbols ? (
                    <div
                      role="alert"
                      className="rounded-xl border border-up/25 bg-up-muted/40 px-3 py-2.5 text-sm text-up-emphasis flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <span className="min-w-0">{errorSymbols}</span>
                      <button
                        type="button"
                        onClick={reloadSymbols}
                        className="shrink-0 text-xs font-semibold underline underline-offset-2 text-up-emphasis hover:text-brand-deep"
                      >
                        重試載入
                      </button>
                    </div>
                  ) : (
                    <StockSearch
                      className="w-full max-w-none"
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
                </motion.div>
                <div className="flex shrink-0 items-center justify-end">
                  <AppNavDrawer />
                </div>
              </div>
            </motion.div>
          </motion.div>
        </header>
      </div>

      {/* ═══ Bento Main Content ═══ */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <BentoGrid columns={3}>
          {/* ── Stock Price Section (span-2) ── */}
          <BentoCell span={2} delay={0.05} orderMobile={1}>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {Array.from({ length: FEATURED_COUNT }).map((_, i) => (
                  <div key={i} className="h-32 rounded-2xl bg-[var(--color-bg-elevated)] animate-pulse" />
                ))}
              </div>
            ) : errorPrices ? (
              <div
                role="alert"
                className="text-center py-8 px-4 rounded-2xl border border-up/20 bg-up-muted/30 text-up-emphasis text-sm flex flex-col items-center gap-3"
              >
                <span>{errorPrices}</span>
                <button
                  type="button"
                  onClick={reloadSymbols}
                  className="px-4 py-2 rounded-xl text-xs font-semibold border border-up/30 hover:bg-up-muted transition-colors"
                >
                  重試載入
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {prices.map((p, i) => (
                  <StockPriceCard
                    key={p.symbol}
                    data={p}
                    index={i}
                    sparkline={sparklines[p.symbol]}
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

          {/* ── Quick Access Panel (span-1, beside stocks) ── */}
          <BentoCell delay={0.08} orderMobile={2}>
            <div className="flex h-full flex-col gap-3">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-brand" aria-hidden />
                <h3 className="text-sm font-bold tracking-tight">快速功能</h3>
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-1">
                <button
                  onClick={() => router.push('/ai')}
                  className="group flex items-center gap-2.5 p-3 rounded-xl border border-[var(--color-border)]
                           hover:border-brand/40 hover:bg-brand/5 transition-colors text-left"
                >
                  <div className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center"
                    style={{ background: 'var(--brand-gradient)' }}>
                    <Bot size={16} className="text-white" aria-hidden />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold group-hover:text-brand transition-colors truncate">AI 對話</p>
                    <p className="text-xs text-[var(--color-text-muted)] mt-0.5 truncate">市場參考對話</p>
                  </div>
                </button>


                <button
                  onClick={() => router.push('/compare')}
                  className="group flex items-center gap-2.5 p-3 rounded-xl border border-[var(--color-border)]
                           hover:border-brand/40 hover:bg-brand/5 transition-colors text-left"
                >
                  <div className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center bg-[var(--color-bg-elevated)]">
                    <GitCompareArrows size={16} className="text-brand" aria-hidden />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold group-hover:text-brand transition-colors truncate">多股比較</p>
                    <p className="text-xs text-[var(--color-text-muted)] mt-0.5 truncate">交叉分析走勢</p>
                  </div>
                </button>

                <button
                  onClick={() => router.push('/order')}
                  className="group flex items-center gap-2.5 p-3 rounded-xl border border-[var(--color-border)]
                           hover:border-brand/40 hover:bg-brand/5 transition-colors text-left"
                >
                  <div className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center bg-[var(--color-bg-elevated)]">
                    <ShoppingCart size={16} className="text-brand" aria-hidden />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold group-hover:text-brand transition-colors truncate">模擬下單</p>
                    <p className="text-xs text-[var(--color-text-muted)] mt-0.5 truncate">練習下單流程</p>
                  </div>
                </button>

                <button
                  onClick={() => router.push('/demo/text-brief')}
                  className="group flex items-center gap-2.5 p-3 rounded-xl border border-[var(--color-border)]
                           hover:border-brand/40 hover:bg-brand/5 transition-colors text-left"
                >
                  <div className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center bg-[var(--color-bg-elevated)]">
                    <FileText size={16} className="text-brand" aria-hidden />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold group-hover:text-brand transition-colors truncate">AI 個股分析</p>
                    <p className="text-xs text-[var(--color-text-muted)] mt-0.5 truncate">每句話都查得到出處</p>
                  </div>
                </button>

              </div>
            </div>
          </BentoCell>

          {/* ── News Section (full width) ── */}
          <BentoCell span={3} delay={0.12} noPad orderMobile={3}>
            <div className="p-5 sm:p-6 h-full flex flex-col">
              <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
                <div className="flex items-center gap-2.5">
                  <Newspaper size={18} className="text-brand" />
                  <h2 className="text-lg font-bold tracking-tight">最新財經新聞</h2>
                  {newsList.data && (
                    <span className="text-xs text-[var(--color-text-muted)] ml-1 tabular-nums">
                      共 {newsList.data.total.toLocaleString()} 則
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <NewsAdvancedFilters
                    layout="toolbar"
                    draft={newsList.draft}
                    setDraft={newsList.setDraft}
                    onApply={handleNewsSearch}
                    onClearAdvanced={newsList.clearAdvanced}
                    disabled={newsList.loading}
                  />
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
                    aria-label="搜尋新聞"
                    className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-[var(--color-border)] text-[var(--color-text-muted)]
                               hover:text-brand hover:border-brand/40 transition-colors"
                  >
                    <Search size={18} aria-hidden="true" />
                  </button>
                </div>
              </div>

              <div className="flex-1 min-h-0">
                {!hydrated || newsList.loading ? (
                  <NewsListSkeleton count={5} />
                ) : newsList.error ? (
                  <div
                    role="alert"
                    className="text-center py-8 px-4 rounded-2xl border border-up/20 bg-up-muted/30 text-up-emphasis text-sm flex flex-col items-center gap-3"
                  >
                    <span>{newsList.error}</span>
                    <button
                      type="button"
                      onClick={newsList.reload}
                      className="px-4 py-2 rounded-xl text-xs font-semibold border border-up/30 hover:bg-up-muted transition-colors"
                    >
                      重試載入新聞
                    </button>
                  </div>
                ) : newsList.data && newsList.data.items.length > 0 ? (
                  <div>
                    {newsList.data.items.map((n, i) => (
                      <NewsCard
                        key={n.article_id}
                        news={n}
                        index={i}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-[var(--color-text-muted)] text-sm">暫無新聞資料</div>
                )}
              </div>

              {newsList.data && newsList.totalPages > 1 && (
                <div className="border-t border-[var(--color-border)] pt-3 mt-3 flex items-center justify-between">
                  <span className="text-xs text-[var(--color-text-muted)] tabular-nums">
                    第 {newsList.data.page} / {newsList.totalPages} 頁
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={newsList.page <= 1}
                      onClick={() => handleNewsPageChange(newsList.page - 1)}
                      className="px-4 py-2 text-sm rounded-lg border border-[var(--color-border)]
                                 text-[var(--color-text-secondary)] hover:border-brand hover:text-brand
                                 transition-colors disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px] min-w-[4.5rem]"
                    >
                      上一頁
                    </button>
                    <button
                      type="button"
                      disabled={newsList.page >= newsList.totalPages}
                      onClick={() => handleNewsPageChange(newsList.page + 1)}
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
        </BentoGrid>
      </main>
    </motion.div>
  );
}
