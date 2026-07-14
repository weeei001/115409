import React, { useEffect, useId, useRef } from 'react';
import Link from 'next/link';
import { FOOTER_NAV } from '../lib/nav';
import { usePrefersReducedMotionClient } from '../lib/usePrefersReducedMotionClient';

function SparkBars({ gradientId, animate }: { gradientId: string; animate: boolean }) {
  const bars = [40, 55, 35, 65, 50, 72, 48, 80, 60, 90, 70, 95, 60, 90, 70, 95];
  const maxH = 100;
  return (
    <svg
      viewBox={`0 0 ${bars.length * 10} ${maxH}`}
      className="w-20 h-6 opacity-30 dark:opacity-20"
      aria-hidden
      preserveAspectRatio="none"
    >
      {bars.map((h, i) => {
        const scaleUp = Math.min(maxH, h + 15) / h;
        return (
          <rect
            key={i}
            x={i * 10 + 1}
            y={maxH - h}
            width={7}
            height={h}
            rx={2}
            fill={`url(#${gradientId})`}
            style={{ transformOrigin: `${i * 10 + 4.5}px ${maxH}px` }}
          >
            {animate && (
              <animateTransform
                attributeName="transform"
                type="scale"
                values={`1 1;1 ${scaleUp};1 1`}
                dur={`${2 + i * 0.15}s`}
                repeatCount="indefinite"
              />
            )}
          </rect>
        );
      })}
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffa95a" />
          <stop offset="100%" stopColor="#ffd6b8" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function SiteFooter() {
  const year = new Date().getFullYear();
  const lineRef = useRef<HTMLDivElement>(null);
  const barGradId = useId().replace(/:/g, '');
  const reduceMotion = usePrefersReducedMotionClient();

  useEffect(() => {
    const el = lineRef.current;
    if (!el) return;
    if (reduceMotion) {
      el.style.transform = 'scaleX(1)';
      return;
    }
    el.style.transform = 'scaleX(0)';
    el.style.transformOrigin = 'left';
    el.style.transition = 'transform 0.8s cubic-bezier(0.16,1,0.3,1)';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.transform = 'scaleX(1)';
      });
    });
  }, [reduceMotion]);

  return (
    <footer
      className="mt-auto relative overflow-hidden bg-[var(--color-bg-elevated)]"
      role="contentinfo"
    >
      <div
        ref={lineRef}
        className="h-[2px] w-full"
        style={{ background: 'var(--brand-gradient)' }}
        aria-hidden
      />

      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgba(212,165,116,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(212,165,116,0.03) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
        aria-hidden
      />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-5 pb-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-xl sm:text-2xl font-bold tracking-widest gradient-text"
               style={{ fontFamily: "'Noto Sans TC', sans-serif", letterSpacing: '0.15em' }}>
              股海明燈
            </p>
            <p className="mt-1 text-[11px] tracking-[0.25em] uppercase text-[var(--color-text-muted)]">
              Stock Market Beacon
            </p>
          </div>
          <SparkBars gradientId={barGradId} animate={!reduceMotion} />
        </div>

        <div className="mb-4 h-px w-full bg-gradient-to-r from-transparent via-brand/20 to-transparent" aria-hidden />

        <nav className="flex flex-wrap items-center justify-center gap-x-0 gap-y-1 mb-4" aria-label="頁尾導覽">
          {FOOTER_NAV.map((item, i) => (
            <React.Fragment key={item.path}>
              {i > 0 && (
                <span className="mx-3 sm:mx-5 text-[var(--color-border)] select-none text-xs" aria-hidden>·</span>
              )}
              <Link
                href={item.path}
                className="group relative text-[13px] sm:text-sm text-[var(--color-text-secondary)] transition-colors duration-200 hover:text-brand"
              >
                {item.label}
                <span className="absolute -bottom-0.5 left-0 h-px w-0 group-hover:w-full transition-[width] duration-300 bg-brand" aria-hidden />
              </Link>
            </React.Fragment>
          ))}
        </nav>

        <p className="text-center text-[11px] sm:text-xs leading-relaxed text-[var(--color-text-muted)] max-w-xl mx-auto mb-3">
          本網站為展示與學習用途，不構成投資建議；模擬下單相關資料僅存於您的瀏覽器，不蒐集可識別個人資料。
        </p>

        <div className="mb-2 h-px w-full bg-gradient-to-r from-transparent via-[var(--color-border)] to-transparent" aria-hidden />

        <p className="text-center text-[11px] sm:text-xs text-[var(--color-text-muted)] tracking-wide">
          &copy; {year}{' '}
          <span className="text-[var(--color-text-secondary)]">
            國立臺北商業大學 資訊管理系 115409 專題組
          </span>
        </p>
      </div>
    </footer>
  );
}
