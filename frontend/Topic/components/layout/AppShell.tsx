import React, { useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { AnimatePresence, motion } from 'motion/react';
import { SiteFooter } from './SiteFooter';
import { RiskNoticeBanner } from './RiskNoticeBanner';
import { ScrollToTop } from './ScrollToTop';
import { FrozenRouter } from './FrozenRouter';
import { usePrefersReducedMotion } from '@/lib/hooks/useClientEnv';
import { useScrollRestoration } from '@/lib/navigation/useScrollRestoration';
import { cn } from '@/lib/cn';

/** 換頁：舊頁 --dur-flash（125ms）淡出，新頁 --dur-sweep（250ms）淡入並上移 8px */
const EXIT = { duration: 0.125, ease: [0.4, 0, 1, 1] as const };
const ENTER = { duration: 0.25, ease: [0.2, 0, 0, 1] as const };

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const reduce = usePrefersReducedMotion();
  /** 第一次載入的頁面不播進場：伺服器輸出的內容首屏就看得到（LCP）；之後換頁才淡入上移 */
  const routeChanged = useRef(false);
  useEffect(() => {
    routeChanged.current = true;
  }, []);
  /** 上一頁、下一頁還原捲動位置：有淡出時等舊頁淡出完才開始（P1-14） */
  const onExitComplete = useScrollRestoration(!reduce);

  return (
    <div className="relative isolate flex min-h-[100dvh] w-full flex-col bg-background pb-[var(--app-safe-area-bottom)]">
      {/* 「跳至主要內容」的落點在各頁頁首之後（MainContentAnchor），不是這一層：這一層包住了頁首（03-F6） */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {reduce ? (
          children
        ) : (
          // 不在 AnimatePresence 設 initial={false}：它會讓底下所有 motion 元件在首次載入時略過進場動畫（決議 c65）。
          // 只放在這個 motion.div 上不會往下傳（animate 不是 variant 名稱，子元件沿用上層 context）
          <AnimatePresence mode="wait" onExitComplete={onExitComplete}>
            <motion.div
              key={router.route}
              initial={routeChanged.current ? { opacity: 0, y: 8 } : false}
              animate={{ opacity: 1, y: 0, transition: ENTER }}
              exit={{ opacity: 0, transition: EXIT }}
              className="flex min-h-0 min-w-0 flex-1 flex-col"
            >
              {/* 淡出中的舊頁沿用離開前的 router，不會用新路由的參數重算（P1-15） */}
              <FrozenRouter>{children}</FrozenRouter>
            </motion.div>
          </AnimatePresence>
        )}
      </div>
      {/* 列印時頁尾照印，紙本上也有投資風險提示；只有可列印的 AI 報告頁不印，報告自己印出免責文字 */}
      <SiteFooter className={cn(router.pathname === '/stock/[id]/report' && 'print:hidden', router.pathname === '/ai' && 'hidden sm:block')} />
      {/* 浮動（fixed）的提示條與按鈕任何一頁都不印，免得蓋在紙本內容上 */}
      <div className="print:hidden">
        <RiskNoticeBanner />
        {/* 對話頁會自動捲到最新訊息，浮動鈕還會蓋住送出鈕（決議 c69）；首頁旅程有自己的進度列與「回到海面」 */}
        {router.pathname === '/ai' || router.pathname === '/' ? null : <ScrollToTop />}
      </div>
    </div>
  );
}
