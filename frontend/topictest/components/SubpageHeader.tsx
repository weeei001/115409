import React from 'react';
import { useRouter } from 'next/router';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, type LucideIcon } from 'lucide-react';
import { AppNavDrawer } from './AppNavDrawer';
import { ThemeToggle } from './ThemeToggle';

export interface SubpageHeaderProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  rightExtra?: React.ReactNode;
}

export const SubpageHeader: React.FC<SubpageHeaderProps> = ({
  icon: Icon,
  title,
  subtitle,
  rightExtra,
}) => {
  const router = useRouter();
  const reduceMotion = useReducedMotion();

  return (
    <header className="sticky top-0 z-50 flex-shrink-0 m-0 sm:mx-4 sm:mt-3">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 rounded-none sm:rounded-2xl glass shadow-[var(--shadow-elevated)]">
        <motion.div
          className="flex items-center justify-between gap-4"
          initial={reduceMotion ? false : { opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.4 }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => router.push('/')}
              aria-label="返回首頁"
              className="flex-shrink-0 p-2 rounded-lg border border-[var(--color-border)]
                         text-[var(--color-text-secondary)] hover:border-brand/40 hover:text-brand
                         transition-colors"
            >
              <ArrowLeft size={20} aria-hidden />
            </button>
            <div className="w-10 h-10 flex-shrink-0 rounded-xl flex items-center justify-center shadow-lg"
                 style={{ background: 'var(--brand-gradient)' }}>
              <Icon size={20} className="text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold tracking-tight text-balance truncate">{title}</h1>
              {subtitle && (
                <p className="text-xs text-[var(--color-text-muted)] text-pretty truncate">{subtitle}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <AppNavDrawer />
            {rightExtra}
            <ThemeToggle />
          </div>
        </motion.div>
      </div>
    </header>
  );
};
