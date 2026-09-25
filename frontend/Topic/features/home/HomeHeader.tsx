import React, { useRef } from 'react';
import { motion } from 'motion/react';
import { TrendingUp } from 'lucide-react';
import { AppNavDrawer } from '@/components/layout/AppNavDrawer';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { StockSearch } from '@/components/common/StockSearch';
import { usePrefersReducedMotion, useSyncAppHeaderHeight } from '@/lib/hooks/useClientEnv';
import { cn } from '@/lib/cn';
import type { StockInfo } from '@/lib/types/api';

interface Props {
  symbols: string[];
  stockInfos: StockInfo[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSelect: (symbol: string) => void;
  onBulkSelect: (input: string) => void;
}

/**
 * 首頁頁首：品牌、股票搜尋、主選單、主題切換（決議 c52）。
 * 手機：品牌與按鈕同一列、搜尋獨立一列；sm 以上三者同一列。
 */
export function HomeHeader({ symbols, stockInfos, loading, error, onRetry, onSelect, onBulkSelect }: Props) {
  const reduce = usePrefersReducedMotion();
  const headerRef = useRef<HTMLElement>(null);
  useSyncAppHeaderHeight(headerRef);

  return (
    <header ref={headerRef} className="sticky top-0 z-50 shrink-0 bg-card pt-[var(--app-safe-area-top)] sm:mx-4 sm:mt-3 sm:bg-transparent">
      <motion.div
        className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b bg-card px-4 py-3 shadow-raised sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:gap-4 sm:rounded-2xl sm:border sm:px-6 lg:px-8"
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={reduce ? { duration: 0 } : { duration: 0.35 }}
      >
        <div className="flex min-h-11 min-w-0 items-center gap-3">
          <div className={cn('flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-gradient shadow-card', !reduce && 'anim-glow-pulse')}>
            <TrendingUp size={22} className="text-on-brand" aria-hidden />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl leading-tight font-extrabold tracking-tight sm:text-2xl">股海明燈</h1>
            <p className="text-xs text-subtle">AI分析平台</p>
          </div>
        </div>

        <div className="col-span-2 row-start-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:w-80">
          {loading ? (
            <div className="h-11 w-full animate-pulse rounded-xl bg-muted" aria-hidden />
          ) : error ? (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-xl border border-danger-border bg-danger-muted px-3 py-2.5 text-sm text-danger sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="min-w-0">{error}</span>
              <button type="button" onClick={onRetry} className="min-h-11 shrink-0 text-xs font-semibold underline underline-offset-2 sm:min-h-0">
                重試載入
              </button>
            </div>
          ) : (
            <StockSearch
              symbols={symbols}
              stockInfos={stockInfos}
              onSelect={onSelect}
              onBulkSelect={onBulkSelect}
              placeholder="搜尋代號或公司名稱"
            />
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:col-start-3 sm:gap-3">
          <AppNavDrawer />
          <ThemeToggle />
        </div>
      </motion.div>
    </header>
  );
}
