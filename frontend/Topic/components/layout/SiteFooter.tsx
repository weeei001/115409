import React, { useEffect, useId, useRef } from 'react';
import Link from 'next/link';
import { FOOTER_NAV } from '@/lib/nav';
import { usePrefersReducedMotion } from '@/lib/hooks/useClientEnv';
import { cn } from '@/lib/cn';

const BARS = [40, 55, 35, 65, 50, 72, 48, 80, 60, 90, 70, 95, 60, 90, 70, 95];

function SparkBars({ gradientId, animate }: { gradientId: string; animate: boolean }) {
  return (
    <svg viewBox={`0 0 ${BARS.length * 10} 100`} className="h-6 w-20 opacity-30 dark:opacity-20" aria-hidden preserveAspectRatio="none">
      {BARS.map((h, i) => (
        <rect key={i} x={i * 10 + 1} y={100 - h} width={7} height={h} rx={2} fill={`url(#${gradientId})`} style={{ transformOrigin: `${i * 10 + 4.5}px 100px` }}>
          {animate ? (
            <animateTransform
              attributeName="transform"
              type="scale"
              values={`1 1;1 ${Math.min(100, h + 15) / h};1 1`}
              dur={`${2 + i * 0.15}s`}
              repeatCount="indefinite"
            />
          ) : null}
        </rect>
      ))}
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--brand)" />
          <stop offset="100%" stopColor="var(--brand-light)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function SiteFooter({ className }: { className?: string }) {
  const lineRef = useRef<HTMLDivElement>(null);
  const gradientId = useId().replace(/:/g, '');
  const reduce = usePrefersReducedMotion();

  useEffect(() => {
    const el = lineRef.current;
    if (!el) return;
    if (reduce) {
      el.style.transform = 'scaleX(1)';
      return;
    }
    el.style.transform = 'scaleX(0)';
    el.style.transformOrigin = 'left';
    el.style.transition = 'transform 0.8s cubic-bezier(0.16,1,0.3,1)';
    requestAnimationFrame(() => requestAnimationFrame(() => (el.style.transform = 'scaleX(1)')));
  }, [reduce]);

  return (
    <footer className={cn('relative mt-auto overflow-hidden bg-muted', className)}>
      <div ref={lineRef} className="h-[2px] w-full bg-brand-gradient" aria-hidden />
      <div className="relative mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xl font-bold tracking-[0.15em] text-brand-gradient sm:text-2xl">股海明燈</p>
            <p className="mt-1 text-[11px] tracking-[0.25em] text-muted-foreground uppercase">Stock Lighthouse</p>
          </div>
          <SparkBars gradientId={gradientId} animate={!reduce} />
        </div>
        <div className="mb-4 h-px w-full bg-gradient-to-r from-transparent via-brand/20 to-transparent" aria-hidden />
        <nav aria-label="頁尾導覽" className="mb-4 flex flex-wrap items-center justify-center gap-y-1">
          {FOOTER_NAV.map((item, i) => (
            <React.Fragment key={item.path}>
              {i > 0 ? (
                <span className="mx-3 text-xs text-border select-none sm:mx-5" aria-hidden>
                  ·
                </span>
              ) : null}
              <Link href={item.path} className="group relative text-[13px] text-subtle transition-colors hover:text-brand-text sm:text-sm">
                {item.label}
                <span className="absolute -bottom-0.5 left-0 h-px w-0 bg-brand transition-[width] duration-300 group-hover:w-full" aria-hidden />
              </Link>
            </React.Fragment>
          ))}
        </nav>
        <p className="mx-auto mb-3 max-w-xl text-center text-[11px] leading-relaxed text-muted-foreground sm:text-xs">
          本網站為展示與學習用途，不構成投資建議。模擬投資使用虛擬資金，交易與決策紀錄儲存於登入帳戶；舊版匿名紀錄另行保留。
        </p>
        <div className="mb-2 h-px w-full bg-gradient-to-r from-transparent via-border to-transparent" aria-hidden />
        <p className="text-center text-[11px] tracking-wide text-muted-foreground sm:text-xs">
          &copy; {new Date().getFullYear()} <span className="text-subtle">國立臺北商業大學 資訊管理系 115409 專題組</span>
        </p>
      </div>
    </footer>
  );
}
