import React, { useRef } from 'react';
import { BrandMark } from '@/components/common/BrandMark';
import { DataStamp } from '@/components/common/Ledger';
import { StockSearch } from '@/components/common/StockSearch';
import { AppNavDrawer } from '@/components/layout/AppNavDrawer';
import { PrimaryNav } from '@/components/layout/PrimaryNav';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { usePrefersReducedMotion, useSyncAppHeaderHeight } from '@/lib/hooks/useClientEnv';
import type { StockInfo } from '@/lib/types/api';

interface Props {
  /** 旅程終點（觀測台）的元素 id */
  terminalId: string;
  symbols: string[];
  stockInfos: StockInfo[];
  /** 大盤最近一筆已儲存收盤的日期 */
  boardDate: string | null;
  onSelect: (symbol: string) => void;
  onBulkSelect: (input: string) => void;
}

/**
 * 首頁頁首：一條平的 sticky 列，旅程與觀測台共用。
 * 第一個可聚焦的元素是「跳到觀測台」，鍵盤使用者不必走完旅程。
 * h1 在旅程的第一章，這裡的品牌名不是標題。
 */
export function HomeHeader({ terminalId, symbols, stockInfos, boardDate, onSelect, onBulkSelect }: Props) {
  const reduce = usePrefersReducedMotion();
  const headerRef = useRef<HTMLElement>(null);
  useSyncAppHeaderHeight(headerRef);

  const skipToTerminal = (e: React.MouseEvent) => {
    e.preventDefault();
    const target = document.getElementById(terminalId);
    if (!target) return;
    target.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    target.focus({ preventScroll: true });
  };

  return (
    <header ref={headerRef} className="sticky top-0 z-50 shrink-0 border-b bg-card pt-[var(--app-safe-area-top)]">
      <a
        href={`#${terminalId}`}
        onClick={skipToTerminal}
        className="sr-only focus:not-sr-only focus:absolute focus:top-[calc(var(--app-safe-area-top)+0.375rem)] focus:left-4 focus:z-10 focus:flex focus:min-h-11 focus:items-center focus:rounded-md focus:border focus:border-border-strong focus:bg-card focus:px-4 focus:text-sm focus:font-medium"
      >
        跳到觀測台
      </a>
      <div className="mx-auto flex h-14 max-w-[1320px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-10">
        <div className="flex min-w-0 items-center gap-2">
          <BrandMark />
          <span className="font-serif text-lg font-black tracking-[0.14em]">股海明燈</span>
          <DataStamp date={boardDate} label="大盤收盤" nonRealtime className="ml-2 hidden border-l pl-4 xl:inline" />
        </div>
        <PrimaryNav className="ml-auto" />
        <div className="flex min-w-0 items-center gap-2">
          {symbols.length ? (
            <StockSearch
              symbols={symbols}
              stockInfos={stockInfos}
              onSelect={onSelect}
              onBulkSelect={onBulkSelect}
              placeholder="搜尋代號或公司名稱"
              className="hidden w-56 md:block"
            />
          ) : null}
          <AppNavDrawer />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
