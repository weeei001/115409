import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { motion } from 'motion/react';
import {
  TrendingUp,
  GitCompareArrows,
  Newspaper,
  BarChart3,
  RefreshCw,
  Search,
  LogIn,
  ShoppingCart,
} from 'lucide-react';
import { fetchSymbols, fetchLatestPrice } from '../lib/api/stock';
import { fetchNews } from '../lib/api/news';
import type { DailyPriceResponse, PaginatedNewsResponse } from '../lib/types';
import { StockSearch } from '../components/StockSearch';
import { StockPriceCard } from '../components/StockPriceCard';
import { NewsCard } from '../components/NewsCard';
import { ThemeToggle } from '../components/ThemeToggle';

const FEATURED_COUNT = 6;

export default function Home() {
  const router = useRouter();

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
  const NEWS_PAGE_SIZE = 10;

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
        results.forEach((r) => {
          if (r.status === 'fulfilled') loaded.push(r.value);
        });
        setPrices(loaded);
        setErrorPrices(loaded.length === 0 ? '無法載入股價資料' : null);
      })
      .finally(() => setLoadingPrices(false));
  }, [symbols]);

  const loadNews = (page: number, searchTerm?: string) => {
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
        setNewsData(data);
        setErrorNews(null);
      })
      .catch((err) => setErrorNews(err instanceof Error ? err.message : '無法載入新聞'))
      .finally(() => setLoadingNews(false));
  };

  useEffect(() => {
    loadNews(1);
  }, []);

  const handleNewsSearch = () => {
    setNewsPage(1);
    loadNews(1, newsKeyword);
  };

  const handleNewsPageChange = (page: number) => {
    setNewsPage(page);
    loadNews(page, newsKeyword);
  };

  const totalNewsPages = newsData ? Math.ceil(newsData.total / NEWS_PAGE_SIZE) : 0;

  return (
    <div className="min-h-screen bg-gray-50/60 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      {/* ── Hero ── */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <motion.div
            className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#ffa95a] to-[#ffd45a] flex items-center justify-center shadow-lg shadow-[#ffa95a]/20">
                <TrendingUp size={22} className="text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">股海明燈</h1>
                <p className="text-xs text-gray-400 dark:text-gray-500">即時股價 &middot; 財經新聞 &middot; AI 趨勢分析</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-full sm:w-80">
                {loadingSymbols ? (
                  <div className="h-12 rounded-xl bg-gray-100 dark:bg-gray-700 animate-pulse" />
                ) : errorSymbols ? (
                  <div className="text-sm text-red-500">{errorSymbols}</div>
                ) : (
                  <StockSearch
                    symbols={symbols}
                    onSelect={(sym) => router.push(`/stock/${sym}`)}
                    placeholder="搜尋股票代號 (例如: 2330)"
                  />
                )}
              </div>

              <button
                onClick={() => router.push('/order')}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-sm text-gray-500 dark:text-gray-400
                           hover:border-[#ffa95a] hover:text-[#ffa95a] hover:bg-[#fff9e6] dark:hover:bg-[#ffa95a]/10 transition-all bg-white dark:bg-gray-700 whitespace-nowrap"
              >
                <ShoppingCart size={15} />
                模擬下單
              </button>
              <button
                onClick={() => router.push('/login')}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#ffa95a] to-[#ffd45a]
                           text-white text-sm font-semibold shadow-lg shadow-[#ffa95a]/20
                           hover:shadow-xl hover:shadow-[#ffa95a]/30 transition-all whitespace-nowrap"
              >
                <LogIn size={15} />
                登入
              </button>
              <ThemeToggle />
            </div>
          </motion.div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-10">
        {/* ── Stock Price Cards ── */}
        <section>
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <BarChart3 size={18} className="text-[#ffa95a]" />
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">即時股價</h2>
            </div>
            {!loadingSymbols && symbols.length > 0 && (
              <button
                onClick={() => router.push('/compare')}
                className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-[#ffa95a] transition-colors"
              >
                <GitCompareArrows size={14} />
                多股比較
              </button>
            )}
          </div>

          {loadingPrices ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {Array.from({ length: FEATURED_COUNT }).map((_, i) => (
                <div key={i} className="h-32 rounded-2xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 animate-pulse" />
              ))}
            </div>
          ) : errorPrices ? (
            <div className="text-center py-8 text-red-500 text-sm">{errorPrices}</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {prices.map((p, i) => (
                <StockPriceCard
                  key={p.symbol}
                  data={p}
                  index={i}
                  onClick={() => router.push(`/stock/${p.symbol}`)}
                />
              ))}
            </div>
          )}

          {/* Quick symbol buttons */}
          {!loadingSymbols && symbols.length > FEATURED_COUNT && (
            <motion.div
              className="mt-5"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
            >
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">更多股票</p>
              <div className="flex flex-wrap gap-2">
                {symbols.slice(FEATURED_COUNT, FEATURED_COUNT + 12).map((s) => (
                  <button
                    key={s}
                    onClick={() => router.push(`/stock/${s}`)}
                    className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-xs font-mono text-gray-500 dark:text-gray-400
                               hover:border-[#ffa95a] hover:text-[#ffa95a] hover:bg-[#fff9e6] dark:hover:bg-[#ffa95a]/10 transition-all"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </section>

        {/* ── News Section ── */}
        <section>
          <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Newspaper size={18} className="text-[#ffa95a]" />
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">最新財經新聞</h2>
              {newsData && (
                <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">共 {newsData.total.toLocaleString()} 則</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={newsKeyword}
                  onChange={(e) => setNewsKeyword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleNewsSearch()}
                  placeholder="股票代號或關鍵字..."
                  className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-200
                             focus:outline-none focus:ring-2 focus:ring-[#ffa95a]/30 focus:border-[#ffa95a]
                             w-40 sm:w-52"
                />
              </div>
              <button
                onClick={handleNewsSearch}
                className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-400 hover:text-[#ffa95a]
                           hover:border-[#ffa95a] transition-colors"
              >
                <RefreshCw size={14} />
              </button>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="px-5 py-4">
              {loadingNews ? (
                <div className="flex flex-col gap-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex flex-col gap-2">
                      <div className="h-3 w-24 rounded bg-gray-100 dark:bg-gray-700 animate-pulse" />
                      <div className="h-4 w-3/4 rounded bg-gray-100 dark:bg-gray-700 animate-pulse" />
                      <div className="h-3 w-full rounded bg-gray-100 dark:bg-gray-700 animate-pulse" />
                    </div>
                  ))}
                </div>
              ) : errorNews ? (
                <div className="text-center py-8 text-red-500 text-sm">{errorNews}</div>
              ) : newsData && newsData.items.length > 0 ? (
                <div>
                  {newsData.items.map((n, i) => (
                    <NewsCard key={n.id} news={n} index={i} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">暫無新聞資料</div>
              )}
            </div>

            {/* Pagination */}
            {newsData && totalNewsPages > 1 && (
              <div className="border-t border-gray-100 dark:border-gray-700 px-5 py-3 flex items-center justify-between">
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  第 {newsData.page} / {totalNewsPages} 頁
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    disabled={newsPage <= 1}
                    onClick={() => handleNewsPageChange(newsPage - 1)}
                    className="px-3 py-1 text-xs rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300
                               hover:border-[#ffa95a] hover:text-[#ffa95a] transition-colors
                               disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    上一頁
                  </button>
                  <button
                    disabled={newsPage >= totalNewsPages}
                    onClick={() => handleNewsPageChange(newsPage + 1)}
                    className="px-3 py-1 text-xs rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300
                               hover:border-[#ffa95a] hover:text-[#ffa95a] transition-colors
                               disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    下一頁
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── Footer Quick Links ── */}
        <motion.footer
          className="flex flex-wrap items-center justify-center gap-4 pt-4 pb-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
        >
          <button
            onClick={() => router.push('/compare')}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-sm text-gray-500 dark:text-gray-400
                       hover:border-[#ffa95a] hover:text-[#ffa95a] hover:bg-[#fff9e6] dark:hover:bg-[#ffa95a]/10 transition-all bg-white dark:bg-gray-800"
          >
            <GitCompareArrows size={16} />
            多股比較
          </button>
        </motion.footer>
      </main>
    </div>
  );
}
