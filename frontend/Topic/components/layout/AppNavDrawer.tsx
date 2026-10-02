import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { motion } from 'motion/react';
import { Bell, Bot, GitCompareArrows, House, LogIn, LogOut, Menu, ShieldCheck, ShoppingCart, Star, UserRound, type LucideIcon } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { ThemeToggle } from './ThemeToggle';
import { AUTH_CHANGE_EVENT, clearAuth, getStoredUser, getToken } from '@/lib/auth/storage';
import { adminMe } from '@/lib/api/admin';
import type { UserPublic } from '@/lib/types/api';
import { PRIMARY_NAV } from '@/lib/nav';
import { usePrefersReducedMotion } from '@/lib/hooks/useClientEnv';
import { cn } from '@/lib/cn';

const NAV_ICONS: Record<(typeof PRIMARY_NAV)[number]['path'], LucideIcon> = {
  '/': House,
  '/favorites': Star,
  '/notifications': Bell,
  '/ai': Bot,
  '/order': ShoppingCart,
  '/compare': GitCompareArrows,
};

function avatarLetter(user: UserPublic): string {
  const source = user.display_name?.trim() || user.email?.trim();
  return source ? source.slice(0, 1).toUpperCase() : '?';
}

const itemClass =
  'group relative flex min-h-12 w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-sm font-medium transition-[color,background-color,transform] duration-200 active:scale-[0.98]';

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 flex items-center gap-2 text-[11px] font-semibold tracking-widest text-muted-foreground">
      <span className="h-px flex-1 bg-border" aria-hidden />
      {children}
      <span className="h-px flex-1 bg-border" aria-hidden />
    </p>
  );
}

/** 主選單抽屜：Esc 關閉、focus trap、鎖背景捲動、關閉後焦點回到觸發鈕都由 Radix 處理 */
export function AppNavDrawer() {
  const router = useRouter();
  const reduce = usePrefersReducedMotion();
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<UserPublic | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    const sync = () => {
      setUser(getStoredUser());
      setIsAdmin(false);
      controller?.abort();
      const token = getToken();
      if (!token) return;
      controller = new AbortController();
      const signal = controller.signal;
      void adminMe(signal).then(() => {
        if (active && !signal.aborted && token === getToken()) setIsAdmin(true);
      }).catch(() => {
        if (active && !signal.aborted) setIsAdmin(false);
      });
    };
    sync();
    window.addEventListener(AUTH_CHANGE_EVENT, sync);
    window.addEventListener('focus', sync);
    return () => {
      active = false;
      controller?.abort();
      window.removeEventListener(AUTH_CHANGE_EVENT, sync);
      window.removeEventListener('focus', sync);
    };
  }, [open]);

  const loginHref = useMemo(() => {
    if (router.pathname === '/login' || router.pathname === '/register') return '/login';
    return { pathname: '/login', query: { returnUrl: router.asPath } };
  }, [router.asPath, router.pathname]);

  const isActive = (path: string) => (path === '/' ? router.pathname === '/' : router.pathname.startsWith(path));
  const go = (href: Parameters<typeof router.push>[0]) => {
    setOpen(false);
    void router.push(href);
  };

  const enter = (i: number) =>
    reduce
      ? {}
      : { initial: { opacity: 0, x: 24 }, animate: { opacity: 1, x: 0 }, transition: { duration: 0.25, delay: 0.08 + i * 0.04 } };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="開啟主選單"
          className="flex min-h-11 items-center gap-2 rounded-lg border bg-card px-3 text-sm font-medium shadow-card transition-[border-color,box-shadow] hover:border-border-strong hover:text-brand-text"
        >
          <Menu size={20} className="shrink-0 text-brand" aria-hidden />
          <span className={user ? 'inline' : 'hidden sm:inline'}>選單</span>
        </button>
      </SheetTrigger>
      <SheetContent
        side="right"
        closeLabel="關閉選單"
        className="w-full gap-0 border-l bg-card/95 p-0 pt-[var(--app-safe-area-top)] pb-[var(--app-safe-area-bottom)] backdrop-blur-2xl sm:max-w-sm"
      >
        <SheetHeader className="px-5 pt-5 pb-4">
          <SheetTitle className="text-xl font-bold tracking-wide text-brand-gradient">股海明燈</SheetTitle>
          <SheetDescription className="sr-only">網站功能與帳號</SheetDescription>
        </SheetHeader>
        <div className="mx-5 h-px bg-gradient-to-r from-brand/30 via-brand-light/15 to-transparent" aria-hidden />

        <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-5 py-6">
          <section>
            <SectionLabel>功能</SectionLabel>
            <div className="flex flex-col gap-1">
              {PRIMARY_NAV.map((item, i) => {
                const Icon = NAV_ICONS[item.path];
                const active = isActive(item.path);
                return (
                  <motion.button
                    key={item.path}
                    type="button"
                    {...enter(i)}
                    onClick={() => go(item.path)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(itemClass, active ? 'bg-accent text-accent-foreground' : 'text-subtle hover:bg-muted')}
                  >
                    {active ? <span className="absolute top-1/2 left-1.5 h-5 w-1 -translate-y-1/2 rounded-full bg-brand-gradient" aria-hidden /> : null}
                    <span
                      className={cn(
                        'flex size-8 shrink-0 items-center justify-center rounded-md transition-colors',
                        active ? 'bg-brand-gradient text-on-brand' : 'bg-muted text-muted-foreground group-hover:bg-accent group-hover:text-accent-foreground',
                      )}
                    >
                      <Icon size={16} aria-hidden />
                    </span>
                    {item.label}
                  </motion.button>
                );
              })}
            </div>
          </section>

          <section>
            <SectionLabel>帳號</SectionLabel>
            {user ? (
              <div className="flex flex-col gap-2">
                <motion.div {...enter(0)} className="flex items-center gap-3 rounded-xl bg-muted px-4 py-4">
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-base font-bold text-on-brand ring-2 ring-card" aria-hidden>
                    {avatarLetter(user)}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{user.display_name?.trim() || user.email}</p>
                    <p className="truncate text-xs text-muted-foreground" title={user.email}>
                      {user.email}
                    </p>
                  </div>
                </motion.div>
                <motion.button type="button" {...enter(1)} onClick={() => go('/me')} className={cn(itemClass, 'text-subtle hover:bg-muted')}>
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:bg-accent group-hover:text-accent-foreground">
                    <UserRound size={16} aria-hidden />
                  </span>
                  個人中心
                </motion.button>
                {isAdmin ? <motion.button type="button" {...enter(2)} onClick={() => go('/admin')} aria-current={isActive('/admin') ? 'page' : undefined} className={cn(itemClass, isActive('/admin') ? 'bg-accent text-accent-foreground' : 'text-subtle hover:bg-muted')}>
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:bg-accent group-hover:text-accent-foreground"><ShieldCheck size={16} aria-hidden /></span>
                  管理後台
                </motion.button> : null}
                <motion.button
                  type="button"
                  {...enter(2)}
                  onClick={() => {
                    clearAuth();
                    setUser(null);
                    setOpen(false);
                  }}
                  className={cn(itemClass, 'text-subtle hover:bg-danger-muted hover:text-danger')}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:bg-danger-muted group-hover:text-danger">
                    <LogOut size={16} aria-hidden />
                  </span>
                  登出
                </motion.button>
              </div>
            ) : (
              <motion.button
                type="button"
                {...enter(0)}
                onClick={() => go(loginHref)}
                className="group relative flex min-h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-lg bg-brand-gradient px-4 py-3 text-sm font-semibold text-on-brand shadow-card transition-shadow hover:shadow-card-hover active:scale-[0.98]"
              >
                <LogIn size={18} aria-hidden />
                登入
                <span
                  className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent group-hover:animate-[shimmer_0.85s_ease-out_forwards]"
                  aria-hidden
                />
              </motion.button>
            )}
          </section>
        </div>

        <div className="shrink-0 border-t bg-card/80 px-5 py-4">
          <div className="flex items-center justify-between rounded-lg bg-muted px-4 py-3">
            <span className="text-sm font-medium text-subtle">主題模式</span>
            <ThemeToggle />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
