import React, { useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ArrowLeft, type LucideIcon } from 'lucide-react';
import { AppNavDrawer } from './AppNavDrawer';
import { ThemeToggle } from './ThemeToggle';
import { Breadcrumbs } from './Breadcrumbs';
import { HeaderStockSearch, PrimaryNav } from './PrimaryNav';
import { BrandMark } from '@/components/common/BrandMark';
import { Button } from '@/components/ui/button';
import { DataStamp } from '@/components/common/Ledger';
import { breadcrumbsForPath, type BreadcrumbItem } from '@/lib/nav';
import { useSyncAppHeaderHeight } from '@/lib/hooks/useClientEnv';
import { useLatestCloseDate } from '@/lib/hooks/useLatestCloseDate';
import { cn } from '@/lib/cn';

export interface SiteHeaderProps {
  /** 保留給呼叫端相容；頁首不再顯示圖示方塊 */
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  /** 省略時依路由自動產生 */
  breadcrumbs?: BreadcrumbItem[];
  /** 長標題（如錯誤頁代號）允許換行 */
  titleWrap?: boolean;
  /** 要在標點處換行的長標題（例如新聞標題）可以傳已插好 <wbr> 的節點；仍要傳 title 給文件標題用 */
  titleNode?: React.ReactNode;
  /** 緊接在標題右側的動作（例如個股頁的收藏星號） */
  titleAction?: React.ReactNode;
}

/**
 * 子頁頁首：sticky 的一條平列（返回、品牌、資料日戳記、主選單、換班），
 * 底下是不跟著捲動的標題區（麵包屑、襯線 h1、副標）。標題區的粗線在換頁時由左到右畫出（光束掃過）。
 */
export function SiteHeader({ title, titleNode, subtitle, breadcrumbs, titleWrap = false, titleAction }: SiteHeaderProps) {
  const router = useRouter();
  const headerRef = useRef<HTMLElement>(null);
  useSyncAppHeaderHeight(headerRef);
  const latestClose = useLatestCloseDate();

  const crumbs = breadcrumbs ?? breadcrumbsForPath(router.pathname, router.asPath);

  const handleBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) router.back();
    else void router.push('/');
  };

  return (
    <>
      <header ref={headerRef} className="sticky top-0 z-50 shrink-0 border-b bg-card pt-[var(--app-safe-area-top)]">
        <div className="mx-auto flex h-14 max-w-[1320px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-10">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Button type="button" variant="ghost" size="icon" onClick={handleBack} aria-label="返回上一頁" className="-ml-2 text-subtle hover:text-foreground">
              <ArrowLeft className="size-5" aria-hidden />
            </Button>
            <Link href="/" aria-label="股海明燈首頁" className="flex min-h-11 shrink-0 items-center gap-2">
              <BrandMark />
              <span className="font-serif text-lg font-black tracking-[0.14em]">股海明燈</span>
            </Link>
            <DataStamp date={latestClose} label="大盤收盤" nonRealtime className="ml-2 hidden border-l pl-4 xl:inline" />
          </div>
          <PrimaryNav className="ml-auto" />
          <div className="flex shrink-0 items-center gap-2">
            <HeaderStockSearch className="hidden w-56 lg:block" />
            <AppNavDrawer />
            <ThemeToggle />
          </div>
        </div>
      </header>
      <div className="shrink-0 bg-card">
        <div className="mx-auto max-w-[1320px] px-4 pt-4 pb-4 sm:px-6 lg:px-10 lg:pt-6 lg:pb-6">
          {crumbs.length ? <Breadcrumbs items={crumbs} className="-my-2.5" /> : null}
          <div className="flex min-w-0 items-center gap-2">
            <div className={cn('min-w-0', !titleAction && 'flex-1')}>
              <h1
                className={cn(
                  'font-serif text-[clamp(1.625rem,3.2vw,2.75rem)] leading-[1.2] font-black tracking-[0.04em]',
                  titleWrap ? '[word-break:keep-all] [overflow-wrap:anywhere] text-balance' : 'truncate',
                )}
              >
                {titleNode ?? title}
              </h1>
              {subtitle ? (
                <p className="mt-1 truncate text-[13px] text-muted-foreground" title={subtitle}>
                  {subtitle}
                </p>
              ) : null}
            </div>
            {titleAction}
          </div>
        </div>
        <div key={router.asPath} className="anim-beam-draw h-px w-full bg-border-strong" aria-hidden />
      </div>
    </>
  );
}
