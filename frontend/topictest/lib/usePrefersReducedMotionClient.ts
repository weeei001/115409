import { useEffect, useState } from 'react';

/**
 * 只在客戶端 mounted 後才讀取 prefers-reduced-motion。
 * SSR 與第一次客戶端繪製皆為 false，避免與 Motion 組合時水合不一致。
 */
export function usePrefersReducedMotionClient(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const handler = () => setReduced(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}
