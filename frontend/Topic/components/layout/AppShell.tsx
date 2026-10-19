import React, { useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { AnimatePresence, motion } from 'motion/react';
import { SiteFooter } from './SiteFooter';
import { RiskNoticeBanner } from './RiskNoticeBanner';
import { ScrollToTop } from './ScrollToTop';
import { FrozenRouter } from './FrozenRouter';
import { AssistantDock } from '@/features/assistant/AssistantDock';
import { usePrefersReducedMotion } from '@/lib/hooks/useClientEnv';
import { useScrollRestoration } from '@/lib/navigation/useScrollRestoration';
import { cn } from '@/lib/cn';

/** 換頁：舊頁 --dur-flash（125ms）淡出，新頁 --dur-sweep（250ms）淡入並上移 8px；減少動態時直接換 */
const EXIT = { duration: 0.125, ease: [0.4, 0, 1, 1] as const };
const ENTER = { duration: 0.25, ease: [0.2, 0, 0, 1] as const };
const INSTANT = { duration: 0 };

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const reduce = usePrefersReducedMotion();
  /** 第一次載入的頁面不播進場：伺服器輸出的內容首屏就看得到（LCP）；之後換頁才淡入上移 */
  const routeChanged = useRef(false);
  useEffect(() => {
    routeChanged.current = true;
  }, []);
  /** 上一頁、下一頁還原捲動位置：等舊頁離開（AnimatePresence 的 onExitComplete）才開始（P1-14）；減少動態時舊頁是立刻離開 */
  const onExitComplete = useScrollRestoration(true);

  return (
    <div className="relative isolate flex min-h-[100dvh] w-full flex-col bg-background pb-[var(--app-safe-area-bottom)]">
      {/* 「跳至主要內容」的落點在各頁頁首之後（MainContentAnchor），不是這一層：這一層包住了頁首（03-F6） */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* 減少動態只改動畫參數，不換掉這一層：reduce 在掛載後才從 false 變成 true，換結構會讓整頁在載入後重掛一次（首頁 LCP 慢約 0.9 秒）。
            不在 AnimatePresence 設 initial={false}：它會讓底下所有 motion 元件在首次載入時略過進場動畫。
            只放在這個 motion.div 上不會往下傳（animate 不是 variant 名稱，子元件沿用上層 context） */}
        <AnimatePresence mode="wait" onExitComplete={onExitComplete}>
          <motion.div
            key={router.route}
            initial={routeChanged.current && !reduce ? { opacity: 0, y: 8 } : false}
            animate={{ opacity: 1, y: 0, transition: reduce ? INSTANT : ENTER }}
            exit={{ opacity: 0, transition: reduce ? INSTANT : EXIT }}
            className="flex min-h-0 min-w-0 flex-1 flex-col"
          >
            {/* 淡出中的舊頁沿用離開前的 router，不會用新路由的參數重算（P1-15） */}
            <FrozenRouter>{children}</FrozenRouter>
          </motion.div>
        </AnimatePresence>
      </div>
      {/* 列印時頁尾照印，紙本上也有投資風險提示；只有可列印的 AI 報告頁不印，報告自己印出免責文字。
          /ai 在手機（D13 A2）與 lg 以上的全螢幕工作台不放頁尾，免責固定在輸入框下方 */}
      <SiteFooter className={cn(router.pathname === '/stock/[id]/report' && 'print:hidden', router.pathname === '/ai' && 'hidden sm:block lg:hidden')} />
      {/* 浮動（fixed）的提示條與按鈕任何一頁都不印，免得蓋在紙本內容上 */}
      <div className="print:hidden">
        <RiskNoticeBanner />
        {/* 對話頁會自動捲到最新訊息，浮動鈕還會蓋住送出鈕；首頁觀測台有自己的「回到頂端」 */}
        {router.pathname === '/ai' || router.pathname === '/' ? null : <ScrollToTop />}
      </div>
      {/* 站內助手小燈：放在換頁動畫外面，換頁時對話還在；面板用 portal，自己標 print:hidden */}
      <AssistantDock />
    </div>
  );
}
