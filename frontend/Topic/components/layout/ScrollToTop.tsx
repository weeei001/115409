import { useEffect, useState } from 'react';
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
          className="fixed right-[calc(1.5rem+var(--app-safe-area-right))] bottom-[calc(1.5rem+var(--app-safe-area-bottom))] z-40 hidden size-12 items-center lg:flex justify-center rounded-md border border-border-strong bg-card text-foreground shadow-raised transition-colors duration-(--dur-flash) hover:bg-accent focus-lamp"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
          transition={reduce ? { duration: 0 } : { duration: 0.25 }}
        >
          <ChevronUp size={22} aria-hidden />
        </motion.button>
      ) : null}
    </AnimatePresence>
  );
}
