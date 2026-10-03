import React from 'react';
import { useRouter } from 'next/router';
import { AnimatePresence, motion } from 'motion/react';
import { SiteFooter } from './SiteFooter';
import { ScrollToTop } from './ScrollToTop';
import { usePrefersReducedMotion } from '@/lib/hooks/useClientEnv';

/** 換頁：舊頁 --dur-flash（125ms）淡出，新頁 --dur-sweep（250ms）淡入並上移 8px */
const EXIT = { duration: 0.125, ease: [0.4, 0, 1, 1] as const };
const ENTER = { duration: 0.25, ease: [0.2, 0, 0, 1] as const };

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const reduce = usePrefersReducedMotion();

  return (
    <div className="relative isolate flex min-h-[100dvh] w-full flex-col bg-background pb-[var(--app-safe-area-bottom)]">
      <div id="main-content" tabIndex={-1} className="flex min-h-0 min-w-0 flex-1 flex-col outline-none">
        {reduce ? (
          children
        ) : (
          // 不設 initial={false}：它會讓底下所有 motion 元件在首次載入時略過進場動畫（決議 c65）
          <AnimatePresence mode="wait">
            <motion.div
              key={router.route}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0, transition: ENTER }}
              exit={{ opacity: 0, transition: EXIT }}
              className="flex min-h-0 min-w-0 flex-1 flex-col"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
      <SiteFooter className={router.pathname === '/ai' ? 'hidden sm:block' : undefined} />
      {/* 對話頁會自動捲到最新訊息，浮動鈕還會蓋住送出鈕（決議 c69）；首頁旅程有自己的進度列與「回到海面」 */}
      {router.pathname === '/ai' || router.pathname === '/' ? null : <ScrollToTop />}
    </div>
  );
}
