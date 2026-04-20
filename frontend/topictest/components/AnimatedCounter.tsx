import React, { useEffect, useRef, useState } from 'react';
import { useInView, useReducedMotion, useSpring, useMotionValue } from 'motion/react';

interface AnimatedCounterProps {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}

export function AnimatedCounter({
  value,
  decimals = 2,
  prefix = '',
  suffix = '',
  className = '',
}: AnimatedCounterProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  const reduceMotion = useReducedMotion();
  const [display, setDisplay] = useState(value);

  const motionValue = useMotionValue(0);
  const spring = useSpring(motionValue, {
    stiffness: 100,
    damping: 30,
    mass: 1,
  });

  useEffect(() => {
    if (!inView || reduceMotion) {
      setDisplay(value);
      return;
    }

    motionValue.set(0);
    const timeout = setTimeout(() => motionValue.set(value), 50);

    const unsub = spring.on('change', (v) => setDisplay(v));
    return () => {
      clearTimeout(timeout);
      unsub();
    };
  }, [inView, value, reduceMotion, motionValue, spring]);

  const formatted = display.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return (
    <span ref={ref} className={`tabular-nums ${className}`}>
      {prefix}{formatted}{suffix}
    </span>
  );
}
