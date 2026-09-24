import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/lib/theme/ThemeContext';
import { usePrefersReducedMotion } from '@/lib/hooks/useClientEnv';
import { cn } from '@/lib/cn';

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, mounted, toggleTheme } = useTheme();
  const reduce = usePrefersReducedMotion();
  const isDark = theme === 'dark';
  const base = 'relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-card';

  if (!mounted) return <div className={cn(base, className)} aria-hidden />;

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? '切換至亮色模式' : '切換至暗色模式'}
      className={cn(base, 'transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-[0_0_16px_var(--glow-brand)]', className)}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={theme}
          initial={reduce ? { opacity: 0 } : { y: -20, opacity: 0, rotate: -90, scale: 0.5 }}
          animate={reduce ? { opacity: 1 } : { y: 0, opacity: 1, rotate: 0, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { y: 20, opacity: 0, rotate: 90, scale: 0.5 }}
          transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 200, damping: 15, mass: 0.8 }}
          className="flex"
        >
          {isDark ? <Sun size={18} className="text-brand" aria-hidden /> : <Moon size={18} className="text-subtle" aria-hidden />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
