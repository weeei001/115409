import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronUp } from 'lucide-react';
import { usePrefersReducedMotion } from '@/lib/hooks/useClientEnv';

const SHOW_AFTER_PX = 300;

export function ScrollToTop() {
  const [visible, setVisible] = useState(false);
  const reduce = usePrefersReducedMotion();

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > SHOW_AFTER_PX);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <AnimatePresence>
      {visible ? (
        <motion.button
          type="button"
          aria-label="回到頁面頂部"
          onClick={() => window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })}
          className="fixed right-[calc(1.5rem+var(--app-safe-area-right))] bottom-[calc(1.5rem+var(--app-safe-area-bottom))] z-40 flex size-12 items-center justify-center rounded-full bg-brand-gradient text-on-brand shadow-raised transition-shadow hover:shadow-[0_0_24px_var(--glow-brand-strong)]"
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.5, y: 20 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.5, y: 20 }}
          transition={reduce ? { duration: 0 } : { duration: 0.25 }}
        >
          <ChevronUp size={24} strokeWidth={2.5} aria-hidden />
        </motion.button>
      ) : null}
    </AnimatePresence>
  );
}
