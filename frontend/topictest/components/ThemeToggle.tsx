import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../lib/ThemeContext';
import { usePrefersReducedMotionClient } from '../lib/usePrefersReducedMotionClient';

export function ThemeToggle() {
  const { theme, mounted, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const reduceMotion = usePrefersReducedMotionClient();

  if (!mounted) {
    return (
      <div className="w-11 h-11 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)]" />
    );
  }

  return (
    <button
      onClick={toggleTheme}
      className="relative w-11 h-11 rounded-xl border border-[var(--color-border)]
                 bg-[var(--color-bg-card)] flex items-center justify-center overflow-hidden
                 hover:border-brand/40 hover:shadow-[0_0_16px_var(--glow-brand)]
                 transition-[color,background-color,transform] duration-300 cursor-pointer"
      aria-label={isDark ? '切換至亮色模式' : '切換至暗色模式'}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={theme}
          initial={reduceMotion ? { opacity: 0 } : { y: -24, opacity: 0, rotate: -90, scale: 0.5 }}
          animate={reduceMotion ? { opacity: 1 } : { y: 0, opacity: 1, rotate: 0, scale: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { y: 24, opacity: 0, rotate: 90, scale: 0.5 }}
          transition={reduceMotion ? { duration: 0 } : {
            type: 'spring',
            stiffness: 200,
            damping: 15,
            mass: 0.8,
          }}
        >
          {isDark ? (
            <Sun size={18} className="text-brand drop-shadow-[0_0_8px_rgba(212,165,116,0.6)]" />
          ) : (
            <Moon size={18} className="text-[var(--color-text-secondary)]" />
          )}
        </motion.div>
      </AnimatePresence>
    </button>
  );
}
