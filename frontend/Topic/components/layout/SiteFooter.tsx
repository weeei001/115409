import Link from 'next/link';
import { useRouter } from 'next/router';
import { BrandMark } from '@/components/common/BrandMark';
import { FOOTER_NAV, isNavPathActive } from '@/lib/nav';
import { useLatestCloseDate } from '@/lib/hooks/useLatestCloseDate';
import { cn } from '@/lib/cn';

/** 頁尾＝海圖的圖名欄：品牌、資料說明、導覽、免責，用線分格 */
export function SiteFooter({ className }: { className?: string }) {
  const router = useRouter();
  const latestClose = useLatestCloseDate();
  return (
    <footer className={cn('mt-auto border-t border-border-strong bg-card', className)}>
      <div className="mx-auto grid max-w-[1320px] gap-px bg-border px-0 md:grid-cols-[minmax(0,5fr)_minmax(0,3fr)_minmax(0,4fr)]">
        <div className="bg-card px-4 py-6 sm:px-6 lg:px-10">
          <p className="flex items-center gap-2.5">
            <BrandMark className="size-7" />
            <span className="font-serif text-xl font-black tracking-[0.14em]">股海明燈</span>
          </p>
          {/* 英文名對齊中文名（標誌 size-7 加 gap-2.5） */}
          <p lang="en" className="mt-1 pl-[2.375rem] text-[11px] tracking-[0.25em] text-muted-foreground uppercase">Stock Lighthouse</p>
          <p className="mt-3 max-w-[34em] text-[13px] leading-relaxed text-muted-foreground">
            本網站為展示與學習用途，不構成投資建議。模擬投資使用虛擬資金，交易與決策紀錄存在你的帳號裡。
          </p>
        </div>
        <nav aria-label="頁尾導覽" className="bg-card px-4 py-4 sm:px-6 md:py-6">
          <ul className="grid grid-cols-2 gap-x-4 md:grid-cols-1">
            {FOOTER_NAV.map((item) => {
              // 目前頁和主導覽一樣標出來（P2-055）；連結填滿整格，手機的觸控寬度才夠（P2-056）
              const active = isNavPathActive(item.path, router.pathname);
              return (
                <li key={item.path}>
                  <Link
                    href={item.path}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex min-h-11 w-full items-center text-sm underline-offset-4 transition-colors duration-(--dur-flash) hover:text-foreground hover:underline',
                      active ? 'font-medium text-foreground underline decoration-border-strong' : 'text-subtle',
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <dl className="bg-card px-4 py-4 text-[13px] sm:px-6 md:py-6 lg:px-10">
          <div className="flex justify-between gap-4 border-b py-2">
            <dt className="text-muted-foreground">大盤資料</dt>
            <dd className="text-right font-mono tabular-nums">{latestClose ? `收盤 ${latestClose}` : '收盤日載入中'} · 非即時</dd>
          </div>
          <div className="flex justify-between gap-4 border-b py-2">
            <dt className="text-muted-foreground">大盤基準</dt>
            <dd className="text-right">加權指數（不含息）</dd>
          </div>
          <div className="flex justify-between gap-4 py-2">
            <dt className="text-muted-foreground">用途</dt>
            <dd className="text-right">學習與專題</dd>
          </div>
        </dl>
      </div>
      <p className="border-t px-4 py-3 text-center text-xs text-muted-foreground">
        &copy; {new Date().getFullYear()} 國立臺北商業大學 資訊管理系 115409 專題組
      </p>
    </footer>
  );
}
