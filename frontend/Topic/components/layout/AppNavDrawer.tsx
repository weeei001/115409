import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { motion } from 'motion/react';
import { Bell, BookOpen, Bot, GitCompareArrows, House, LogIn, LogOut, Menu, ShieldCheck, Star, UserRound, type LucideIcon } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { ThemeToggle } from './ThemeToggle';
import { Button } from '@/components/ui/button';
import { BrandMark } from '@/components/common/BrandMark';
import { AUTH_CHANGE_EVENT, clearAuth, getStoredUser, getToken } from '@/lib/auth/storage';
import { adminMe } from '@/lib/api/admin';
import type { UserPublic } from '@/lib/types/api';
import { isNavPathActive, PRIMARY_NAV } from '@/lib/nav';
import { usePrefersReducedMotion } from '@/lib/hooks/useClientEnv';
import { useDrawerHistory } from '@/lib/navigation/drawerHistory';
import { cn } from '@/lib/cn';

const NAV_ICONS: Record<(typeof PRIMARY_NAV)[number]['path'], LucideIcon> = {
  '/': House,
  '/favorites': Star,
  '/notifications': Bell,
  '/ai': Bot,
  '/order': BookOpen,
  '/compare': GitCompareArrows,
};

function avatarLetter(user: UserPublic): string {
  const source = user.display_name?.trim() || user.email?.trim();
  return source ? source.slice(0, 1).toUpperCase() : '?';
}

/** 視窗取得焦點時，同一個登入多久才再向後端確認一次管理員身分 */
const ADMIN_RECHECK_MS = 5 * 60_000;

const itemClass =
  'lamp-row group flex min-h-12 w-full items-center gap-3 border-b px-5 py-3 text-left text-sm font-medium focus-lamp-inset';

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-b border-border-strong px-5 pb-2 text-[13px] font-medium tracking-[0.04em] text-muted-foreground">{children}</p>
  );
}

/** 主選單抽屜：Esc 關閉、focus trap、鎖背景捲動、關閉後焦點回到觸發鈕都由 Radix 處理；上一頁先關選單（useDrawerHistory） */
export function AppNavDrawer() {
  const router = useRouter();
  const reduce = usePrefersReducedMotion();
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<UserPublic | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // 管理員身分：掛載與登入狀態改變時確認；視窗取得焦點時，同一個登入最多每 5 分鐘再確認一次（權限可能被收回）。
  // 開關選單不重新確認；確認期間保留同一個登入上一次的結果，「管理後台」不會在選單打開時閃掉再出現。
  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    let checked: { token: string; at: number } | null = null;
    const sync = (event?: Event) => {
      setUser(getStoredUser());
      const token = getToken();
      if (!token) {
        controller?.abort();
        checked = null;
        setIsAdmin(false);
        return;
      }
      const sameLogin = checked?.token === token;
      // 換了帳號就不沿用上一個帳號的結果
      if (!sameLogin) setIsAdmin(false);
      if (event?.type === 'focus' && sameLogin && checked && Date.now() - checked.at < ADMIN_RECHECK_MS) return;
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      checked = { token, at: Date.now() };
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
  }, []);

  // 打開選單時從本機重讀使用者資料（不打 API），顯示名稱改過也會更新
  useEffect(() => {
    if (open) setUser(getStoredUser());
  }, [open]);

  const loginHref = useMemo(() => {
    if (router.pathname === '/login' || router.pathname === '/register') return '/login';
    return { pathname: '/login', query: { returnUrl: router.asPath } };
  }, [router.asPath, router.pathname]);

  const isActive = (path: string) => isNavPathActive(path, router.pathname);
  // 手機按上一頁（返回鍵）只關選單，不離開頁面（P2-054）
  const requestClose = useDrawerHistory(open, () => setOpen(false));
  const go = (href: Parameters<typeof router.push>[0]) => {
    // 先退掉選單推的那一筆紀錄再換頁：上一頁會回到原本的頁面，不會停在「選單開著」的同一頁
    requestClose(() => void router.push(href));
    setOpen(false);
  };

  const enter = (i: number) =>
    reduce
      ? {}
      : { initial: { opacity: 0, x: 8 }, animate: { opacity: 1, x: 0 }, transition: { duration: 0.25, delay: 0.04 + i * 0.03, ease: [0.2, 0, 0, 1] as const } };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" aria-label="開啟主選單" className="px-3">
          <Menu className="size-5" aria-hidden />
          <span className="hidden sm:inline">選單</span>
        </Button>
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
                <motion.button type="button" {...enter(1)} onClick={() => go('/me')} aria-current={isActive('/me') ? 'page' : undefined} className={cn(itemClass, isActive('/me') ? 'text-foreground' : 'text-subtle')}>
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
                  className={cn(itemClass, 'text-danger')}
                >
                  {/* 登出與個人中心的「登出」同一個語意色（danger），不用漲跌色 */}
                  <LogOut size={18} className="shrink-0" aria-hidden />
                  登出
                </motion.button>
              </div>
            ) : (
              <Button asChild size="lg" className="mx-5 mt-4 w-[calc(100%-2.5rem)]">
                <motion.button type="button" {...enter(0)} onClick={() => go(loginHref)}>
                  <LogIn className="size-[18px]" aria-hidden />
                  登入
                </motion.button>
              </Button>
            )}
          </section>
        </div>

        <div className="shrink-0 border-t border-border-strong px-5 py-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-subtle">亮色／暗色</span>
            <ThemeToggle />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
