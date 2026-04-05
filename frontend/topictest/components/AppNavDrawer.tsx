import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/router';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bot,
  BrainCircuit,
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

const NAV_ITEMS: NavItem[] = [
  { path: '/', label: '首頁', icon: House },
  { path: '/advisor', label: '投資顧問', icon: BrainCircuit },
  { path: '/ai', label: 'AI 顧問', icon: Bot },
  { path: '/order', label: '模擬下單', icon: ShoppingCart },
  { path: '/compare', label: '多股比較', icon: GitCompareArrows },
];

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

  useEffect(() => {
    setMounted(true);
  }, []);

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
    (path: string) => {
      if (path === '/') return router.pathname === '/';
      return router.pathname.startsWith(path);
    },
    [router.pathname],
  );

  const navigate = useCallback(
    (path: string) => {
      setOpen(false);
      void router.push(path);
    },
    [router],
  );

  const navigateLogin = useCallback(() => {
    setOpen(false);
    void router.push(loginHref);
  }, [router, loginHref]);

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
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      closeBtnRef.current?.focus();
    }
  }, [open]);

  const drawer = (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="app-nav-drawer"
          className="fixed inset-0 z-[100]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* backdrop */}
          <motion.div
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px] dark:bg-black/60"
            onClick={() => setOpen(false)}
          />

          {/* panel */}
          <motion.div
            id="app-nav-drawer-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="app-nav-drawer-title"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="absolute right-0 top-0 flex h-full w-full flex-col shadow-2xl
              border-l-2 border-[#ffa95a]/30 dark:border-[#ffa95a]/20
              bg-white/95 backdrop-blur-xl
              dark:bg-gray-900/85 dark:backdrop-blur-xl
              sm:max-w-sm"
          >
            {/* header */}
            <div className="flex items-center justify-between px-5 py-5">
              <h2
                id="app-nav-drawer-title"
                className="bg-gradient-to-r from-[#ffa95a] to-[#ffd45a] bg-clip-text text-xl font-bold tracking-wide text-transparent"
              >
                股海明燈
              </h2>
              <button
                ref={closeBtnRef}
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-full
                  bg-gray-100/80 text-gray-500
                  transition-all hover:bg-[#ffa95a]/15 hover:text-[#ffa95a]
                  active:scale-90
                  dark:bg-gray-700/60 dark:text-gray-400 dark:hover:bg-[#ffa95a]/20"
                aria-label="關閉選單"
              >
                <X size={18} aria-hidden />
              </button>
            </div>

            <div className="mx-5 h-px bg-gradient-to-r from-[#ffa95a]/40 via-[#ffd45a]/20 to-transparent" aria-hidden />

            {/* scrollable content */}
            <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-5 py-6">
              {/* nav section */}
              <section>
                <p className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
                  <span className="h-px flex-1 bg-gray-200/60 dark:bg-gray-700/60" aria-hidden />
                  功能
                  <span className="h-px flex-1 bg-gray-200/60 dark:bg-gray-700/60" aria-hidden />
                </p>
                <motion.div
                  className="flex flex-col gap-1"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                >
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
                          text-left text-sm font-medium transition-all duration-200 active:scale-[0.98]
                          ${active
                            ? 'bg-[#ffa95a]/10 text-[#e88a2d] dark:bg-[#ffa95a]/15 dark:text-[#ffc87a]'
                            : 'text-gray-600 hover:bg-gray-100/70 dark:text-gray-300 dark:hover:bg-gray-700/50'
                          }`}
                      >
                        {active && (
                          <span
                            className="absolute left-1.5 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-gradient-to-b from-[#ffa95a] to-[#ffd45a]"
                            aria-hidden
                          />
                        )}
                        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors
                          ${active
                            ? 'bg-gradient-to-br from-[#ffa95a] to-[#ffd45a] text-white shadow-sm shadow-[#ffa95a]/20'
                            : 'bg-gray-100/80 text-gray-500 group-hover:bg-[#ffa95a]/15 group-hover:text-[#ffa95a] dark:bg-gray-700/60 dark:text-gray-400'
                          }`}>
                          <Icon size={16} aria-hidden />
                        </span>
                        {item.label}
                      </motion.button>
                    );
                  })}
                </motion.div>
              </section>

              {/* account section */}
              <section>
                <p className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
                  <span className="h-px flex-1 bg-gray-200/60 dark:bg-gray-700/60" aria-hidden />
                  帳號
                  <span className="h-px flex-1 bg-gray-200/60 dark:bg-gray-700/60" aria-hidden />
                </p>
                {user ? (
                  <motion.div
                    className="flex flex-col gap-2"
                    variants={containerVariants}
                    initial="hidden"
                    animate="visible"
                  >
                    <motion.div
                      variants={itemVariants}
                      className="flex items-center gap-3 rounded-2xl bg-gradient-to-br from-gray-50/80 to-gray-100/50 px-4 py-4 dark:from-gray-800/60 dark:to-gray-700/40"
                    >
                      <div
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#ffa95a] to-[#ffd45a] text-base font-bold text-white shadow-lg shadow-[#ffa95a]/25 ring-2 ring-white/80 dark:ring-gray-800/80"
                        aria-hidden
                      >
                        {avatarLetter(user)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                          {user.display_name?.trim() || user.email}
                        </p>
                        <p className="truncate text-xs text-gray-500 dark:text-gray-400" title={user.email}>
                          {user.email}
                        </p>
                      </div>
                    </motion.div>

                    <motion.button
                      type="button"
                      variants={itemVariants}
                      className="group relative flex w-full items-center gap-3 rounded-xl px-4 py-3 min-h-12
                        text-left text-sm font-medium text-gray-600 transition-all duration-200
                        hover:bg-gray-100/70 active:scale-[0.98]
                        dark:text-gray-300 dark:hover:bg-gray-700/50"
                      onClick={() => navigate('/me')}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100/80 text-gray-500 transition-colors group-hover:bg-[#ffa95a]/15 group-hover:text-[#ffa95a] dark:bg-gray-700/60 dark:text-gray-400">
                        <UserRound size={16} aria-hidden />
                      </span>
                      個人中心
                    </motion.button>

                    <motion.button
                      type="button"
                      variants={itemVariants}
                      className="group relative flex w-full items-center gap-3 rounded-xl px-4 py-3 min-h-12
                        text-left text-sm font-medium text-gray-600 transition-all duration-200
                        hover:bg-rose-50/80 hover:text-rose-600 active:scale-[0.98]
                        dark:text-gray-300 dark:hover:bg-rose-500/10 dark:hover:text-rose-300"
                      onClick={() => {
                        clearAuth();
                        setUser(null);
                        setOpen(false);
                      }}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100/80 text-gray-500 transition-colors group-hover:bg-rose-100 group-hover:text-rose-500 dark:bg-gray-700/60 dark:text-gray-400 dark:group-hover:bg-rose-500/15">
                        <LogOut size={16} aria-hidden />
                      </span>
                      登出
                    </motion.button>
                  </motion.div>
                ) : (
                  <motion.button
                    type="button"
                    onClick={navigateLogin}
                    variants={itemVariants}
                    initial="hidden"
                    animate="visible"
                    className="relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl
                      bg-gradient-to-r from-[#ffa95a] to-[#ffd45a]
                      px-4 py-3 min-h-12 text-sm font-semibold text-white
                      shadow-lg shadow-[#ffa95a]/25 transition-shadow hover:shadow-xl active:scale-[0.98]"
                  >
                    <LogIn size={18} aria-hidden />
                    登入
                    <span
                      className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer_3s_infinite] bg-gradient-to-r from-transparent via-white/25 to-transparent"
                      aria-hidden
                      style={{ animationName: 'shimmer' }}
                    />
                  </motion.button>
                )}
              </section>
            </div>

            {/* sticky bottom appearance section */}
            <div className="flex-shrink-0 border-t border-gray-200/60 bg-white/60 px-5 py-4 backdrop-blur-md dark:border-gray-700/60 dark:bg-gray-900/60">
              <div className="flex items-center justify-between rounded-xl bg-gray-50/80 px-4 py-3 dark:bg-gray-800/60">
                <span className="text-sm font-medium text-gray-600 dark:text-gray-300">主題模式</span>
                <ThemeToggle />
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-3 min-h-11
          text-sm font-medium text-gray-600 shadow-sm transition-all
          hover:border-[#ffa95a] hover:text-[#ffa95a] hover:shadow-md
          active:scale-95
          dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? 'app-nav-drawer-panel' : undefined}
      >
        <Menu size={20} className="shrink-0 text-[#ffa95a]" aria-hidden />
        <span className={user ? 'inline' : 'hidden sm:inline'}>選單</span>
      </button>
      {mounted ? createPortal(drawer, document.body) : null}
    </>
  );
};
