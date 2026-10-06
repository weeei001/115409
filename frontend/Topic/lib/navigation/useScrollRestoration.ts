import { useCallback, useEffect, useRef } from 'react';
import Router from 'next/router';
import { browserRestoreEnv, isHistoryTraversal, restoreWhenReady, ScrollMemory, shouldRestoreScroll } from './scrollRestoration';

/** 重新整理、從外站按上一頁回來時，整頁重新載入，Next 會換掉 history.state.key：離開前另外記一筆網址與位置 */
const UNLOAD_SLOT = 'tei:scroll-on-unload';
/** 淡出沒有結束（例如換頁被打斷）時，最晚多久開始還原 */
const EXIT_FALLBACK_MS = 600;

const historyKey = (): string => {
  const state = window.history.state as { key?: unknown } | null;
  return typeof state?.key === 'string' ? state.key : '';
};

const memory = new ScrollMemory();

/**
 * AppShell 用：上一頁、下一頁回到原本的捲動位置（P1-14）。
 * animated 為 true 時（有換頁淡出），等 AnimatePresence 的 onExitComplete 才開始；回傳的函式要接到 onExitComplete。
 */
export function useScrollRestoration(animated: boolean): () => void {
  const animatedRef = useRef(animated);
  animatedRef.current = animated;
  const exitRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!('scrollRestoration' in window.history)) return;
    const previousMode = window.history.scrollRestoration;
    // 瀏覽器自己還原時，會把位置套在還在淡出的舊頁上，接著被 Next 換頁時捲回頂端；改由這裡處理
    window.history.scrollRestoration = 'manual';

    const env = browserRestoreEnv();
    // Next 在初始化時才用 replaceState 寫入第一頁的 key，而且是非同步的（router.js 的 _initialMatchesMiddlewarePromise），
    // 掛載時可能還讀不到：留空，第一次要用時再讀（pageKey）
    let currentKey = historyKey();
    let currentRoute = Router.route;
    /** 換頁中或還原中：這段期間的捲動不是使用者在這一頁的位置，不記 */
    let busy = false;
    let navIsPop = false;
    let cancelRestore: (() => void) | null = null;
    let exitTimer = 0;
    let saveFrame = 0;

    const stopRestore = () => {
      cancelRestore?.();
      cancelRestore = null;
      exitRef.current = null;
      window.clearTimeout(exitTimer);
    };
    const restore = (target: number) => {
      exitRef.current = null;
      window.clearTimeout(exitTimer);
      cancelRestore = restoreWhenReady(target, env, () => {
        cancelRestore = null;
        busy = false;
      });
    };

    /** 目前這一頁的 key（還沒讀到就現在讀；捲動時一定還在這一頁） */
    const pageKey = () => {
      if (!currentKey) currentKey = historyKey();
      return currentKey;
    };
    const save = () => {
      saveFrame = 0;
      if (!busy) memory.set(pageKey(), window.scrollY);
    };
    const onScroll = () => {
      if (!saveFrame) saveFrame = requestAnimationFrame(save);
    };
    const onStart = () => {
      // 不用 popstate 判斷：從快取換頁時 Next 的 change() 全在 microtask 裡跑完，
      // 其他 popstate 監聽要等到 routeChangeComplete 之後才輪到。改看 history.state 的 key（isHistoryTraversal）
      const stateKey = historyKey();
      navIsPop = isHistoryTraversal(currentKey, stateKey);
      if (!currentKey) currentKey = stateKey;
      // 離開前的位置記在自己記的 key 下（上一頁時 history.state 已經是目的地）
      if (!busy) memory.set(currentKey, window.scrollY);
      stopRestore();
      busy = true;
    };
    const onComplete = (asPath: string) => {
      const isPop = navIsPop;
      navIsPop = false;
      currentKey = historyKey();
      const routeChanged = Router.route !== currentRoute;
      currentRoute = Router.route;
      const target = isPop && shouldRestoreScroll(asPath) ? memory.get(currentKey) : null;
      if (!target) {
        busy = false;
        return;
      }
      // 換到不同的頁面元件才有淡出；同一個頁面換參數（例如 /stock/2330 → /stock/2317）不會有
      if (animatedRef.current && routeChanged) {
        exitRef.current = () => restore(target);
        exitTimer = window.setTimeout(() => exitRef.current?.(), EXIT_FALLBACK_MS);
      } else {
        restore(target);
      }
    };
    const onError = () => {
      navIsPop = false;
      busy = false;
    };
    const onPageHide = () => {
      try {
        sessionStorage.setItem(UNLOAD_SLOT, JSON.stringify({ href: window.location.href, y: window.scrollY }));
      } catch {
        /* 無痕模式或停用儲存空間：重新整理後就停在頁首 */
      }
    };

    // 整頁載入：重新整理或從外站按上一頁回來，才還原離開前記下的位置
    const navigation = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (navigation && (navigation.type === 'reload' || navigation.type === 'back_forward')) {
      try {
        const saved = JSON.parse(sessionStorage.getItem(UNLOAD_SLOT) ?? 'null') as { href?: unknown; y?: unknown } | null;
        if (saved?.href === window.location.href && typeof saved.y === 'number' && saved.y > 0 && shouldRestoreScroll(Router.asPath)) {
          busy = true;
          restore(saved.y);
        }
      } catch {
        /* 讀不到就不還原 */
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', onPageHide);
    Router.events.on('routeChangeStart', onStart);
    Router.events.on('routeChangeComplete', onComplete);
    Router.events.on('routeChangeError', onError);
    return () => {
      stopRestore();
      if (saveFrame) cancelAnimationFrame(saveFrame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', onPageHide);
      Router.events.off('routeChangeStart', onStart);
      Router.events.off('routeChangeComplete', onComplete);
      Router.events.off('routeChangeError', onError);
      window.history.scrollRestoration = previousMode;
    };
  }, []);

  return useCallback(() => exitRef.current?.(), []);
}
