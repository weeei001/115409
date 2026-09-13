import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/router';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bot,
  GitCompareArrows,
  House,
  LogIn,
  LogOut,
  Menu,
  ShoppingCart,
  UserRound,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { AUTH_CHANGE_EVENT, clearAuth, getStoredUser } from '../lib/auth/storage';
import type { UserPublic } from '../lib/types';
import { PRIMARY_NAV } from '../lib/nav';

function avatarLetter(user: UserPublic): string {
  const name = user.display_name?.trim();
  if (name) return name.slice(0, 1).toUpperCase();
  const email = user.email?.trim();
  if (email) return email.slice(0, 1).toUpperCase();
  return '?';
}

interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ICONS: Record<(typeof PRIMARY_NAV)[number]['path'], LucideIcon> = {
  '/': House,
  '/ai': Bot,
  '/order': ShoppingCart,
  '/compare': GitCompareArrows,
};

const NAV_ITEMS: NavItem[] = PRIMARY_NAV.map((item) => ({
  path: item.path,
  label: item.label,
  icon: NAV_ICONS[item.path],
}));

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04, delayChildren: 0.08 } },
};

const itemVariants = {
  hidden: { opacity: 0, x: 24 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] as const } },
};

export const AppNavDrawer: React.FC = () => {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<UserPublic | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    setUser(getStoredUser());
    const onAuthChange = () => setUser(getStoredUser());
    window.addEventListener(AUTH_CHANGE_EVENT, onAuthChange);
    return () => window.removeEventListener(AUTH_CHANGE_EVENT, onAuthChange);
  }, []);

  const loginHref = useMemo(() => {
    if (router.pathname === '/login' || router.pathname === '/register') return '/login';
    return { pathname: '/login' as const, query: { returnUrl: router.asPath } };
  }, [router.asPath, router.pathname]);

  const isActive = useCallback(
    (path: string) => path === '/' ? router.pathname === '/' : router.pathname.startsWith(path),
    [router.pathname],
  );

  const navigate = useCallback((path: string) => { setOpen(false); void router.push(path); }, [router]);
  const navigateLogin = useCallback(() => { setOpen(false); void router.push(loginHref); }, [router, loginHref]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      closeBtnRef.current?.focus();
    } else {
      triggerRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open || !panelRef.current) return;
    const panel = panelRef.current;
    const handleTrapFocus = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleTrapFocus);
    return () => document.removeEventListener('keydown', handleTrapFocus);
  }, [open]);

  const drawer = (
    <AnimatePresence>
      {open && (
        <motion.div
          key="app-nav-drawer"
          className="fixed inset-0 z-50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <motion.div
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm dark:bg-black/60"
            onClick={() => setOpen(false)}
          />

          <motion.div
            ref={panelRef}
            id="app-nav-drawer-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="app-nav-drawer-title"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="absolute right-0 top-0 flex h-full w-full flex-col
              pt-[var(--app-safe-area-top)] pb-[var(--app-safe-area-bottom)] pr-[var(--app-safe-area-right)]
              shadow-[var(--shadow-elevated)]
              border-l border-[var(--color-border)]
              bg-[var(--color-bg-card)]/95 backdrop-blur-2xl
              sm:max-w-sm"
          >
            <div className="flex items-center justify-between px-5 py-5">
              <h2 id="app-nav-drawer-title" className="text-xl font-bold tracking-wide gradient-text">
                股海明燈
              </h2>
              <button
                ref={closeBtnRef}
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-full
                  bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)]
                  transition-[color,background-color,transform] hover:bg-brand/10 hover:text-brand active:scale-90"
                aria-label="關閉選單"
              >
                <X size={18} aria-hidden />
              </button>
            </div>

            <div className="mx-5 h-px bg-gradient-to-r from-brand/30 via-brand-light/15 to-transparent" aria-hidden />

            <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-5 py-6">
              <section>
                <p className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
                  <span className="h-px flex-1 bg-[var(--color-border)]" aria-hidden />
                  功能
                  <span className="h-px flex-1 bg-[var(--color-border)]" aria-hidden />
                </p>
                <motion.div className="flex flex-col gap-1" variants={containerVariants} initial="hidden" animate="visible">
                  {NAV_ITEMS.map((item) => {
                    const active = isActive(item.path);
                    const Icon = item.icon;
                    return (
                      <motion.button
                        key={item.path}
                        type="button"
                        variants={itemVariants}
                        onClick={() => navigate(item.path)}
                        className={`group relative flex w-full items-center gap-3 rounded-xl px-4 py-3 min-h-12
                          text-left text-sm font-medium transition-[color,background-color,transform] duration-200 active:scale-[0.98]
                          ${active
                            ? 'bg-brand/10 text-brand-deep dark:text-brand-light'
                            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)]'
                          }`}
                      >
                        {active && (
                          <span className="absolute left-1.5 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full"
                                style={{ background: 'var(--brand-gradient)' }} aria-hidden />
                        )}
                        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors
                          ${active
                            ? 'text-white shadow-sm'
                            : 'bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] group-hover:bg-brand/10 group-hover:text-brand'
                          }`}
                          style={active ? { background: 'var(--brand-gradient)' } : undefined}
                        >
                          <Icon size={16} aria-hidden />
                        </span>
                        {item.label}
                      </motion.button>
                    );
                  })}
                </motion.div>
              </section>

              <section>
                <p className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
                  <span className="h-px flex-1 bg-[var(--color-border)]" aria-hidden />
                  帳號
                  <span className="h-px flex-1 bg-[var(--color-border)]" aria-hidden />
                </p>
                {user ? (
                  <motion.div className="flex flex-col gap-2" variants={containerVariants} initial="hidden" animate="visible">
                    <motion.div
                      variants={itemVariants}
                      className="flex items-center gap-3 rounded-2xl bg-[var(--color-bg-elevated)] px-4 py-4"
                    >
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-bold text-white shadow-lg ring-2 ring-[var(--color-bg-card)]"
                           style={{ background: 'var(--brand-gradient)' }} aria-hidden>
                        {avatarLetter(user)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{user.display_name?.trim() || user.email}</p>
                        <p className="truncate text-xs text-[var(--color-text-muted)]" title={user.email}>{user.email}</p>
                      </div>
                    </motion.div>

                    <motion.button
                      type="button" variants={itemVariants}
                      className="group relative flex w-full items-center gap-3 rounded-xl px-4 py-3 min-h-12
                        text-left text-sm font-medium text-[var(--color-text-secondary)] transition-[color,background-color,transform] duration-200
                        hover:bg-[var(--color-bg-elevated)] active:scale-[0.98]"
                      onClick={() => navigate('/me')}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] transition-colors group-hover:bg-brand/10 group-hover:text-brand">
                        <UserRound size={16} aria-hidden />
                      </span>
                      個人中心
                    </motion.button>

                    <motion.button
                      type="button" variants={itemVariants}
                      className="group relative flex w-full items-center gap-3 rounded-xl px-4 py-3 min-h-12
                        text-left text-sm font-medium text-[var(--color-text-secondary)] transition-[color,background-color,transform] duration-200
                        hover:bg-up-muted hover:text-up active:scale-[0.98]"
                      onClick={() => { clearAuth(); setUser(null); setOpen(false); }}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] transition-colors group-hover:bg-up-muted group-hover:text-up">
                        <LogOut size={16} aria-hidden />
                      </span>
                      登出
                    </motion.button>
                  </motion.div>
                ) : (
                  <motion.button
                    type="button" onClick={navigateLogin} variants={itemVariants} initial="hidden" animate="visible"
                    className="btn-shimmer-hover relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl
                      px-4 py-3 min-h-12 text-sm font-semibold text-white
                      shadow-lg transition-shadow hover:shadow-xl active:scale-[0.98]"
                    style={{ background: 'var(--brand-gradient)' }}
                  >
                    <LogIn size={18} aria-hidden />
                    登入
                    <span
                      className="btn-shimmer-overlay pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                      aria-hidden
                    />
                  </motion.button>
                )}
              </section>
            </div>

            <div className="flex-shrink-0 border-t border-[var(--color-border)] bg-[var(--color-bg-card)]/80 px-5 py-4 backdrop-blur-md">
              <div className="flex items-center justify-between rounded-xl bg-[var(--color-bg-elevated)] px-4 py-3">
                <span className="text-sm font-medium text-[var(--color-text-secondary)]">主題模式</span>
                <ThemeToggle />
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-xl border border-[var(--color-border)]
          bg-[var(--color-bg-card)] px-3 py-3 min-h-11
          text-sm font-medium text-[var(--color-text-secondary)] shadow-sm transition-[color,border-color,box-shadow,transform]
          hover:border-brand/40 hover:text-brand hover:shadow-md active:scale-95"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="開啟主選單"
        aria-controls={open ? 'app-nav-drawer-panel' : undefined}
      >
        <Menu size={20} className="shrink-0 text-brand" aria-hidden />
        <span className={user ? 'inline text-[var(--color-text-primary)]' : 'hidden sm:inline text-[var(--color-text-primary)]'}>
          選單
        </span>
      </button>
      {mounted ? createPortal(drawer, document.body) : null}
    </>
  );
};
