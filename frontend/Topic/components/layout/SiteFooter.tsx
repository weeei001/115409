import Link from 'next/link';
import { useRouter } from 'next/router';
import { AlertTriangle } from 'lucide-react';
import { BrandMark } from '@/components/common/BrandMark';
import { PRIMARY_NAV, isNavPathActive } from '@/lib/nav';
import { useLatestCloseDate } from '@/lib/hooks/useLatestCloseDate';
import { cn } from '@/lib/cn';
import { DISCLAIMER_PATH, INVESTMENT_RISK_NOTICE } from '@/lib/disclaimers';

const CELL = 'bg-card px-4 py-6 sm:px-6 lg:px-10';
const CONTAINER = 'mx-auto max-w-[1320px] px-4 sm:px-6 lg:px-10';
/** 欄標題與品牌列同高（h-7），三欄第一行才對齊 */
const CAPTION = 'flex h-7 items-center text-[13px] font-medium tracking-[0.04em] text-muted-foreground';

/** 頁尾＝海圖的圖名欄：品牌、導覽、資料說明三格用線分隔，底下一整列風險提示 */
export function SiteFooter({ className }: { className?: string }) {
  const router = useRouter();
  const latestClose = useLatestCloseDate();
  return (
    <footer className={cn('mt-auto border-t border-border-strong bg-card', className)}>
      {/* 手機單欄；md 品牌一整列、導覽與資料並排；lg 三欄等寬，xl 起 5/4/3（1024 時 3 份的資料欄會把日期折行） */}
      <div className="mx-auto grid max-w-[1320px] gap-px bg-border md:grid-cols-2 lg:grid-cols-12">
        <div className={cn(CELL, 'md:col-span-2 lg:col-span-4 xl:col-span-5')}>
          <p className="flex h-7 items-center gap-2.5">
            <BrandMark className="size-7" />
            <span className="font-serif text-xl font-black tracking-[0.14em]">股海明燈</span>
          </p>
          {/* 英文名對齊中文名（標誌 size-7 加 gap-2.5） */}
          <p lang="en" className="mt-1 pl-[2.375rem] text-xs tracking-[0.25em] text-muted-foreground uppercase">Stock Lighthouse</p>
          {/* 第二句包成 inline-block：換行落在句號，不在詞中間 */}
          <p className="mt-3 max-w-[34em] text-[13px] leading-relaxed text-muted-foreground">
            本網站為展示與學習用途。<span className="inline-block">模擬投資使用虛擬資金，交易與決策紀錄存在你的帳號裡。</span>
          </p>
        </div>
        <nav aria-labelledby="footer-nav-title" className={cn(CELL, 'lg:col-span-4')}>
          <h2 id="footer-nav-title" className={CAPTION}>網站導覽</h2>
          {/* 兩欄、由上而下排：欄高和另外兩格相近；連結填滿整格，手機的觸控寬度才夠（P2-056） */}
          <ul className="mt-1 grid grid-flow-col grid-cols-2 grid-rows-4 gap-x-4">
            {PRIMARY_NAV.map((item) => {
              // 目前頁和主導覽一樣標出來（P2-055）
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
        <section aria-labelledby="footer-data-title" className={cn(CELL, 'lg:col-span-4 xl:col-span-3')}>
          <h2 id="footer-data-title" className={CAPTION}>資料說明</h2>
          {/* 標籤在上、值在下：寬欄裡不會左右拉開，窄欄裡也不會折行 */}
          <dl className="mt-1 text-sm">
            <div className="border-b py-2.5">
              <dt className="text-[13px] text-muted-foreground">最近交易日</dt>
              <dd className="mt-0.5">
                {latestClose ? <><span className="font-mono tabular-nums">{latestClose}</span> 收盤</> : '收盤日載入中'} · 非即時
              </dd>
            </div>
            <div className="py-2.5">
              <dt className="text-[13px] text-muted-foreground">大盤基準</dt>
              <dd className="mt-0.5">加權指數（不含息）</dd>
            </div>
          </dl>
        </section>
      </div>
      {/* 底帶：風險提示獨立一整列、用一般文字色（評審要求放在顯著位置；免責聲明的入口只放這裡），版權接在下方、不再另隔一條線。
          手機版右下角有小燈，底部讓出它的高度（--assistant-dock-offset） */}
      <div className="border-t">
        <div className={cn(CONTAINER, 'pt-4 pb-[calc(1rem+var(--assistant-dock-offset,0px))] sm:pb-4')}>
          <p className="flex items-start gap-2 border-l-2 border-warning-border pl-3 text-[13px] leading-relaxed">
            <AlertTriangle size={14} className="mt-[0.3em] shrink-0 text-warning-icon" aria-hidden />
            <span>
              <strong className="mr-1 font-semibold">投資風險提示</strong>
              {INVESTMENT_RISK_NOTICE}
              <Link href={DISCLAIMER_PATH} className="ml-1 whitespace-nowrap underline underline-offset-4">閱讀投資免責聲明</Link>
            </span>
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} 國立臺北商業大學 資訊管理系 115409 專題組
          </p>
        </div>
      </div>
    </footer>
  );
}
