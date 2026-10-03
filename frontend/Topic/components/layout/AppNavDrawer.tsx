import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { motion } from 'motion/react';
import { Bell, Bot, GitCompareArrows, House, LogIn, LogOut, Menu, ShieldCheck, ShoppingCart, Star, UserRound, type LucideIcon } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { ThemeToggle } from './ThemeToggle';
import { BrandMark } from '@/components/common/BrandMark';
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
  'lamp-row group flex min-h-12 w-full items-center gap-3 border-b px-5 py-3 text-left text-sm font-medium';

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-b border-border-strong px-5 pb-2 text-[13px] font-medium tracking-[0.04em] text-muted-foreground">{children}</p>
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
      : { initial: { opacity: 0, x: 8 }, animate: { opacity: 1, x: 0 }, transition: { duration: 0.25, delay: 0.04 + i * 0.03, ease: [0.2, 0, 0, 1] as const } };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="開啟主選單"
          className="flex min-h-11 items-center gap-2 rounded-md border border-input bg-card px-3 text-sm font-medium transition-colors duration-(--dur-flash) hover:border-border-strong hover:bg-accent"
        >
          <Menu size={20} className="shrink-0" aria-hidden />
          <span className="hidden sm:inline">選單</span>
        </button>
      </SheetTrigger>
      <SheetContent
        side="right"
        closeLabel="關閉選單"
        className="w-full gap-0 border-l border-border-strong bg-card p-0 pt-[var(--app-safe-area-top)] pb-[var(--app-safe-area-bottom)] sm:max-w-sm"
      >
        <SheetHeader className="px-5 pt-5 pb-4">
          <SheetTitle className="flex items-center gap-2 font-serif text-xl font-black tracking-[0.14em]">
            <BrandMark />
            股海明燈
          </SheetTitle>
          <SheetDescription className="sr-only">網站功能與帳號</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto border-t py-6">
          <section>
            <SectionLabel>功能</SectionLabel>
            <div className="flex flex-col">
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
                    className={cn(itemClass, active ? 'text-foreground' : 'text-subtle')}
                  >
                    <Icon size={18} className="shrink-0 text-muted-foreground" aria-hidden />
                    {item.label}
                  </motion.button>
                );
              })}
            </div>
          </section>

          <section>
            <SectionLabel>帳號</SectionLabel>
            {user ? (
              <div className="flex flex-col">
                <motion.div {...enter(0)} className="flex items-center gap-3 border-b px-5 py-4">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-md border border-border-strong font-serif text-lg font-black" aria-hidden>
                    {avatarLetter(user)}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{user.display_name?.trim() || user.email}</p>
                    <p className="truncate text-xs text-muted-foreground" title={user.email}>
                      {user.email}
                    </p>
                  </div>
                </motion.div>
                <motion.button type="button" {...enter(1)} onClick={() => go('/me')} className={cn(itemClass, 'text-subtle')}>
                  <UserRound size={18} className="shrink-0 text-muted-foreground" aria-hidden />
                  個人中心
                </motion.button>
                {isAdmin ? <motion.button type="button" {...enter(2)} onClick={() => go('/admin')} aria-current={isActive('/admin') ? 'page' : undefined} className={cn(itemClass, isActive('/admin') ? 'text-foreground' : 'text-subtle')}>
                  <ShieldCheck size={18} className="shrink-0 text-muted-foreground" aria-hidden />
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
                  className={cn(itemClass, 'text-subtle')}
                >
                  <LogOut size={18} className="shrink-0 text-muted-foreground" aria-hidden />
                  登出
                </motion.button>
              </div>
            ) : (
              <motion.button
                type="button"
                {...enter(0)}
                onClick={() => go(loginHref)}
                className="mx-5 mt-4 flex min-h-12 w-[calc(100%-2.5rem)] items-center justify-center gap-2 rounded-md border border-brand-deep bg-brand px-4 py-3 text-sm font-medium text-on-brand transition-colors duration-(--dur-flash) hover:bg-brand-deep"
              >
                <LogIn size={18} aria-hidden />
                登入
              </motion.button>
            )}
          </section>
        </div>

        <div className="shrink-0 border-t border-border-strong px-5 py-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-subtle">換班（晨班／夜班）</span>
            <ThemeToggle />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
