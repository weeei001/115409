import React from 'react';
import { motion } from 'motion/react';
import { usePrefersReducedMotion } from '@/lib/hooks/useClientEnv';

/** 區塊進場：淡入並上移 8px，時長 --dur-beam（625ms）；reduced-motion 時不做動畫 */
export function AnimatedSection({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  const reduce = usePrefersReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0 } : { duration: 0.625, delay, ease: [0.2, 0, 0, 1] }}
    >
      {children}
    </motion.div>
  );
}
