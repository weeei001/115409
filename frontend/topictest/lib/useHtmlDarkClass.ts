import { useSyncExternalStore } from 'react';

/**
 * 與全站主題一致：直接讀取 `document.documentElement` 是否含 `dark` class
 *（由 _document inline script 與 ThemeProvider 共同維護），避免 React state 初次 render 不同步。
 */
function subscribe(onStoreChange: () => void) {
  const el = document.documentElement;
  const mo = new MutationObserver(onStoreChange);
  mo.observe(el, { attributes: true, attributeFilter: ['class'] });
  return () => mo.disconnect();
}

function getSnapshot(): boolean {
  return document.documentElement.classList.contains('dark');
}

function getServerSnapshot(): boolean {
  return false;
}

export function useHtmlDarkClass(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
