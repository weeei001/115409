import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';

/** SSR 與首次客戶端繪製皆為 false，mounted 後才 true，避免水合不一致 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setMatches(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [query]);
  return matches;
}

/** mounted 後才讀 prefers-reduced-motion，SSR 與第一次繪製為 false */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

/** 精細指標裝置（滑鼠）才啟用 hover tilt 之類的效果 */
export function useCanHoverTilt(): boolean {
  return useMediaQuery('(hover: hover) and (pointer: fine)');
}

export function useIsMobile(maxWidth = 1023): boolean {
  return useMediaQuery(`(max-width: ${maxWidth}px)`);
}

function subscribeDark(onChange: () => void) {
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => mo.disconnect();
}

/** 直接讀 html 是否有 dark class（給 canvas／WebGL 等需要同步判斷的地方） */
export function useHtmlDarkClass(): boolean {
  return useSyncExternalStore(
    subscribeDark,
    () => document.documentElement.classList.contains('dark'),
    () => false,
  );
}

/** 把 sticky 頁首高度寫進 --app-header-height */
export function useSyncAppHeaderHeight(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => document.documentElement.style.setProperty('--app-header-height', `${el.offsetHeight}px`);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    window.addEventListener('resize', sync);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, [ref]);
}
