import React from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { AnimatePresence, motion } from 'motion/react';
import { SiteFooter } from './SiteFooter';
import { ScrollToTop } from './ScrollToTop';
import { usePrefersReducedMotion } from '@/lib/hooks/useClientEnv';

const ParticleBackground = dynamic(() => import('./ParticleBackground'), {
  ssr: false,
  loading: () => <div className="absolute inset-0" aria-hidden />,
});

/** 個股頁與多股比較是分析頁：不放粒子背景，改用純色底 */
function isAnalysisRoute(pathname: string, asPath: string): boolean {
  return pathname.startsWith('/stock') || asPath.startsWith('/stock/') || pathname === '/compare' || pathname === '/admin';
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const reduce = usePrefersReducedMotion();
  const showParticles = !isAnalysisRoute(router.pathname, router.asPath);

  return (
    <div className="relative isolate min-h-[100dvh] w-full">
      <div className="pointer-events-none fixed inset-0 z-[1] h-[100dvh] w-full" aria-hidden>
        {showParticles ? <ParticleBackground /> : <div className="absolute inset-0 bg-background" />}
      </div>
      <div className="relative z-[2] flex min-h-[100dvh] w-full flex-col pb-[var(--app-safe-area-bottom)]">
        <div id="main-content" tabIndex={-1} className="flex min-h-0 min-w-0 flex-1 flex-col outline-none">
          {reduce ? (
            children
          ) : (
            // 不設 initial={false}：它會讓底下所有 motion 元件在首次載入時略過進場動畫（決議 c65）
            <AnimatePresence mode="wait">
              <motion.div
                key={router.route}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.1, ease: 'easeOut' }}
                className="flex min-h-0 min-w-0 flex-1 flex-col"
              >
                {children}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
        <SiteFooter className={router.pathname === '/ai' ? 'hidden sm:block' : undefined} />
        {/* 對話頁會自動捲到最新訊息，浮動鈕還會蓋住送出鈕（決議 c69） */}
        {router.pathname === '/ai' ? null : <ScrollToTop />}
      </div>
    </div>
  );
}
