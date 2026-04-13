import React, { useEffect, useId, useRef } from 'react';
import Link from 'next/link';

const NAV_ITEMS = [
  { href: '/', label: '首頁' },
  { href: '/compare', label: '多股比較' },
  { href: '/advisor', label: '投資顧問' },
  { href: '/ai', label: 'AI 投資顧問' },
  { href: '/order', label: '模擬下單' },
] as const;

function SparkBars({ gradientId }: { gradientId: string }) {
  const bars = [40, 55, 35, 65, 50, 72, 48, 80, 60, 90, 70, 95, 60, 90, 70, 95];
  return (
    <svg
      viewBox={`0 0 ${bars.length * 10} 100`}
      className="w-20 h-6 opacity-40 dark:opacity-30"
      aria-hidden
      preserveAspectRatio="none"
    >
      {bars.map((h, i) => (
        <rect
          key={i}
          x={i * 10 + 1}
          y={100 - h}
          width={7}
          height={h}
          rx={2}
          fill={`url(#${gradientId})`}
        />
      ))}
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffa95a" />
          <stop offset="100%" stopColor="#ffd45a" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function SiteFooter() {
  const year = new Date().getFullYear();
  const lineRef = useRef<HTMLDivElement>(null);
  const barGradId = useId().replace(/:/g, '');

  useEffect(() => {
    const el = lineRef.current;
    if (!el) return;
    el.style.transform = 'scaleX(0)';
    el.style.transformOrigin = 'left';
    el.style.transition = 'transform 0.8s cubic-bezier(0.16,1,0.3,1)';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.transform = 'scaleX(1)';
      });
    });
  }, []);

  return (
    <footer
      className="mt-auto relative overflow-hidden bg-gradient-to-b from-gray-50 to-gray-100/95 dark:from-[#0f1117] dark:to-[#181c27]"
      role="contentinfo"
    >
      <div
        ref={lineRef}
        className="h-[2px] w-full"
        style={{
          background: '#ffa95a',
        }}
        aria-hidden
      />

      <div
        className="absolute inset-0 pointer-events-none dark:hidden"
        style={{
          backgroundImage:
            'linear-gradient(rgba(180,140,60,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(180,140,60,0.05) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
        aria-hidden
      />
      <div
        className="absolute inset-0 pointer-events-none hidden dark:block"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,169,90,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,169,90,0.03) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
        aria-hidden
      />

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-5 pb-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p
              className="text-xl sm:text-2xl font-bold tracking-widest text-amber-800 dark:text-[#ffd45a]"
              style={{ fontFamily: "'Noto Serif TC', serif", letterSpacing: '0.15em' }}
            >
              股海明燈
            </p>
            <p className="mt-1 text-[11px] tracking-[0.25em] uppercase text-gray-500 dark:text-gray-500">
              Stock Market Beacon
            </p>
          </div>
          <SparkBars gradientId={barGradId} />
        </div>

        <div
          className="mb-4 h-px w-full bg-gradient-to-r from-transparent via-amber-200/60 to-transparent dark:via-[rgba(255,212,90,0.25)]"
          aria-hidden
        />

        <nav
          className="flex flex-wrap items-center justify-center gap-x-0 gap-y-1 mb-4"
          aria-label="頁尾導覽"
        >
          {NAV_ITEMS.map((item, i) => (
            <React.Fragment key={item.href}>
              {i > 0 && (
                <span
                  className="mx-3 sm:mx-5 text-gray-300 dark:text-gray-700 select-none text-xs"
                  aria-hidden
                >
                  ·
                </span>
              )}
              <Link
                href={item.href}
                className="group relative text-[13px] sm:text-sm text-gray-600 dark:text-gray-400 transition-colors duration-200 hover:text-[#ffa95a] dark:hover:text-[#ffd45a]"
              >
                {item.label}
                <span
                  className="absolute -bottom-0.5 left-0 h-px w-0 group-hover:w-full transition-all duration-300 bg-[#ffa95a] dark:bg-[#ffd45a]"
                  aria-hidden
                />
              </Link>
            </React.Fragment>
          ))}
        </nav>

        <p className="text-center text-[11px] sm:text-xs leading-relaxed text-gray-600 dark:text-gray-600 max-w-xl mx-auto mb-3">
          本網站為展示與學習用途，不構成投資建議；模擬下單相關資料僅存於您的瀏覽器，不蒐集可識別個人資料。
        </p>

        <div
          className="mb-2 h-px w-full bg-gradient-to-r from-transparent via-gray-300/80 to-transparent dark:via-[rgba(255,212,90,0.12)]"
          aria-hidden
        />

        <p className="text-center text-[11px] sm:text-xs text-gray-600 dark:text-gray-700 tracking-wide">
          © {year}{' '}
          <span className="text-gray-500 dark:text-gray-500">
            國立臺北商業大學 資訊管理系 115409 專題組
          </span>
        </p>
      </div>
    </footer>
  );
}
