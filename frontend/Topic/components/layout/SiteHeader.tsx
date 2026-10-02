import React, { useRef } from 'react';
import { useRouter } from 'next/router';
import { motion } from 'motion/react';
import { ArrowLeft, type LucideIcon } from 'lucide-react';
import { AppNavDrawer } from './AppNavDrawer';
import { ThemeToggle } from './ThemeToggle';
import { Breadcrumbs } from './Breadcrumbs';
import { breadcrumbsForPath, type BreadcrumbItem } from '@/lib/nav';
import { usePrefersReducedMotion, useSyncAppHeaderHeight } from '@/lib/hooks/useClientEnv';
import { cn } from '@/lib/cn';

export interface SiteHeaderProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  /** 省略時依路由自動產生 */
  breadcrumbs?: BreadcrumbItem[];
  /** 長標題（如錯誤頁代號）允許換行 */
  titleWrap?: boolean;
  /** 緊接在標題右側的動作（例如個股頁的收藏星號） */
  titleAction?: React.ReactNode;
}

/** 子頁頁首：返回鍵、頁面標題、主選單、主題切換、麵包屑 */
export function SiteHeader({ icon: Icon, title, subtitle, breadcrumbs, titleWrap = false, titleAction }: SiteHeaderProps) {
  const router = useRouter();
  const reduce = usePrefersReducedMotion();
  const headerRef = useRef<HTMLElement>(null);
  useSyncAppHeaderHeight(headerRef);

  const crumbs = breadcrumbs ?? breadcrumbsForPath(router.pathname, router.asPath);

  const handleBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) router.back();
    else void router.push('/');
  };

  return (
    <header ref={headerRef} className="sticky top-0 z-50 shrink-0 bg-card pt-[var(--app-safe-area-top)] sm:mx-4 sm:mt-3 sm:bg-transparent">
      <motion.div
        className="mx-auto max-w-7xl border-b bg-card px-4 py-3 shadow-raised sm:rounded-2xl sm:border sm:px-6 lg:px-8"
        initial={reduce ? false : { opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduce ? { duration: 0 } : { duration: 0.35 }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button
              type="button"
              onClick={handleBack}
              aria-label="返回上一頁"
              className="flex size-11 shrink-0 items-center justify-center rounded-lg border text-subtle transition-colors hover:border-border-strong hover:text-brand-text"
            >
              <ArrowLeft size={20} aria-hidden />
            </button>
            <div className="hidden size-10 shrink-0 items-center justify-center rounded-lg bg-brand-gradient shadow-card sm:flex">
              <Icon size={20} className="text-on-brand" aria-hidden />
            </div>
            <div className={cn('min-w-0', !titleAction && 'flex-1')}>
              <h1 className={cn('text-lg font-bold tracking-tight', titleWrap ? 'break-all text-balance' : 'truncate')}>{title}</h1>
              {subtitle ? (
                <p className="truncate text-xs text-subtle" title={subtitle}>
                  {subtitle}
                </p>
              ) : null}
            </div>
            {titleAction}
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <AppNavDrawer />
            <ThemeToggle />
          </div>
        </div>
        {crumbs.length ? <Breadcrumbs items={crumbs} className="mt-2 pl-14 sm:pl-[6.75rem]" /> : null}
      </motion.div>
    </header>
  );
}
