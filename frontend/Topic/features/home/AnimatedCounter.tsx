import React, { useEffect, useRef, useState } from 'react';
import { useInView, useMotionValue, useSpring } from 'motion/react';
import { usePrefersReducedMotion } from '@/lib/hooks/useClientEnv';

/** 進入視窗時由 0 彈到目標值；reduced-motion 時直接顯示 */
export function AnimatedCounter({ value, decimals = 2, className }: { value: number; decimals?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  const reduce = usePrefersReducedMotion();
  const [display, setDisplay] = useState(value);
  const motionValue = useMotionValue(0);
  const spring = useSpring(motionValue, { stiffness: 100, damping: 30, mass: 1 });

  useEffect(() => {
    if (!inView || reduce) {
      setDisplay(value);
      return;
    }
    motionValue.set(0);
    const timer = setTimeout(() => motionValue.set(value), 50);
    const unsubscribe = spring.on('change', (v) => setDisplay(v));
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [inView, value, reduce, motionValue, spring]);

  return (
    <span ref={ref} className={className}>
      {display.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
    </span>
  );
}
