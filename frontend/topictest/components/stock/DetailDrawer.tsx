import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import { usePrefersReducedMotionClient } from '../../lib/usePrefersReducedMotionClient';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: React.ReactNode;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
}

export const DetailDrawer: React.FC<Props> = ({
  open,
  onClose,
  title,
  subtitle,
  headerActions,
  children,
}) => {
  const [mounted, setMounted] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [animatedIn, setAnimatedIn] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const reduceMotion = usePrefersReducedMotionClient();
  const titleId = React.useId();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Sync render/animation phases with `open` prop so exit animation can play before unmount.
  useEffect(() => {
    if (open) {
      setRendered(true);
      const id = window.requestAnimationFrame(() => setAnimatedIn(true));
      return () => window.cancelAnimationFrame(id);
    }
    if (rendered) {
      setAnimatedIn(false);
      const duration = reduceMotion ? 150 : 320;
      const id = window.setTimeout(() => setRendered(false), duration + 30);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [open, rendered, reduceMotion]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => closeBtnRef.current?.focus(), 50);
    return () => {
      window.clearTimeout(t);
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open || !panelRef.current) return;
    const panel = panelRef.current;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusables = panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  if (!mounted || !rendered) return null;

  const panelTransform = reduceMotion
    ? animatedIn
      ? 'none'
      : 'none'
    : animatedIn
      ? 'translateX(0%)'
      : 'translateX(100%)';
  const panelOpacity = animatedIn ? 1 : 0;
  const backdropOpacity = animatedIn ? 1 : 0;
  const transitionMs = reduceMotion ? 150 : 320;

  const node = (
    <div className="fixed inset-0 z-[60]">
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm dark:bg-black/60 transition-opacity"
        style={{ opacity: backdropOpacity, transitionDuration: `${transitionMs}ms` }}
      />
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute right-0 top-0 flex h-[100dvh] w-full flex-col border-l border-[var(--color-border)] bg-[var(--color-bg-card)]/95 pt-[var(--app-safe-area-top)] backdrop-blur-2xl shadow-[var(--shadow-elevated)] transition-[transform,opacity] sm:w-[min(1100px,90vw)]"
        style={{
          transform: panelTransform,
          opacity: panelOpacity,
          transitionDuration: `${transitionMs}ms`,
          transitionTimingFunction: 'cubic-bezier(0.32, 0.72, 0, 1)',
        }}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg-card)]/95 backdrop-blur-2xl px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-bold text-[var(--color-text-primary)] truncate">
              {title}
            </h2>
            {subtitle ? (
              <div className="mt-0.5 text-xs text-[var(--color-text-muted)] min-w-0">{subtitle}</div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {headerActions ? (
              <>
                {headerActions}
                <div aria-hidden className="hidden sm:block h-6 w-px bg-[var(--color-border)]" />
              </>
            ) : null}
            <button
              ref={closeBtnRef}
              type="button"
              onClick={onClose}
              aria-label="關閉"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] transition-[color,background-color,transform] hover:bg-brand/10 hover:text-brand active:scale-90 cursor-pointer"
            >
              <X size={18} aria-hidden />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-6 py-5">{children}</div>
      </motion.div>
    </div>
  );

  return createPortal(node, document.body);
};
