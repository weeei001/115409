import React from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { toneText } from '@/lib/utils/tone';
import { usePrefersReducedMotion } from '@/lib/hooks/useClientEnv';
import { CLOSE_DATA_NOTE, boardFigures, type HeroBoard } from './boardFormat';

/**
 * 首屏：燈塔海報（夜班／晨班各一張，主題 class 在首次繪製前就寫在 <html>，用 dark: 選圖才不會閃）
 * 加真正的 DOM 文字，往下直接是觀測台（#terminalId）。
 */

interface Props {
  /** 觀測台的元素 id；「直接看行情」捲到這裡並把焦點移過去 */
  terminalId: string;
  /** 大盤（TAIEX）最近一筆已儲存收盤；載入前或失敗時是 null */
  board: HeroBoard | null;
}

/** 跟頁首內容對齊的左緣（頁面容器 max-w-[1320px] lg:px-10） */
const GUTTER_L = 'lg:ml-[max(2.5rem,calc((100%-1320px)/2+2.5rem))]';
/** 手機：文案欄用滿整個欄寬（左右各 16px），底部閃開手勢區與首次造訪的風險提示條 */
const MOBILE_BOTTOM = 'self-end mx-4 mb-[calc(1rem+var(--app-bottom-inset))]';
const BODY = 'mt-3 max-w-[34em] text-[15px] leading-[1.75] text-foreground lg:text-[17px]';

const ease = (t: number) => t * t * (3 - 2 * t);

/**
 * 柔邊的遮罩：兩端用 smoothstep 取樣的漸層（不是直線），看不到從襯底轉成透明的那一條邊。
 * a0–a1 由透明淡入、b0–b1 淡出（百分比）。
 */
function softRamp(dir: string, a0: number, a1: number, b0: number, b1: number): string {
  const stops: string[] = [];
  const steps = 6;
  for (let i = 0; i <= steps; i++) stops.push(`rgba(0,0,0,${ease(i / steps).toFixed(3)}) ${(a0 + ((a1 - a0) * i) / steps).toFixed(1)}%`);
  for (let i = 0; i <= steps; i++) stops.push(`rgba(0,0,0,${(1 - ease(i / steps)).toFixed(3)}) ${(b0 + ((b1 - b0) * i) / steps).toFixed(1)}%`);
  return `linear-gradient(${dir}, ${stops.join(', ')})`;
}

const scrimMask = (mask: string, intersect: boolean): React.CSSProperties => ({
  background: 'var(--scrim)',
  maskImage: mask,
  WebkitMaskImage: mask,
  ...(intersect ? { maskComposite: 'intersect', WebkitMaskComposite: 'source-in' } : {}),
});

/**
 * 標題底下的襯底（夜班）：用 --scrim 做的一片柔邊，畫面在字後面暗下來。
 * 寬螢幕是水平、垂直兩道柔邊相乘；手機用滿寬，只有上緣淡出。字的範圍都落在完全不透明的那一段裡。
 */
const SCRIM_WIDE = scrimMask(`${softRamp('to right', 0, 0, 78, 100)}, ${softRamp('to bottom', 0, 27, 88, 100)}`, true);
const SCRIM_NARROW = scrimMask(softRamp('to bottom', 0, 20, 100, 100), false);

/** 橢圓遮罩：中心到 inner（比例）完全不透明，之後用 smoothstep 取樣的漸層淡到 0 */
function ellipseMask(inner: number): string {
  const stops: string[] = [`#000 ${(inner * 100).toFixed(1)}%`];
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    stops.push(`rgba(0,0,0,${(1 - ease(t)).toFixed(3)}) ${((inner + (1 - inner) * t) * 100).toFixed(1)}%`);
  }
  return `radial-gradient(closest-side ellipse at 50% 50%, ${stops.join(', ')})`;
}
const ELLIPSE = ellipseMask(0.6);
/**
 * 晨班（淺色）的襯底：不是白霧，是從海報取樣的一點冷色天光（--scrim 當底色混進去），
 * 只罩在文案那一塊：橢圓的遮罩、中間完整、外圈淡掉，看不到邊；海面明暗起伏大，不透明度給到 0.6。
 */
const DAWN_SCRIM: React.CSSProperties = {
  background: 'color-mix(in oklab, var(--scrim) 45%, rgb(208 218 233))',
  maskImage: ELLIPSE,
  WebkitMaskImage: ELLIPSE,
};

/** 直式的窄螢幕用 720×1440 的直幅海報 */
const PORTRAIT_MEDIA = '(max-width: 1023px) and (orientation: portrait)';

/** 同步解碼：圖已經載好，畫面要畫到它時就一定畫出來，不會先露出一塊佔位色 */
function PosterImage({ theme }: { theme: 'night' | 'dawn' }) {
  return (
    <>
      <source media={PORTRAIT_MEDIA} srcSet={`/beacon/poster-${theme}-1-m.webp`} width={720} height={1440} />
      <img
        src={`/beacon/poster-${theme}-1.webp`}
        width={1600}
        height={900}
        alt=""
        decoding="sync"
        loading="eager"
        fetchPriority="high"
        className="absolute inset-0 size-full object-cover"
      />
    </>
  );
}

export function HomeHero({ terminalId, board }: Props) {
  const reduce = usePrefersReducedMotion();
  const goToTerminal = () => {
    const el = document.getElementById(terminalId);
    if (!el) return;
    el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
  };

  // 首屏就看得到加權指數與收盤日（P2-079、04-H1）；漲跌用紅漲綠跌
  const boardNow = boardFigures(board);
  const characteristic = boardNow ? (
    // 每一段不在中間斷行（375 寬不會把日期拆成兩行）
    <>
      <span className="whitespace-nowrap">加權指數 <span className="font-mono tabular-nums">{boardNow.close}</span></span>
      {boardNow.change ? <span className={cn('ml-1.5 font-mono whitespace-nowrap tabular-nums', toneText(boardNow.tone))}>{boardNow.change}</span> : null}
      {' · '}<span className="whitespace-nowrap">收盤 {boardNow.date}</span>{' · '}<span className="whitespace-nowrap">非即時</span>
    </>
  ) : CLOSE_DATA_NOTE;

  return (
    <section aria-label="股海明燈" className="relative z-10 isolate grid h-[calc(100svh-var(--app-header-height))] grid-cols-1 grid-rows-1 overflow-clip bg-background">
      <div aria-hidden className="relative z-0 col-start-1 row-start-1 self-stretch overflow-hidden bg-secondary">
        <picture className="hidden dark:inline">
          <PosterImage theme="night" />
        </picture>
        <picture className="inline dark:hidden">
          <PosterImage theme="dawn" />
        </picture>
      </div>

      {/* 標題直接排在海報的留白上，底下只有一片柔邊的襯底 */}
      <div
        data-hero
        className={cn(
          'relative z-20 col-start-1 row-start-1 lg:w-fit lg:max-w-[min(46rem,calc(100%-5rem))]',
          MOBILE_BOTTOM,
          // 風險提示條在桌機是一列，首屏按鈕要在它上方留 1rem
          'lg:justify-self-start lg:mr-0 lg:mb-[max(clamp(1.5rem,6svh,4rem),calc(1rem+var(--risk-notice-height,0px)))]',
          GUTTER_L,
        )}
      >
        <div aria-hidden className="pointer-events-none absolute -inset-x-4 -top-[42%] -bottom-16 -z-10 hidden dark:max-lg:block" style={SCRIM_NARROW} />
        <div aria-hidden className="pointer-events-none absolute -top-[45%] -right-[45%] -bottom-[20%] -left-[60%] -z-10 hidden dark:lg:block" style={SCRIM_WIDE} />
        <div
          aria-hidden
          className="pointer-events-none absolute -z-10 inset-x-[-55%] inset-y-[-62%] opacity-60 dark:hidden max-lg:inset-x-[-42%] max-lg:inset-y-[-58%]"
          style={DAWN_SCRIM}
        />
        <p className="characteristic text-foreground!">{characteristic}</p>
        <h1 className="mt-2 font-serif text-[clamp(32px,10.2vw,46px)] leading-[1.14] font-black tracking-[0.03em] text-foreground [word-break:keep-all] lg:mt-3 lg:text-[clamp(44px,min(6.2vw,9svh),86px)] lg:leading-[1.12]">
          股海明燈
        </h1>
        <p lang="en" className="mt-1 text-[11px] tracking-[0.25em] text-foreground uppercase lg:text-xs">
          Stock Lighthouse
        </p>
        <p className={cn(BODY, 'max-lg:mt-2')}>收盤後的台股，一次看清楚。</p>
        <div className="mt-4 flex flex-wrap gap-3 lg:mt-5">
          <Button type="button" variant="outline" onClick={goToTerminal}>
            直接看行情
            <ArrowRight aria-hidden />
          </Button>
        </div>
      </div>
    </section>
  );
}
