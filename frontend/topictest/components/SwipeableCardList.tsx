import React, { useCallback, useRef, useState } from 'react';
import { motion, useMotionValue, useTransform, animate } from 'motion/react';
import { clsx } from 'clsx';

interface SwipeableCardListProps {
  children: React.ReactNode[];
  className?: string;
}

export function SwipeableCardList({ children, className }: SwipeableCardListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const x = useMotionValue(0);
  const count = children.length;

  const getCardWidth = useCallback(() => {
    if (!containerRef.current) return 280;
    return containerRef.current.offsetWidth * 0.82;
  }, []);

  const snapTo = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(index, count - 1));
      setActiveIndex(clamped);
      const cardW = getCardWidth();
      const gap = 12;
      animate(x, -(clamped * (cardW + gap)), {
        type: 'spring',
        stiffness: 300,
        damping: 30,
      });
    },
    [count, x, getCardWidth],
  );

  const handleDragEnd = useCallback(
    (_: unknown, info: { velocity: { x: number }; offset: { x: number } }) => {
      const cardW = getCardWidth();
      const swipe = info.velocity.x;
      const offset = info.offset.x;

      let newIndex = activeIndex;
      if (swipe < -300 || offset < -cardW * 0.3) {
        newIndex = activeIndex + 1;
      } else if (swipe > 300 || offset > cardW * 0.3) {
        newIndex = activeIndex - 1;
      }
      snapTo(newIndex);
    },
    [activeIndex, snapTo, getCardWidth],
  );

  const dragConstraints = {
    left: -((count - 1) * (getCardWidth() + 12)),
    right: 0,
  };

  return (
    <div className={clsx('sm:hidden', className)}>
      <div ref={containerRef} className="overflow-hidden">
        <motion.div
          className="flex gap-3 px-1 py-1"
          style={{ x }}
          drag="x"
          dragConstraints={dragConstraints}
          dragElastic={0.15}
          onDragEnd={handleDragEnd}
        >
          {children.map((child, i) => {
            const scale = useTransform(x, (xVal) => {
              const cardW = getCardWidth();
              const gap = 12;
              const center = -(i * (cardW + gap));
              const dist = Math.abs(xVal - center);
              return Math.max(0.92, 1 - dist / (cardW * 4));
            });

            return (
              <motion.div
                key={i}
                className="shrink-0"
                style={{ width: '82%', scale }}
              >
                {child}
              </motion.div>
            );
          })}
        </motion.div>
      </div>

      {count > 1 && (
        <div className="flex justify-center gap-1.5 mt-3" role="tablist" aria-label="卡片頁碼">
          {Array.from({ length: count }).map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === activeIndex}
              aria-label={`第 ${i + 1} 張`}
              onClick={() => snapTo(i)}
              className={clsx(
                'h-1.5 rounded-full transition-all duration-300',
                i === activeIndex
                  ? 'w-6 bg-brand'
                  : 'w-1.5 bg-[var(--color-border)]',
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
