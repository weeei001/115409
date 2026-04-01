import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  Sparkles,
  CalendarRange,
  BarChart3,
  ChartCandlestick,
  ChartColumn,
  Percent,
  History,
} from 'lucide-react';
import { clsx } from 'clsx';

const SECTIONS: ReadonlyArray<{ id: string; label: string; icon: LucideIcon }> = [
  { id: 'stock-overview', label: '概覽', icon: LayoutDashboard },
  { id: 'ai-trend', label: 'AI 摘要', icon: Sparkles },
  { id: 'date-range', label: '區間', icon: CalendarRange },
  { id: 'statistics', label: '統計', icon: BarChart3 },
  { id: 'candlestick', label: 'K 線', icon: ChartCandlestick },
  { id: 'volume', label: '量能', icon: ChartColumn },
  { id: 'price-change', label: '漲跌幅', icon: Percent },
  { id: 'history', label: '歷史行情', icon: History },
];

/** 點擊錨點後，瀏覽器捲動完成前若跑 scrollspy，會用舊位置覆寫高亮；此期間略過自動計算 */
const SCROLLSPY_SUPPRESS_MS = 550;

/** fallback：無法量到導覽列時 */
const SCROLLSPY_FALLBACK_OFFSET_PX = 140;

export function StockSectionNav() {
  const [activeId, setActiveId] = useState<string>(SECTIONS[0].id);
  const navRef = useRef<HTMLElement>(null);
  const navScrollRef = useRef<HTMLDivElement>(null);
  const linkRefs = useRef<Map<string, HTMLAnchorElement>>(new Map());
  const rafRef = useRef<number | null>(null);
  const suppressScrollSpyUntilRef = useRef<number>(0);

  const computeActiveFromScroll = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (Date.now() < suppressScrollSpyUntilRef.current) return;

    const navEl = navRef.current;
    const threshold =
      navEl != null ? navEl.getBoundingClientRect().bottom + 6 : SCROLLSPY_FALLBACK_OFFSET_PX;

    const doc = document.documentElement;
    const scrollBottom = window.scrollY + window.innerHeight;
    const scrollable = doc.scrollHeight > window.innerHeight + 80;
    const nearBottom = scrollable && scrollBottom >= doc.scrollHeight - 4;

    if (nearBottom) {
      for (let i = SECTIONS.length - 1; i >= 0; i--) {
        const el = document.getElementById(SECTIONS[i].id);
        if (el && el.getBoundingClientRect().height > 2) {
          setActiveId((prev) => (prev === SECTIONS[i].id ? prev : SECTIONS[i].id));
          return;
        }
      }
    }

    let active = SECTIONS[0].id;
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (!el) continue;
      const top = el.getBoundingClientRect().top;
      if (top <= threshold) {
        active = s.id;
      }
    }
    setActiveId((prev) => (prev === active ? prev : active));
  }, []);

  const scheduleCompute = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      computeActiveFromScroll();
    });
  }, [computeActiveFromScroll]);

  const scrollActiveIntoView = useCallback((id: string) => {
    const nav = navScrollRef.current;
    const link = linkRefs.current.get(id);
    if (!nav || !link) return;
    const navRect = nav.getBoundingClientRect();
    const linkRect = link.getBoundingClientRect();
    if (linkRect.left < navRect.left + 24 || linkRect.right > navRect.right - 24) {
      link.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }
  }, []);

  const armSuppressFromNavClick = useCallback(() => {
    suppressScrollSpyUntilRef.current = Date.now() + SCROLLSPY_SUPPRESS_MS;
  }, []);

  useEffect(() => {
    computeActiveFromScroll();
    const onScroll = () => scheduleCompute();
    const onResize = () => scheduleCompute();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });

    const onScrollEnd = () => {
      suppressScrollSpyUntilRef.current = 0;
      computeActiveFromScroll();
    };
    window.addEventListener('scrollend', onScrollEnd as EventListener, { passive: true });

    const onHash = () => {
      const hash = window.location.hash?.replace(/^#/, '');
      if (hash && SECTIONS.some((s) => s.id === hash)) {
        setActiveId(hash);
        armSuppressFromNavClick();
      }
      scheduleCompute();
    };
    window.addEventListener('hashchange', onHash);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scrollend', onScrollEnd as EventListener);
      window.removeEventListener('hashchange', onHash);
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
    };
  }, [computeActiveFromScroll, scheduleCompute, armSuppressFromNavClick]);

  useEffect(() => {
    scrollActiveIntoView(activeId);
  }, [activeId, scrollActiveIntoView]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash?.replace(/^#/, '');
    if (hash && SECTIONS.some((s) => s.id === hash)) {
      setActiveId(hash);
    }
  }, []);

  return (
    <nav
      ref={navRef}
      className="sticky top-[76px] z-40 -mx-4 sm:-mx-6 lg:-mx-8 mb-3 px-4 sm:px-6 lg:px-8"
      aria-label="個股區塊導覽"
    >
      <div
        className="rounded-2xl border border-gray-200/90 dark:border-gray-600/80 bg-gradient-to-b from-white via-white to-gray-50/95 dark:from-gray-800 dark:via-gray-800/98 dark:to-gray-900/95 shadow-[0_1px_0_0_rgba(0,0,0,0.04)] dark:shadow-[0_1px_0_0_rgba(255,255,255,0.06)] p-2 sm:p-2.5"
      >
        <div
          ref={navScrollRef}
          className="flex gap-1.5 sm:gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const isActive = activeId === s.id;
            return (
              <a
                key={s.id}
                ref={(el) => {
                  if (el) linkRefs.current.set(s.id, el);
                  else linkRefs.current.delete(s.id);
                }}
                href={`#${s.id}`}
                onClick={() => {
                  setActiveId(s.id);
                  armSuppressFromNavClick();
                }}
                className={clsx(
                  'group flex shrink-0 items-center gap-1.5 rounded-xl border px-2.5 py-2 sm:px-3.5 sm:py-2.5 text-xs sm:text-[13px] font-medium transition-all duration-200',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ffa95a]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900',
                  isActive
                    ? 'border-[#ffa95a]/55 bg-gradient-to-br from-[#ffa95a]/18 via-[#ffd45a]/12 to-transparent text-amber-950 shadow-sm dark:border-[#ffd45a]/45 dark:text-[#ffe7a8] dark:from-[#ffa95a]/25 dark:via-[#ffd45a]/12'
                    : 'border-transparent bg-gray-100/80 text-gray-600 hover:border-[#ffa95a]/35 hover:bg-amber-50/90 hover:text-amber-900 dark:bg-gray-700/50 dark:text-gray-300 dark:hover:border-[#ffd45a]/30 dark:hover:bg-gray-600/80 dark:hover:text-[#ffd45a]',
                )}
                aria-current={isActive ? 'location' : undefined}
              >
                <Icon
                  className={clsx(
                    'h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4 transition-colors',
                    isActive
                      ? 'text-[#c76b1a] dark:text-[#ffd45a]'
                      : 'text-gray-400 group-hover:text-[#c76b1a] dark:text-gray-500 dark:group-hover:text-[#ffd45a]',
                  )}
                  aria-hidden
                />
                <span className="whitespace-nowrap">{s.label}</span>
              </a>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
