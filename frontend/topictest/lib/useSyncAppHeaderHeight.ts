import { useEffect, type RefObject } from 'react';

/** 將 sticky 頁首高度寫入 --app-header-height，供 StockSectionNav 等使用 */
export function useSyncAppHeaderHeight(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === 'undefined') return;

    const sync = () => {
      document.documentElement.style.setProperty('--app-header-height', `${el.offsetHeight}px`);
    };

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
