import React, { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { usePrefersReducedMotionClient } from '../lib/usePrefersReducedMotionClient';
import { ChevronUp } from 'lucide-react';

const SHOW_AFTER_PX = 300;

export const ScrollToTop: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const reduceMotion = usePrefersReducedMotionClient();

  const onScroll = useCallback(() => {
    setVisible(window.scrollY > SHOW_AFTER_PX);
  }, []);

  useEffect(() => {
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [onScroll]);

  const handleClick = () => {
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          type="button"
          onClick={handleClick}
          aria-label="回到頁面頂部"
          className="fixed z-40 flex h-12 w-12 items-center justify-center rounded-full
                     bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))]
                     right-[calc(1.5rem+env(safe-area-inset-right,0px))]
                     text-white shadow-lg
                     hover:shadow-[0_0_24px_var(--glow-brand-strong)] hover:scale-110
                     focus-visible:outline focus-visible:outline-2
                     focus-visible:outline-offset-2 focus-visible:outline-brand
                     transition-shadow cursor-pointer"
          style={{ background: 'var(--brand-gradient)' }}
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.5, y: 20 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.5, y: 20 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          <ChevronUp size={24} strokeWidth={2.5} aria-hidden />
        </motion.button>
      )}
    </AnimatePresence>
  );
};
