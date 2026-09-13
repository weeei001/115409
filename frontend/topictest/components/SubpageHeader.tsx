import React, { useRef } from 'react';
import { useSyncAppHeaderHeight } from '../lib/useSyncAppHeaderHeight';
import { useRouter } from 'next/router';
import { motion } from 'motion/react';
import { usePrefersReducedMotionClient } from '../lib/usePrefersReducedMotionClient';
import { ArrowLeft, type LucideIcon } from 'lucide-react';
import { AppNavDrawer } from './AppNavDrawer';
import { ThemeToggle } from './ThemeToggle';
import { Breadcrumbs } from './Breadcrumbs';
import type { BreadcrumbItem } from '../lib/nav';
import { breadcrumbsForPath } from '../lib/nav';

export interface SubpageHeaderProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  rightExtra?: React.ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  autoBreadcrumbs?: boolean;
  backBehavior?: 'history' | 'home';
  /** 長標題（如錯誤頁代號）允許換行，避免 truncate */
  titleWrap?: boolean;
}

export const SubpageHeader: React.FC<SubpageHeaderProps> = ({
  icon: Icon,
  title,
  subtitle,
  rightExtra,
  breadcrumbs: breadcrumbsProp,
  autoBreadcrumbs = true,
  backBehavior = 'history',
  titleWrap = false,
}) => {
  const router = useRouter();
  const reduceMotion = usePrefersReducedMotionClient();
  const headerRef = useRef<HTMLElement>(null);
  useSyncAppHeaderHeight(headerRef);

  const crumbs =
    breadcrumbsProp ??
    (autoBreadcrumbs ? breadcrumbsForPath(router.pathname, router.asPath) : []);

  const handleBack = () => {
    if (backBehavior === 'home') {
      void router.push('/');
      return;
    }
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
      return;
    }
    void router.push('/');
  };

  return (
    <header ref={headerRef} className="sticky top-0 z-50 flex-shrink-0 m-0 bg-[var(--color-bg-card)] pt-[var(--app-safe-area-top)] sm:mx-4 sm:mt-3 sm:bg-transparent">
      <motion.div
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 rounded-none sm:rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] shadow-[var(--shadow-elevated)]"
        initial={reduceMotion ? false : { opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.4 }}
      >
        <motion.div className="flex flex-col gap-2">
          <motion.div className="flex items-center justify-between gap-4">
            <motion.div className="flex items-center gap-3 min-w-0 flex-1">
              <button
                type="button"
                onClick={handleBack}
                aria-label="返回上一頁"
                className="flex shrink-0 min-h-11 min-w-11 items-center justify-center rounded-lg border border-[var(--color-border)]
                           text-[var(--color-text-secondary)] hover:border-brand/40 hover:text-brand
                           transition-colors"
              >
                <ArrowLeft size={20} aria-hidden />
              </button>
              <motion.div
                className="w-10 h-10 flex-shrink-0 rounded-xl flex items-center justify-center shadow-lg"
                style={{ background: 'var(--brand-gradient)' }}
              >
                <Icon size={20} className="text-white" aria-hidden />
              </motion.div>
              <motion.div className="min-w-0 flex-1">
                <h1
                  className={`text-lg font-bold tracking-tight text-balance text-[var(--color-text-primary)] ${
                    titleWrap ? 'break-all' : 'truncate'
                  }`}
                >
                  {title}
                </h1>
                {subtitle && (
                  <p className="text-xs text-[var(--color-text-secondary)] text-pretty truncate">{subtitle}</p>
                )}
              </motion.div>
            </motion.div>
            <motion.div className="flex items-center gap-3 flex-shrink-0">
              <AppNavDrawer />
              {rightExtra}
              <ThemeToggle />
            </motion.div>
          </motion.div>
          {crumbs.length > 0 && <Breadcrumbs items={crumbs} className="pl-[3.25rem] sm:pl-[3.5rem]" />}
        </motion.div>
      </motion.div>
    </header>
  );
};
