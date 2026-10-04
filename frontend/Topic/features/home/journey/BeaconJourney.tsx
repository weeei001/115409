import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Router from 'next/router';
import { useMotionValue, useMotionValueEvent } from 'motion/react';
import { ArrowDown, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStockInfos } from '@/lib/hooks/useStockInfos';
import { cn } from '@/lib/cn';
import { toneText } from '@/lib/utils/tone';
import { useCanHoverTilt, useHtmlDarkClass, useIsMobile } from '@/lib/hooks/useClientEnv';
import type { BeaconJourneyProps } from './types';
import { CLOSE_DATA_NOTE, boardFigures, countsText, monitorFigures } from './boardFormat';
import {
  CAPTION_HIDE_BELOW,
  CHAPTERS,
  RAIL,
  WATCH_ROOM_PROGRESS,
  captionOpacity,
  chapterIndex,
  handoffCaption,
  handoffRoom,
  handoffValue,
  measureTerminalColumns,
  railFade,
  journeyProgress,
  scrollYForProgress,
  type MeasuredTerminal,
} from './journeyMath';
import { clearHandoff } from './handoffVar';
import { decideJourneyMode, probeWebGL2, readJourneyEnv, type JourneyMode, type PosterReason } from './journeyMode';
import type { SparkLine, WatchItem } from './scene/screens';
import { DAWN_CAPTION_TINT } from './scene/theme';

/**
 * 首頁旅程：從海上的燈塔一路捲進觀測室，最後交給下方的觀測台（#terminalId）。
 *
 * 這個檔案是首屏就載入的外殼，不 import three：
 * - 首屏是海報 <img> 加真正的 DOM 文字，LCP 不等 WebGL。
 * - 3D 場景（BeaconScene）在閒置後才用 next/dynamic 載入，第一格畫好再花 1250ms 淡入。
 * - 減少動態、沒有 WebGL、低功耗裝置：不載場景，改成「海圖圖版」：首屏之後是三張各自成格的圖版
 *   （有線的章節標題列、固定比例加細框的圖、圖旁或圖下的正文）。最後一張依序是：章名與標題 → 裁在三台螢幕上的圖
 *   → 每欄一行真實資料的「看板」（觀測台同一組三欄）→「進入觀測台」，往下就是觀測台。
 *
 * 3D 版面的舞台黏在頁首下方，高度是「視窗 − 頁首」，所以畫面與文案永遠落在看得到的範圍。
 * 每一段文案都放在該段構圖的留白處，底下是一片沒有邊緣的柔和襯底（不是方框）：
 * 海面在左下、燈塔在左上的天空、窗在窗的右邊、桌前在牆面（夜班在左邊牆裙上方；晨班鏡頭往右看、看板與螢幕偏左，文案在右邊曬到太陽的牆上）、
 * 交接在畫面最上面一列（跟觀測台的標題列同一個位置，下面就是三塊螢幕排成的三欄）。
 * 夜班的襯底是 --scrim 從畫面邊緣淡進來；晨班是只罩住文案的橢圓、取樣自畫面的冷色天光，不透明度上限約 0.55。
 * 桌機的進度列四個站名都寫出來，底下是右上角的角落暈影（不是底板）。
 * 交接終點的三欄對齊頁面上量到的觀測台（useTerminalShape），量不到時用觀測台網格的固定尺寸。
 * 捲動進度是手動 set 的 MotionValue（不用 useTransform 綁 style：motion 會升級成 ViewTimeline 而算錯）。
 */

const BeaconScene = dynamic(() => import('./BeaconScene').then((m) => m.BeaconScene), { ssr: false, loading: () => null });

type Mode = 'pending' | JourneyMode;

/** 3D 版面：第幾段文案底下墊第幾張海報（場景還沒接手、或 context 掉了才看得到）。窗用窗那張，桌前與交接都用螢幕那張 */
const POSTER_OF_CHAPTER = [0, 1, 2, 3, 3] as const;
/** 海報版面：首屏與三張圖版各算第幾段（決定 rail 亮哪一站：海面、燈塔、觀測室、觀測台） */
const CHAPTER_OF_PLATE = [0, 1, 2, 4] as const;
const POSTER_COUNT = 4;

/** 跟頁首內容對齊的左緣、右緣（頁面容器 max-w-[1320px] lg:px-10） */
const GUTTER_L = 'lg:ml-[max(2.5rem,calc((100%-1320px)/2+2.5rem))]';
const GUTTER_R = 'lg:mr-[max(2.5rem,calc((100%-1320px)/2+2.5rem))]';
/** 手機：文案欄用滿整個欄寬（左右各 16px），底部閃開手勢區 */
const MOBILE_BOTTOM = 'self-end mx-4 mb-[calc(1rem+var(--app-safe-area-bottom))]';

/** 第 2–5 段文案共用：疊在場景上、捲到之前不顯示；海報版面整個不輸出（圖版裡有自己的一份） */
const CAPTION = 'relative z-20 col-start-1 row-start-1 invisible opacity-0 in-data-[mode=poster]:hidden motion-reduce:hidden';

/**
 * 3D 版面每段文案在畫面上的位置（lg 以上），依各段鏡頭構圖的留白決定：
 * 燈塔在左上的天空（塔身在右側）；窗在窗的右邊（窗在左側三分之一）；
 * 桌前：夜班在左邊牆裙上方的牆面（看板與螢幕偏右）；晨班鏡頭往左偏，文案在右邊曬到太陽的牆面上（那裡本來就亮，襯底只要一點點）；
 * 交接：寬螢幕是最上面一列（看板上方的牆，跟觀測台的標題列同高）；手機在中間螢幕下方的桌前與地板（上面是海圖，不疊在海圖上）。
 * 交接開始（0.92）後跟著 h 淡出，終點只剩三塊排好的畫面。
 */
const PLACE = {
  tower: cn(MOBILE_BOTTOM, 'lg:self-start lg:justify-self-start lg:mr-0 lg:mb-0 lg:mt-[clamp(2.5rem,11svh,6.5rem)] lg:w-[min(29rem,38%)]', GUTTER_L),
  window: cn(MOBILE_BOTTOM, 'lg:self-center lg:justify-self-end lg:ml-0 lg:mb-0 lg:mt-[6svh] lg:w-[min(27rem,31%)]', GUTTER_R),
  deskNight: cn(MOBILE_BOTTOM, 'lg:self-center lg:justify-self-start lg:mr-0 lg:mb-0 lg:mt-[4svh] lg:w-[min(24rem,27%)]', GUTTER_L),
  // 晨班手機：地板壓暗了，文案改放在吊燈與看板之間那一段曬亮的牆面（鏡頭把看板往下放，留出這一段）
  deskDawn: cn('self-start mx-4 mt-[calc(45px+9svh)]', 'lg:self-center lg:justify-self-end lg:ml-0 lg:mt-[4svh] lg:w-[min(24rem,27%)]', GUTTER_R),
  handoff: cn(MOBILE_BOTTOM, 'lg:self-start lg:justify-self-start lg:mb-0 lg:mt-16 lg:mr-0', GUTTER_L),
} as const;

/** captionRefs 的第幾個元素是第幾段文案（桌前那段夜班、晨班各一份，位置不同） */
const CAPTION_CHAPTER = [0, 1, 2, 3, 4, 3] as const;
/** 只在某一班顯示的文案（其他班 visibility hidden，不讀出來） */
const CAPTION_THEME: readonly ('dark' | 'light' | null)[] = [null, null, null, 'dark', null, 'light'];

/** 章節標題只在片語邊界（<wbr>、標點）換行 */
const HEADING_CHAPTER =
  'font-serif text-[clamp(25px,7.2vw,34px)] leading-[1.24] font-black tracking-[0.02em] text-balance text-foreground [word-break:keep-all] lg:text-[clamp(30px,min(3.3vw,5.6svh),46px)]';
/** 交接那一行：跟觀測台的「觀測台」標題同一個字級與行高（clamp(28px,3.3vw,46px)、1.22），一行排完 */
const HEADING_HANDOFF =
  'font-serif text-[clamp(25px,7.2vw,34px)] leading-[1.22] font-black tracking-[0.02em] whitespace-nowrap text-foreground lg:text-[clamp(28px,3.3vw,46px)]';
/** 圖版正文欄比較窄（四欄），標題小一號 */
const HEADING_PLATE =
  'font-serif text-[clamp(25px,7.2vw,34px)] leading-[1.24] font-black tracking-[0.02em] text-balance text-foreground [word-break:keep-all] lg:text-[clamp(28px,2.5vw,36px)]';
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
 * 首屏標題底下的襯底（夜班）：用 --scrim 做的一片柔邊，畫面在字後面暗下來。
 * 寬螢幕是水平、垂直兩道柔邊相乘；手機用滿寬，只有上緣淡出。字的範圍都落在完全不透明的那一段裡。晨班用 DawnScrim。
 */
const SCRIM_WIDE = scrimMask(`${softRamp('to right', 0, 0, 78, 100)}, ${softRamp('to bottom', 0, 27, 88, 100)}`, true);
const SCRIM_NARROW = scrimMask(softRamp('to bottom', 0, 20, 100, 100), false);
/** 手機的交接文案在上方：下緣淡出 */
const SCRIM_NARROW_TOP = scrimMask(softRamp('to bottom', 0, 0, 68, 100), false);
/**
 * 寬螢幕第 2–5 段的柔邊：從文案靠畫面邊緣的那一側一路延伸到舞台邊緣（像首屏那片霧，不是一塊浮在畫面上的板子），
 * 朝畫面內側與上下用 smoothstep 的漸層淡掉；文字框整個落在完全不透明的那一段。
 */
type Edge = 'left' | 'right' | 'top-left' | 'top';
const FEATHER_X = 380;
const FEATHER_Y = 190;
function edgeMask(fl: number, fr: number, ft: number, fb: number): string {
  const ramp = (dir: string, a: number, b: number) => {
    const stops: string[] = [];
    const steps = 6;
    if (a > 0) for (let i = 0; i <= steps; i++) stops.push(`rgba(0,0,0,${ease(i / steps).toFixed(3)}) ${((a * i) / steps).toFixed(1)}px`);
    else stops.push('#000 0px');
    if (b > 0) for (let i = 0; i <= steps; i++) stops.push(`rgba(0,0,0,${(1 - ease(i / steps)).toFixed(3)}) calc(100% - ${(b * (1 - i / steps)).toFixed(1)}px)`);
    else stops.push('#000 100%');
    return `linear-gradient(${dir}, ${stops.join(', ')})`;
  };
  return `${ramp('to right', fl, fr)}, ${ramp('to bottom', ft, fb)}`;
}
const EDGE_SCRIM: Record<Edge, React.CSSProperties> = {
  left: { ...scrimMask(edgeMask(0, FEATHER_X, FEATHER_Y, FEATHER_Y), true), inset: `-${FEATHER_Y}px -${FEATHER_X}px -${FEATHER_Y}px -100vw` },
  right: { ...scrimMask(edgeMask(FEATHER_X, 0, FEATHER_Y, FEATHER_Y), true), inset: `-${FEATHER_Y}px -100vw -${FEATHER_Y}px -${FEATHER_X}px` },
  'top-left': { ...scrimMask(edgeMask(0, FEATHER_X, 0, FEATHER_Y), true), inset: `-100vh -${FEATHER_X}px -${FEATHER_Y}px -100vw` },
  top: { ...scrimMask(edgeMask(0, 0, 0, 96), true), inset: '-100vh -100vw -96px -100vw' },
};

/**
 * 晨班（淺色）的襯底：不是白霧，是從該章畫面取樣的一點冷色天光（--scrim 當底色，混進取樣的色調），
 * 只罩在文案那一塊：橢圓的遮罩、中間完整、外圈用 smoothstep 淡掉，看不到邊；
 * 整片的不透明度上限約 0.55（DAWN_SCRIM_OPACITY × 混色後的 alpha），不會變成橫跨畫面的一條霧帶。
 */
const DAWN_SCRIM_OPACITY = 0.6;
/**
 * 各章的襯底只給到「字讀得清楚」為止（逐像素量過：正文 ≥ 4.5:1、標題 ≥ 3:1）：
 * 首屏的海面明暗起伏大，給到上限；燈塔的天空、窗旁的塔身只要一點；晨班的桌前文案在曬亮的牆上，幾乎不用；
 * 交接那一列在變亮的後牆上，也只要一點。
 */
const DAWN_OPACITY = {
  hero: 'opacity-[calc(var(--scrim-k,1)*0.6)]',
  // 手機的文案貼著畫面下緣（海面、塔基、地板），明暗起伏大，給到上限
  tower: 'opacity-[calc(var(--scrim-k,1)*0.4)] max-lg:opacity-[calc(var(--scrim-k,1)*0.6)]',
  window: 'opacity-[calc(var(--scrim-k,1)*0.42)] max-lg:opacity-[calc(var(--scrim-k,1)*0.6)]',
  desk: 'opacity-[calc(var(--scrim-k,1)*0.22)] max-lg:opacity-[calc(var(--scrim-k,1)*0.6)]',
  handoff: 'opacity-[calc(var(--scrim-k,1)*0.32)] max-lg:opacity-[calc(var(--scrim-k,1)*0.5)]',
} as const;
/** 晨班各章取樣的色調（數值在 scene/theme.ts，與場景美術的色值放在一起） */
const DAWN_TINT = DAWN_CAPTION_TINT;
type DawnTint = keyof typeof DAWN_TINT;

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
 * rail 底下的角落暈影：以舞台右上角（畫面外）為圓心的大橢圓，四個站名都落在完整的範圍裡，往畫面內側淡掉三百多 px，
 * 看起來是畫面角落暗一點（或亮一點），不是一塊有邊的圓盤或底板
 */
function cornerMask(inner: number): string {
  const stops: string[] = [`#000 ${(inner * 100).toFixed(1)}%`];
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    stops.push(`rgba(0,0,0,${(1 - ease(t)).toFixed(3)}) ${((inner + (1 - inner) * t) * 100).toFixed(1)}%`);
  }
  return `radial-gradient(farthest-side ellipse at 100% 0%, ${stops.join(', ')})`;
}
const CORNER = cornerMask(0.58);
/** 夜班 rail 底下：--scrim 的暗色角落暈影（光束掃過右上角時，站名還是讀得到） */
const RAIL_SCRIM_NIGHT: React.CSSProperties = { background: 'var(--scrim)', maskImage: CORNER, WebkitMaskImage: CORNER };
/** --scrim-k：交接時房間溶成頁面底色，襯底跟著淡掉（底色上不留一塊亮斑）；其他段沒有設定，就是 1 */
function dawnScrimStyle(tint: DawnTint, opacity: number | null = DAWN_SCRIM_OPACITY): React.CSSProperties {
  return {
    // 淺色的取樣色用 --scrim 當底色混進去；深藍那一種直接用（天色本身）
    background: tint === 'skyDeep' ? DAWN_TINT[tint] : `color-mix(in oklab, var(--scrim) 45%, ${DAWN_TINT[tint]})`,
    ...(opacity == null ? {} : { opacity: `calc(var(--scrim-k, 1) * ${opacity})` }),
    maskImage: ELLIPSE,
    WebkitMaskImage: ELLIPSE,
  };
}
/** 晨班 rail 底下的角落暈影（同 dawnScrimStyle 的取色，遮罩換成角落） */
function railDawnStyle(tint: DawnTint, opacity: number): React.CSSProperties {
  return { ...dawnScrimStyle(tint, opacity), maskImage: CORNER, WebkitMaskImage: CORNER };
}
/**
 * rail 底下那一片比 rail 大很多、中心在 rail 上，超出畫面右上角的部分被舞台切掉，看起來是角落暗一點（亮一點），不是一塊橢圓的底板。
 * 晨班 rail 底下那一片：跟著目前這一章的畫面取色。天空（海面、燈塔）是中間調的藍：字改成淺色、底下深一點的天色；
 * 窗旁的塔身、室內的牆本來就亮：深色字、底下一點點淺色，不會在牆上浮出一塊亮斑
 */
const RAIL_SKY_CHAPTERS = 2;
/** 夜班 rail 底下那一片的濃度：海面、燈塔兩章有光束掃過右上角，給足；室內的牆是暖色的中間調，淺淺一層就夠（不在牆上留一塊黑影） */
const RAIL_NIGHT_OPACITY = [1, 0.85, 0.7, 0.45, 0.45] as const;
const RAIL_DAWN: readonly { tint: DawnTint; opacity: number }[] = [
  // 燈塔那一章的光束常常正好掃過右上角：深一點，光束在字後面時字還讀得到
  { tint: 'skyDeep', opacity: 0.6 },
  { tint: 'skyDeep', opacity: 0.72 },
  { tint: 'window', opacity: 0.4 },
  { tint: 'desk', opacity: 0.6 },
  { tint: 'handoff', opacity: 0.45 },
];

/**
 * 晨班的襯底：以文案為中心、比文案大一圈的橢圓（寬約 2.1 倍、高約 2.3 倍，文案的四角都落在完整不透明的範圍裡）。
 * 手機的文案貼著下緣（交接是上緣），橢圓往畫面外多延伸一點，不在字的下方留出一道邊。
 */
function DawnScrim({ tint, className }: { tint: keyof typeof DAWN_OPACITY; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute -z-10 inset-x-[-55%] inset-y-[-62%] dark:hidden', DAWN_OPACITY[tint], className)}
      style={dawnScrimStyle(tint, null)}
    />
  );
}

/** 第 2–5 段的柔邊襯底：夜班寬螢幕從畫面邊緣延伸過來、手機滿寬淡出；晨班是只罩住文案的橢圓 */
function CaptionScrim({
  edge,
  tint,
  strong = false,
  top: mobileTop = false,
}: {
  edge: Edge;
  tint: keyof typeof DAWN_OPACITY;
  strong?: boolean;
  /** 手機的文案在上方（寬螢幕的位置看 edge） */
  top?: boolean;
}) {
  const top = mobileTop;
  return (
    <>
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute -inset-x-4 -z-10 hidden dark:max-lg:block',
          top ? '-top-4 -bottom-6' : '-top-24 -bottom-[calc(1rem+var(--app-safe-area-bottom))]',
        )}
        style={top ? SCRIM_NARROW_TOP : SCRIM_NARROW}
      />
      <div aria-hidden className={cn('pointer-events-none absolute -z-10 hidden dark:lg:block', strong ? 'opacity-100' : 'opacity-95')} style={EDGE_SCRIM[edge]} />
      {/* 交接那一列很寬：橢圓只往左右多出一點、上下多一些，不會變成橫跨畫面的一條 */}
      <DawnScrim
        tint={tint}
        className={cn(
          top ? 'max-lg:inset-y-[-70%] max-lg:inset-x-[-42%]' : 'max-lg:inset-y-[-48%] max-lg:inset-x-[-42%]',
          edge === 'top' ? 'lg:inset-x-[-16%] lg:inset-y-[-90%]' : 'lg:inset-x-[-34%] lg:inset-y-[-66%]',
        )}
      />
    </>
  );
}

/** 固定頁首的高度（--app-header-height，可能是 rem 或 px） */
function headerOffset(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--app-header-height').trim();
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return 56;
  if (raw.endsWith('rem')) return n * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
  return n;
}

function scrollBehavior(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

/** 3D 場景出錯時改回海報（R3F 會把 Canvas 裡的錯誤往外丟） */
class SceneBoundary extends React.Component<{ onError: () => void; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** 直式的窄螢幕：首屏用 720×1440 的直幅海報，圖版用 720×900（4:5）的那張 */
const PORTRAIT_MEDIA = '(max-width: 1023px) and (orientation: portrait)';

/**
 * sync：海報版面時同步解碼——圖已經載好，畫面要畫到它時就一定畫出來，
 * 不會在整頁擷取或快速捲動時先露出一塊佔位色（async 解碼偶爾會趕不上那一格）。
 */
function PosterImage({
  n,
  theme,
  eager,
  sync,
  position,
  zoom = false,
}: {
  n: number;
  theme: 'night' | 'dawn';
  eager: boolean;
  sync: boolean;
  /** object-position（也當放大的中心） */
  position?: string;
  /** 橫幅的圖再放大一點，裁在三台螢幕上（手機直式的那張本來就是中間螢幕的特寫，不放大） */
  zoom?: boolean;
}) {
  return (
    <>
      <source media={PORTRAIT_MEDIA} srcSet={`/beacon/poster-${theme}-${n}-m.webp`} width={720} height={n === 1 ? 1440 : 900} />
      <img
        src={`/beacon/poster-${theme}-${n}.webp`}
        width={1600}
        height={900}
        alt=""
        decoding={sync ? 'sync' : 'async'}
        loading={eager ? 'eager' : 'lazy'}
        fetchPriority={n === 1 ? 'high' : eager ? 'auto' : 'low'}
        className={cn('absolute inset-0 size-full object-cover', zoom && 'scale-[1.38] max-lg:portrait:scale-100')}
        style={position ? { objectPosition: position, transformOrigin: position } : undefined}
      />
    </>
  );
}

/**
 * 海報：第一章在伺服器端就輸出兩個主題（主題 class 在首次繪製前就寫在 <html>，用 dark: 選圖才不會閃）。
 * 其他章等確定模式後才輸出目前主題的那張。
 */
function Poster({ index, show, eager, isDark }: { index: number; show: boolean; eager: boolean; isDark: boolean }) {
  const sync = eager;
  const n = index + 1;
  if (index === 0) {
    return (
      <>
        <picture className="hidden dark:inline">
          <PosterImage n={n} theme="night" eager sync={sync} />
        </picture>
        <picture className="inline dark:hidden">
          <PosterImage n={n} theme="dawn" eager sync={sync} />
        </picture>
      </>
    );
  }
  if (!show) return null;
  const theme = isDark ? 'night' : 'dawn';
  return (
    <picture key={theme}>
      <PosterImage n={n} theme={theme} eager={eager} sync={sync} />
    </picture>
  );
}

/* ---------- 文案（3D 版面與海報圖版共用；夜班、晨班各有自己的說法，跟畫面裡的時刻一致） ---------- */

/** 燈塔：夜班已經入夜；晨班是日出前、燈還亮著最後一圈 */
function TowerHeading() {
  return (
    <>
      <span className="hidden dark:inline">
        每十秒，
        <wbr />
        一道光
        <wbr />
        掃過海面。
      </span>
      <span className="dark:hidden">
        天亮前，
        <wbr />
        最後一圈光。
      </span>
    </>
  );
}
function TowerBody() {
  return (
    <>
      <span className="hidden dark:inline">燈塔不預測浪，它只讓你看清楚浪。先看清楚，再決定方向。</span>
      <span className="dark:hidden">
        燈快熄了，海面看得更清楚。先看清楚，
        <wbr />
        再決定方向。
      </span>
    </>
  );
}
/** 窗：夜班窗裡亮著燈；晨班的窗迎著剛出海面的太陽 */
function WindowHeading() {
  return (
    <>
      <span className="hidden dark:inline">
        還亮著燈的
        <wbr />
        那扇窗，
        <wbr />
        就是觀測室。
      </span>
      <span className="dark:hidden">
        迎著晨光的
        <wbr />
        那扇窗，
        <wbr />
        就是觀測室。
      </span>
    </>
  );
}
function DeskHeading() {
  return (
    <>
      守燈人的桌上，
      <wbr />
      換成了
      <wbr />
      整個市場。
    </>
  );
}
/** 交接：夜班是燈亮了；晨班走到這裡太陽已經出來了 */
function HandoffHeading() {
  return (
    <>
      <span className="hidden dark:inline">燈亮了，紀錄就位。</span>
      <span className="dark:hidden">天亮了，紀錄就位。</span>
    </>
  );
}

/* ---------- 海報圖版的看板：觀測台同一組三欄（左觀測清單、中報價、右加權指數），每欄只有一行真實資料 ---------- */

const FIG = 'font-mono tabular-nums';
const BOARD_CELL = 'flex min-h-11 min-w-0 items-baseline justify-between gap-x-2 bg-card px-4 py-2.5';
const BOARD_LABEL = 'shrink-0 text-[13px] font-medium tracking-[0.04em] text-muted-foreground';

type BoardProps = Pick<BeaconJourneyProps, 'board' | 'monitor' | 'stockCount' | 'industryCount'>;

/**
 * 海報版面最後的看板：一行的讀數條，欄寬跟觀測台一樣（300px | 1fr | 320px，1px 分隔線），手機的順序也一樣
 * （報價、觀測清單、加權指數）。每欄只寫一行：檔數與產業數；選中那一檔的收盤與單日漲跌；加權指數的收盤與漲跌。
 * 細節（開高低、K 線、法人）交給緊接在下面的觀測台，這裡不再排一次。
 */
function MarketBoard({ board, monitor, stockCount, industryCount }: BoardProps) {
  const b = boardFigures(board);
  const m = monitorFigures(monitor);
  const counts = countsText(stockCount, industryCount);
  const waiting = <span className="text-[13px] text-muted-foreground">讀取中…</span>;
  return (
    <div data-board>
      <div className="flex items-baseline justify-between gap-3 border-b border-border-strong pb-2">
        <h3 className="text-[13px] font-medium tracking-[0.04em] text-muted-foreground">看板</h3>
        <span className="characteristic">{b ? `收盤 ${b.date} · 非即時` : '最近儲存的收盤 · 非即時'}</span>
      </div>
      <dl className="grid gap-px border-x border-b bg-border lg:grid-cols-[300px_minmax(0,1fr)_320px]">
        <div className={cn(BOARD_CELL, 'order-2 lg:order-none')}>
          <dt className={BOARD_LABEL}>觀測清單</dt>
          <dd className={cn(FIG, 'truncate text-sm')}>{counts ?? waiting}</dd>
        </div>
        <div className={cn(BOARD_CELL, 'order-1 lg:order-none')}>
          <dt className={cn(BOARD_LABEL, 'text-foreground')}>
            {m ? (
              <>
                <span className="font-bold">{m.name}</span> <span className={cn(FIG, 'text-muted-foreground')}>{m.symbol}</span>
              </>
            ) : (
              '報價'
            )}
          </dt>
          <dd className={cn(FIG, 'flex min-w-0 items-baseline gap-x-2 text-sm whitespace-nowrap')}>
            {m ? (
              <>
                <span className="font-semibold">{m.close}</span>
                {m.change ? <span className={cn('truncate text-[13px]', toneText(m.tone))}>{m.change}</span> : null}
              </>
            ) : (
              waiting
            )}
          </dd>
        </div>
        <div className={cn(BOARD_CELL, 'order-3 lg:order-none')}>
          <dt className={BOARD_LABEL}>加權指數</dt>
          <dd className={cn(FIG, 'flex min-w-0 items-baseline gap-x-2 text-sm whitespace-nowrap')}>
            {b ? (
              <>
                <span className="font-semibold">{b.close}</span>
                {b.change ? <span className={cn('truncate text-[13px]', toneText(b.tone))}>{b.change}</span> : null}
              </>
            ) : (
              waiting
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/* ---------- 海報圖版 ---------- */

interface PlateProps {
  /** 第幾張海報（2–3） */
  n: 2 | 3;
  /** 章節標題列：站名 */
  stop: string;
  /** 標題列右側的燈質列（只放真實資料或燈質本身） */
  stamp?: React.ReactNode;
  /** 寬螢幕時圖放右邊、字放左邊 */
  flip?: boolean;
  isDark: boolean;
  plateRef: (el: HTMLElement | null) => void;
  children: React.ReactNode;
}

/** 一張圖版：有線的標題列、固定比例加細框的圖、圖旁（lg 8／4 欄）或圖下（手機）的正文 */
function Plate({ n, stop, stamp, flip = false, isDark, plateRef, children }: PlateProps) {
  return (
    <article ref={plateRef} className="grid grid-cols-1 gap-y-5 lg:grid-cols-12 lg:gap-x-10 lg:gap-y-6">
      <div className="flex items-end justify-between gap-4 border-b border-border-strong pb-2 lg:col-span-12 lg:row-start-1">
        <p className="text-[13px] font-medium tracking-[0.04em] text-muted-foreground">{stop}</p>
        {stamp ? <p className="characteristic">{stamp}</p> : null}
      </div>
      <figure
        className={cn(
          'relative aspect-video self-start overflow-hidden border border-border-strong bg-secondary max-lg:portrait:aspect-[4/5] lg:col-span-8 lg:row-start-2',
          flip ? 'lg:col-start-5' : 'lg:col-start-1',
        )}
      >
        <picture key={isDark ? 'night' : 'dawn'}>
          <PosterImage n={n} theme={isDark ? 'night' : 'dawn'} eager sync />
        </picture>
      </figure>
      <div className={cn('min-w-0 lg:col-span-4 lg:row-start-2 lg:self-end', flip ? 'lg:col-start-1' : 'lg:col-start-9')}>{children}</div>
    </article>
  );
}

/* ---------- 章節進度 ---------- */

interface RailProps {
  variant: 'scene' | 'poster';
  rail: number;
  /** 目前在第幾段（0–4）：晨班 rail 底下的襯底跟著這一段的畫面取色 */
  chapter: number;
  onGo: (i: number) => void;
  navRef?: React.Ref<HTMLElement>;
}

/**
 * 3D 版面（桌機）：右上角一條細線上的四個刻度，四個站名都寫出來——其他站是安靜的 12px，目前那一站 13px 粗體、刻度是燈色；
 * 沒有底板（底下只有一片跟文案一樣看不到邊的柔和襯底），位置與尺寸固定（換章節時不會跳動）。
 * 四個都是 44px 高的真按鈕，目前那一個有 aria-current。
 * 手機兩種版面都是一條滿寬的實心列（舞台頂端、或黏在頁首下方），寫著「2／4 燈塔」。
 * 海報版面（桌機）：首屏之後一條滿寬的實心列，黏在頁首下方（bg-card、下緣一條線）。
 */
function Rail({ variant, rail, chapter, onGo, navRef }: RailProps) {
  const scene = variant === 'scene';
  const buttons = RAIL.map((stop, i) => {
    const on = rail === i;
    return (
      <button
        key={stop.label}
        type="button"
        aria-current={on ? 'step' : undefined}
        data-selected={on ? 'true' : undefined}
        onClick={() => onGo(i)}
        className={cn(
          'group flex size-11 shrink-0 items-center justify-center text-[13px] tracking-[0.12em]',
          scene ? 'lg:h-11 lg:w-full lg:justify-end lg:gap-3' : 'lg:lamp-row lg:h-11 lg:w-auto lg:justify-start lg:gap-3 lg:px-4',
          on ? 'font-bold text-foreground' : 'font-normal text-muted-foreground',
        )}
      >
        {scene ? (
          <>
            <span
              className={cn(
                'max-lg:sr-only lg:transition-colors lg:duration-(--dur-flash)',
                on ? 'lg:text-[13px] lg:text-(--rail-ink)' : 'lg:text-xs lg:tracking-[0.08em] lg:text-(--rail-ink)',
              )}
            >
              {stop.label}
            </span>
            <span aria-hidden className="relative block h-0.5 w-5 shrink-0 lg:flex lg:h-full lg:w-[22px] lg:items-center lg:justify-center">
              <span
                className={cn(
                  'block shrink-0 transition-[width,background-color] duration-(--dur-sweep) ease-flash max-lg:h-0.5',
                  // hover：刻度線伸長到和目前那一站一樣長（仍是細線、不換燈色）
                  on ? 'w-5 bg-brand lg:h-[3px] lg:w-[22px]' : i < rail ? 'w-3 bg-foreground lg:h-px lg:w-3 lg:bg-(--rail-ink) lg:group-hover:w-[22px]' : 'w-3 bg-muted-foreground lg:h-px lg:w-3 lg:bg-(--rail-ink) lg:group-hover:w-[22px]',
                )}
              />
            </span>
          </>
        ) : (
          <>
            <span
              aria-hidden
              className={cn(
                'block h-0.5 shrink-0 transition-[width,background-color] duration-(--dur-sweep) ease-flash',
                on ? 'w-5 bg-brand lg:bg-foreground' : i < rail ? 'w-3 bg-foreground' : 'w-3 bg-muted-foreground',
              )}
            />
            <span className="max-lg:sr-only">{stop.label}</span>
          </>
        )}
      </button>
    );
  });
  const where = (
    <p aria-hidden className="ml-auto pr-2 text-[13px] whitespace-nowrap text-foreground lg:hidden">
      <span className="font-mono tabular-nums">
        {rail + 1}／{RAIL.length}
      </span>{' '}
      <span className="font-bold tracking-[0.12em]">{RAIL[rail].label}</span>
    </p>
  );
  if (scene) {
    return (
      <nav
        ref={navRef}
        aria-label="旅程進度"
        className={cn(
          'relative z-30 col-start-1 row-start-1 flex items-center self-start',
          'max-lg:w-full max-lg:justify-self-stretch max-lg:border-b max-lg:bg-card max-lg:px-2',
          'opacity-[var(--rail-o,1)] [visibility:var(--rail-v,visible)] lg:mt-4 lg:w-32 lg:flex-col lg:items-stretch lg:justify-self-end',
          // 站名、刻度與細線的顏色：一般是前景色；晨班在天空上的兩章是淺色（--rail-sky），夜班一律前景色
          'lg:[--rail-ink:var(--rail-sky,var(--foreground))] dark:lg:[--rail-ink:var(--foreground)]',
          GUTTER_R,
          'motion-reduce:hidden',
        )}
        style={chapter < RAIL_SKY_CHAPTERS ? ({ '--rail-sky': 'var(--background)' } as React.CSSProperties) : undefined}
      >
        {/* 桌機：四個站名都寫出來（目前那一站粗一號），底下一片跟文案一樣、看不到邊的柔和襯底（不是方框），一條貫穿四個刻度的細線 */}
        <span
          aria-hidden
          className="pointer-events-none absolute -top-28 -right-44 -z-10 hidden h-[620px] w-[640px] dark:lg:block"
          style={{ ...RAIL_SCRIM_NIGHT, opacity: `calc(var(--scrim-k, 1) * ${RAIL_NIGHT_OPACITY[chapter]})` }}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute -top-28 -right-44 -z-10 h-[620px] w-[640px] max-lg:hidden dark:hidden"
          style={railDawnStyle(RAIL_DAWN[chapter].tint, RAIL_DAWN[chapter].opacity)}
        />
        <span aria-hidden className="pointer-events-none absolute top-[22px] right-[10.5px] bottom-[22px] w-px bg-(--rail-ink) opacity-70 max-lg:hidden" />
        {buttons}
        {where}
      </nav>
    );
  }
  return (
    <nav ref={navRef} aria-label="旅程進度" className="sticky top-[var(--app-header-height)] z-30 border-b bg-card">
      <div className="mx-auto flex h-11 max-w-[1320px] items-center px-2 sm:px-4 lg:px-10">
        {buttons}
        {where}
      </div>
    </nav>
  );
}

/**
 * /stocks/info 的清單（跟觀測台共用同一個去重快取，不會多打一次）：
 * 中間螢幕要寫的產業，以及交接終點左欄的觀測清單（代號、名稱、產業）。只在 3D 版面需要時才讀。
 */
function useStockList(enabled: boolean, symbol: string | null): { industry: string | null; watch: WatchItem[] | null } {
  const { data } = useStockInfos({ enabled });
  const list = useMemo<WatchItem[] | null>(
    () => (data ? data.map((s) => ({ symbol: s.symbol, name: s.name, industry: s.industry ?? null })) : null),
    [data],
  );
  const industry = symbol && list ? (list.find((s) => s.symbol === symbol)?.industry ?? null) : null;
  return { industry, watch: list };
}

interface TerminalShape {
  layout: MeasuredTerminal | null;
  spark: SparkLine | null;
}

/**
 * 量頁面上的觀測台（#terminalId）：三欄的位置、右欄第一格（加權指數）的高度，與那一格裡的走勢線。
 * 交接終點的三塊畫面依這些位置排，捲過舞台時剛好接上觀測台的三欄（觀測台的說明列、手機的搜尋列都算進去）。
 * 只讀不寫；觀測台的尺寸或那一格的內容變了才重量（ResizeObserver、MutationObserver，用 rAF 合併）。
 */
function readTerminal(terminalId: string): TerminalShape {
  const none: TerminalShape = { layout: null, spark: null };
  const section = document.getElementById(terminalId);
  const grid = document.getElementById(`${terminalId}-watchlist`)?.parentElement;
  if (!section || !grid || grid.getClientRects().length === 0) return none;
  const cols = Array.from(grid.children).slice(0, 3) as HTMLElement[];
  if (cols.length < 3) return none;
  const panel = cols[2].firstElementChild as HTMLElement | null;
  const rect = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  };
  const layout = measureTerminalColumns(section.getBoundingClientRect().top, cols.map(rect), panel ? panel.clientHeight : null);
  let spark: SparkLine | null = null;
  const poly = panel?.querySelector('svg polyline');
  if (poly) {
    const points = (poly.getAttribute('points') ?? '')
      .trim()
      .split(/\s+/)
      .map((pair) => pair.split(',').map(Number))
      .filter((a): a is [number, number] => a.length === 2 && a.every(Number.isFinite));
    const color = getComputedStyle(poly).stroke;
    if (points.length >= 2 && color && color !== 'none') spark = { points, color };
  }
  return { layout, spark };
}

function useTerminalShape(terminalId: string, enabled: boolean, isDark: boolean): TerminalShape {
  const [shape, setShape] = useState<TerminalShape>({ layout: null, spark: null });
  const last = useRef('');
  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const next = readTerminal(terminalId);
      const key = JSON.stringify(next);
      if (key === last.current) return;
      last.current = key;
      setShape(next);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    const ro = new ResizeObserver(schedule);
    const mo = new MutationObserver(schedule);
    const section = document.getElementById(terminalId);
    const grid = document.getElementById(`${terminalId}-watchlist`)?.parentElement;
    if (section) ro.observe(section);
    if (grid) {
      ro.observe(grid);
      // 右欄第一格（加權指數）：走勢線出現或換了資料（只看這一格，不看下面有圖表、會因滑鼠移動而變的面板）
      const panel = grid.children[2]?.firstElementChild;
      if (panel) mo.observe(panel, { childList: true, subtree: true, attributes: true, attributeFilter: ['points', 'class'] });
    }
    window.addEventListener('resize', schedule);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [terminalId, enabled]);
  // 換班：走勢線的顏色（--up／--down）跟著主題變，重讀一次
  useEffect(() => {
    if (!enabled) return;
    const id = requestAnimationFrame(() => {
      const next = readTerminal(terminalId);
      last.current = JSON.stringify(next);
      setShape(next);
    });
    return () => cancelAnimationFrame(id);
  }, [terminalId, enabled, isDark]);
  return shape;
}

export function BeaconJourney({ terminalId, stockCount, industryCount, board, monitor }: BeaconJourneyProps) {
  const [mode, setMode] = useState<Mode>('pending');
  const [reason, setReason] = useState<PosterReason | null>(null);
  const [loadScene, setLoadScene] = useState(false);
  // context 掉過一次就不再重載（避免一直建了又掉）
  const [sceneBlocked, setSceneBlocked] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [postersHidden, setPostersHidden] = useState(false);
  const [inView, setInView] = useState(true);
  const [docVisible, setDocVisible] = useState(true);
  /** 目前在第幾段（0–4）；rail 與底下的海報由它推算 */
  const [chapter, setChapter] = useState(0);
  /** 3D 版面走過最遠的海報（之後的海報還不必載） */
  const [reachedPoster, setReachedPoster] = useState(0);
  const isMobile = useIsMobile();
  const canHover = useCanHoverTilt();
  const isDark = useHtmlDarkClass();
  const { industry, watch } = useStockList(mode === 'scene' && loadScene, monitor?.symbol ?? null);
  const terminal = useTerminalShape(terminalId, mode === 'scene' && loadScene, isDark);

  const trackRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLElement>(null);
  /** 3D 版面的 rail（桌機在交接終點淡出，讓出觀測台的右欄） */
  const sceneRailRef = useRef<HTMLElement>(null);
  const captionRefs = useRef<(HTMLDivElement | null)[]>([]);
  /** 3D 版面：舞台裡的四格海報；海報版面：[首屏那格, 三張圖版] */
  const posterRefs = useRef<(HTMLElement | null)[]>([]);
  const plateRefs = useRef<(HTMLElement | null)[]>([]);
  const metrics = useRef({ top: 0, height: 0, viewport: 0 });
  const progress = useMotionValue(0);
  const chapterRef = useRef(0);

  const sceneLayout = mode !== 'poster';
  const rail = CHAPTERS[chapter].rail;
  const posterActive = POSTER_OF_CHAPTER[chapter];

  // 判斷模式：減少動態、低功耗先決定；WebGL 等閒置時再測
  useEffect(() => {
    const decide = () => {
      const d = decideJourneyMode(readJourneyEnv(window));
      setMode((prev) => (prev === 'poster' && d.mode === 'scene' ? prev : d.mode));
      setReason((prev) => d.reason ?? prev);
      if (d.mode === 'poster') setLoadScene(false);
    };
    decide();
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    mq.addEventListener('change', decide);
    return () => mq.removeEventListener('change', decide);
  }, []);

  // 閒置後才測 WebGL、載入場景
  useEffect(() => {
    if (mode !== 'scene' || loadScene || sceneBlocked) return;
    let cancelled = false;
    const go = () => {
      if (cancelled) return;
      if (!probeWebGL2(document)) {
        setMode('poster');
        setReason('no-webgl');
        return;
      }
      setLoadScene(true);
    };
    const w = window as Window & { requestIdleCallback?: typeof requestIdleCallback; cancelIdleCallback?: typeof cancelIdleCallback };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(go, { timeout: 2500 });
      return () => {
        cancelled = true;
        w.cancelIdleCallback?.(id);
      };
    }
    const id = window.setTimeout(go, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [mode, loadScene, sceneBlocked]);

  // 捲動 → 進度（只在 3D 版面；海報版面另外算目前在哪張圖版）
  const measure = useCallback(() => {
    const track = trackRef.current;
    const stage = stageRef.current;
    if (!track || !stage) return;
    const rect = track.getBoundingClientRect();
    // 舞台黏在頁首下方（sticky top = 頁首高）：進度從舞台黏住的那一刻算起，到軌道底端放開時剛好是 1，
    // 終點那一格（三欄排好）才會完整停在畫面上，而不是已經被往上推走一個頁首的高度
    const stickyTop = parseFloat(getComputedStyle(stage).top) || 0;
    metrics.current = { top: rect.top + window.scrollY - stickyTop, height: track.offsetHeight, viewport: stage.offsetHeight || window.innerHeight };
  }, []);

  useEffect(() => {
    if (!sceneLayout) return;
    // 每次捲動都重新量軌道的位置（頁首或上方內容在載入後改了高度，軌道的位置就跟著變；只讀不寫，不會觸發重排）
    const update = () => {
      measure();
      const m = metrics.current;
      progress.set(journeyProgress(window.scrollY, m.top, m.height, m.viewport));
    };
    const onResize = () => {
      measure();
      update();
    };
    onResize();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver(onResize);
    if (trackRef.current) ro.observe(trackRef.current);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', onResize);
      ro.disconnect();
    };
  }, [sceneLayout, measure, progress]);

  const setChapterIndex = useCallback((i: number) => {
    if (chapterRef.current === i) return;
    chapterRef.current = i;
    setChapter(i);
  }, []);

  // 進度 → 文案透明度與位移（直接寫 style，不經過 React render）
  // 淡到 5% 以下就整個藏起來，不接受指標；章節中間永遠是完整顯示（見 captionOpacity）
  const applyCaptions = useCallback(
    (p: number) => {
      const dark = document.documentElement.classList.contains('dark');
      // 交接（0.92 起）：交接那段文案與「進入觀測台」跟著 h 淡出，終點那一格只剩三塊排好的畫面
      const h = handoffValue(p);
      const leave = handoffCaption(h);
      captionRefs.current.forEach((el, i) => {
        if (!el) return;
        const only = CAPTION_THEME[i];
        const chapter = CAPTION_CHAPTER[i] ?? i;
        const base = only && only !== (dark ? 'dark' : 'light') ? 0 : captionOpacity(chapter, p);
        const o = chapter === CHAPTERS.length - 1 ? base * leave : base;
        const shown = o >= CAPTION_HIDE_BELOW;
        el.style.opacity = shown ? o.toFixed(3) : '0';
        el.style.transform = shown && o < 1 ? `translateY(${((1 - o) * 12).toFixed(1)}px)` : '';
        el.style.visibility = shown ? 'visible' : 'hidden';
        el.style.pointerEvents = shown ? '' : 'none';
      });
      // rail 在交接的前段淡出（三欄升到 rail 的高度以前就不見；終點那一格跟觀測台的開頭一模一樣，不留東西）
      const nav = sceneRailRef.current;
      if (nav) {
        const r = railFade(p);
        nav.style.setProperty('--rail-o', r.toFixed(3));
        nav.style.setProperty('--rail-v', r < CAPTION_HIDE_BELOW ? 'hidden' : 'visible');
      }
      // 交接段的襯底跟著房間一起溶掉（終點只剩頁面底色）
      const k = (1 - handoffRoom(h)).toFixed(3);
      captionRefs.current[4]?.style.setProperty('--scrim-k', k);
      sceneRailRef.current?.style.setProperty('--scrim-k', k);
      setChapterIndex(chapterIndex(p));
    },
    [setChapterIndex],
  );
  useMotionValueEvent(progress, 'change', (p) => {
    if (sceneLayout) applyCaptions(p);
  });
  // 換班：桌前那段文案換到另一班的位置
  useEffect(() => {
    if (sceneLayout) applyCaptions(progress.get());
  }, [isDark, sceneLayout, applyCaptions, progress]);

  // 換版面時：3D 版面依目前進度套樣式；海報版面清掉 inline style，並依捲動位置算目前在哪張圖版
  useEffect(() => {
    if (sceneLayout) {
      applyCaptions(progress.get());
      return;
    }
    captionRefs.current.forEach((el) => {
      if (!el) return;
      el.style.opacity = '';
      el.style.transform = '';
      el.style.visibility = '';
      el.style.pointerEvents = '';
    });
    const update = () => {
      const mid = window.innerHeight * 0.5;
      const cells = [posterRefs.current[0], ...plateRefs.current];
      let idx = 0;
      cells.forEach((el, i) => {
        if (el && el.getBoundingClientRect().top <= mid) idx = i;
      });
      setChapterIndex(CHAPTER_OF_PLATE[idx] ?? 0);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, [sceneLayout, applyCaptions, progress, setChapterIndex]);

  // 3D 版面：記下走過最遠的海報（場景還沒接手時才需要它們）
  useEffect(() => {
    setReachedPoster((r) => Math.max(r, posterActive));
  }, [posterActive]);

  // 舞台不在畫面內、分頁隱藏時，場景的 render loop 要停
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting));
    io.observe(track);
    const vis = () => setDocVisible(!document.hidden);
    vis();
    document.addEventListener('visibilitychange', vis);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', vis);
    };
  }, []);

  // 場景淡入完成後把底下的海報藏起來（少一層要合成的大圖）
  useEffect(() => {
    if (!sceneReady) {
      setPostersHidden(false);
      return;
    }
    const id = window.setTimeout(() => setPostersHidden(true), 1400);
    return () => window.clearTimeout(id);
  }, [sceneReady]);

  const onSceneReady = useCallback(() => setSceneReady(true), []);
  // WebGL context 掉了：收掉場景，底下的海報會露出來（觀測台的 --handoff 一起拿掉）
  const onSceneLost = useCallback(() => {
    clearHandoff();
    setSceneReady(false);
    setSceneBlocked(true);
    setLoadScene(false);
  }, []);
  const onSceneError = useCallback(() => {
    clearHandoff();
    setSceneReady(false);
    setLoadScene(false);
    setMode('poster');
    setReason('no-webgl');
  }, []);

  // --handoff 只屬於正在跑的 3D 交接：海報版面（減少動態、沒有 WebGL、低功耗）、換頁、卸載時一定拿掉，
  // 觀測台與其他頁面不會停在半透明（場景自己在卸載、loop 停下時也會拿掉）
  useEffect(() => {
    if (mode !== 'scene') clearHandoff();
  }, [mode]);
  useEffect(() => {
    Router.events.on('routeChangeStart', clearHandoff);
    return () => {
      Router.events.off('routeChangeStart', clearHandoff);
      clearHandoff();
    };
  }, []);

  const goToTerminal = useCallback(() => {
    const el = document.getElementById(terminalId);
    if (!el) return;
    el.focus({ preventScroll: true });
    const top = el.getBoundingClientRect().top + window.scrollY - headerOffset();
    window.scrollTo({ top: Math.max(0, top), behavior: scrollBehavior() });
  }, [terminalId]);

  /** 3D 版面捲到進度 p；海報版面捲到第 plate 格（0 是首屏，1–3 是圖版，停在黏住的進度列下方） */
  const goToProgress = useCallback(
    (p: number, plate: number) => {
      if (sceneLayout) {
        measure();
        const m = metrics.current;
        window.scrollTo({ top: scrollYForProgress(p, m.top, m.height, m.viewport), behavior: scrollBehavior() });
        return;
      }
      const el = plate === 0 ? posterRefs.current[0] : plateRefs.current[plate - 1];
      if (!el) return;
      const bar = plate === 0 ? 0 : (railRef.current?.offsetHeight ?? 44) + 16;
      const top = el.getBoundingClientRect().top + window.scrollY - headerOffset() - bar;
      window.scrollTo({ top: Math.max(0, top), behavior: scrollBehavior() });
    },
    [sceneLayout, measure],
  );

  // rail 第 i 站：前三站對應首屏與前兩張圖版（3D 版面是對應的進度），最後一站直接到觀測台
  const goToStop = (i: number) => {
    const target = RAIL[i]?.target;
    if (target == null) goToTerminal();
    else goToProgress(target, i);
  };

  const characteristic = board ? `大盤收盤 ${board.date} · 非即時` : CLOSE_DATA_NOTE;
  const counts =
    stockCount != null && industryCount != null
      ? `${stockCount.toLocaleString('zh-TW')} 檔股票、${industryCount.toLocaleString('zh-TW')} 個產業，每一筆都標著資料日期。`
      : '每一筆收盤紀錄，都標著資料日期。';

  const posterCell = (i: number) =>
    cn(
      'relative z-0 col-start-1 row-start-1 self-stretch overflow-hidden bg-secondary transition-opacity duration-(--dur-beam) ease-swell',
      i > 0 && 'in-data-[mode=poster]:hidden motion-reduce:hidden',
      i === 0 && 'in-data-[mode=poster]:opacity-100 motion-reduce:opacity-100',
      posterActive === i ? 'opacity-100' : 'opacity-0',
      postersHidden && 'invisible',
    );
  const posterShown = (i: number) => mode === 'scene' && !postersHidden && i <= reachedPoster;

  return (
    <section data-mode={mode} aria-label="從海面登上燈塔" className="relative">
      <div ref={trackRef} className="relative h-[440vh] max-lg:h-[260svh] motion-reduce:h-auto! in-data-[mode=poster]:h-auto!">
        <div
          ref={stageRef}
          className={cn(
            'sticky top-[var(--app-header-height)] isolate grid h-[calc(100dvh-var(--app-header-height))] grid-cols-1 grid-rows-1 overflow-clip bg-background',
            'motion-reduce:static motion-reduce:h-[calc(100svh-var(--app-header-height))]',
            'in-data-[mode=poster]:static in-data-[mode=poster]:h-[calc(100svh-var(--app-header-height))]',
          )}
        >
          {Array.from({ length: POSTER_COUNT }, (_, i) => (
            <div key={i} ref={(el) => void (posterRefs.current[i] = el)} aria-hidden className={posterCell(i)}>
              <Poster index={i} show={posterShown(i)} eager={mode === 'poster'} isDark={isDark} />
            </div>
          ))}

          {/* 第一段：海面。標題直接排在場景的留白上，底下只有一片柔邊的 --scrim */}
          <div
            ref={(el) => void (captionRefs.current[0] = el)}
            data-hero
            className={cn(
              'relative z-20 col-start-1 row-start-1 lg:w-fit lg:max-w-[min(46rem,calc(100%-5rem))]',
              MOBILE_BOTTOM,
              'lg:justify-self-start lg:mr-0 lg:mb-[clamp(1.5rem,6svh,4rem)]',
              GUTTER_L,
            )}
          >
            <div aria-hidden className="pointer-events-none absolute -inset-x-4 -top-[42%] -bottom-16 -z-10 hidden dark:max-lg:block" style={SCRIM_NARROW} />
            <div aria-hidden className="pointer-events-none absolute -top-[45%] -right-[45%] -bottom-[20%] -left-[60%] -z-10 hidden dark:lg:block" style={SCRIM_WIDE} />
            <DawnScrim tint="hero" className="max-lg:inset-x-[-42%] max-lg:inset-y-[-58%]" />
            <p className="characteristic text-foreground!">{characteristic}</p>
            <h1 className="mt-2 font-serif text-[clamp(32px,10.2vw,46px)] leading-[1.14] font-black tracking-[0.03em] text-foreground [word-break:keep-all] lg:mt-3 lg:text-[clamp(44px,min(6.2vw,9svh),86px)] lg:leading-[1.12]">
              在行情的浪裡，
              <br />
              替你守一盞燈。
            </h1>
            <p className={cn(BODY, 'max-lg:hidden')}>
              從海上的燈塔出發，登上燈籠下方的觀測室——那裡整理好資料庫最近儲存的收盤價、K 線、三大法人與財經新聞。非即時資料，供學習與專題使用。
            </p>
            <p className={cn(BODY, 'mt-2 lg:hidden')}>資料庫最近儲存的收盤價、K 線、法人與新聞。非即時資料，供學習與專題使用。</p>
            <div className="mt-4 flex flex-wrap gap-3 lg:mt-5">
              <Button type="button" onClick={() => goToProgress(WATCH_ROOM_PROGRESS, 3)}>
                登上燈塔
                <ArrowDown aria-hidden />
              </Button>
              <Button type="button" variant="outline" onClick={goToTerminal}>
                直接看觀測台
                <ArrowRight aria-hidden />
              </Button>
            </div>
            {reason === 'no-webgl' && <p className="mt-3 text-[13px] leading-relaxed text-foreground">這台裝置無法啟用 3D 場景，已改用靜態畫面。</p>}
          </div>

          {/* 第二段：燈塔（左上的天空） */}
          <div ref={(el) => void (captionRefs.current[1] = el)} className={cn(CAPTION, PLACE.tower)}>
            <CaptionScrim edge="top-left" tint="tower" />
            <h2 className={HEADING_CHAPTER}>
              <TowerHeading />
            </h2>
            <p className={BODY}>
              <TowerBody />
            </p>
          </div>

          {/* 第三段：窗（窗的右邊） */}
          <div ref={(el) => void (captionRefs.current[2] = el)} className={cn(CAPTION, PLACE.window)}>
            <CaptionScrim edge="right" tint="window" />
            <h2 className={HEADING_CHAPTER}>
              <WindowHeading />
            </h2>
            <p className={BODY}>站得高，才看得遠。</p>
          </div>

          {/* 第四段：守燈人的桌前。夜班在左邊牆裙上方的牆面；晨班在右邊曬到太陽的牆面（同一段文案，各班一份，只顯示目前那一班的） */}
          <div ref={(el) => void (captionRefs.current[3] = el)} className={cn(CAPTION, PLACE.deskNight)}>
            <CaptionScrim edge="left" tint="desk" strong />
            <h2 className={HEADING_CHAPTER}>
              <DeskHeading />
            </h2>
            <p className={BODY}>{counts}</p>
          </div>
          <div ref={(el) => void (captionRefs.current[5] = el)} className={cn(CAPTION, PLACE.deskDawn)}>
            <CaptionScrim edge="right" tint="desk" strong top />
            <h2 className={HEADING_CHAPTER}>
              <DeskHeading />
            </h2>
            <p className={BODY}>{counts}</p>
          </div>

          {/* 第五段：交接給觀測台（0.78–1）。寬螢幕在左上方的牆（標題跟觀測台的標題列同一行，下一行是「進入觀測台」，不疊在看板上方）；
              手機在中間螢幕下方的桌前。0.92 起跟著交接淡出，終點只剩三塊螢幕排成的三欄 */}
          <div ref={(el) => void (captionRefs.current[4] = el)} className={cn(CAPTION, PLACE.handoff)}>
            <CaptionScrim edge="top-left" tint="handoff" />
            <div className="flex flex-col items-start gap-y-3">
              <h2 className={HEADING_HANDOFF}>
                <HandoffHeading />
              </h2>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <p className="text-[15px] leading-[1.75] text-foreground lg:text-[17px]">往下，就是觀測台。</p>
                <Button type="button" onClick={goToTerminal}>
                  進入觀測台
                  <ArrowDown aria-hidden />
                </Button>
              </div>
            </div>
          </div>

          {/* 3D 場景：閒置後才載入，第一格畫好後像霧散開一樣淡入 */}
          {sceneLayout && (
            <div
              aria-hidden
              data-ready={sceneReady ? 'true' : 'false'}
              className="pointer-events-none absolute inset-0 z-10 opacity-0 transition-opacity duration-(--dur-eclipse) ease-swell data-[ready=true]:opacity-100 motion-reduce:hidden"
            >
              {loadScene && (
                <SceneBoundary onError={onSceneError}>
                  <BeaconScene
                    progress={progress}
                    running={inView && docVisible}
                    mobile={isMobile}
                    canHover={canHover}
                    stockCount={stockCount}
                    industryCount={industryCount}
                    board={board}
                    monitor={monitor}
                    industry={industry}
                    watch={watch}
                    spark={terminal.spark}
                    handoff={terminal.layout}
                    onReady={onSceneReady}
                    onLost={onSceneLost}
                  />
                </SceneBoundary>
              )}
            </div>
          )}

          {sceneLayout && <Rail variant="scene" rail={rail} chapter={chapter} onGo={goToStop} navRef={sceneRailRef} />}
        </div>
      </div>

      {/* 海報版面：首屏之後的圖版。進度列黏在頁首下方，圖版之間是帳頁的間距；最後的看板直接接上觀測台 */}
      {mode === 'poster' && (
        <div className="relative bg-background">
          <Rail variant="poster" rail={rail} chapter={chapter} onGo={goToStop} navRef={railRef} />
          <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-10 px-4 pt-10 sm:px-6 lg:gap-16 lg:px-10 lg:pt-16">
            <Plate n={2} stop="燈塔" isDark={isDark} plateRef={(el) => void (plateRefs.current[0] = el)}>
              <h2 className={HEADING_PLATE}>
                <TowerHeading />
              </h2>
              <p className={BODY}>
                <TowerBody />
              </p>
            </Plate>
            <Plate n={3} stop="觀測室" flip isDark={isDark} plateRef={(el) => void (plateRefs.current[1] = el)}>
              <h2 className={HEADING_PLATE}>
                <WindowHeading />
              </h2>
              <p className={BODY}>站得高，才看得遠。燈籠下方這一層，是守燈人記帳的地方。</p>
            </Plate>
            {/* 最後一張：章名與標題 → 裁在三台螢幕上的圖 → 一行一欄的看板（真實資料） → 「進入觀測台」，往下就是觀測台 */}
            <article ref={(el) => void (plateRefs.current[2] = el)} className="grid grid-cols-1 gap-y-5 lg:gap-y-6">
              <div className="flex items-end justify-between gap-4 border-b border-border-strong pb-2">
                <p className="text-[13px] font-medium tracking-[0.04em] text-muted-foreground">觀測台</p>
              </div>
              <div className="min-w-0">
                <h2 className={HEADING_PLATE}>
                  <DeskHeading />
                </h2>
                <p className={BODY}>每一筆收盤紀錄，都標著資料日期。</p>
              </div>
              <figure className="relative aspect-[1240/420] overflow-hidden border border-border-strong bg-secondary max-lg:portrait:aspect-[4/5]">
                <picture key={isDark ? 'night' : 'dawn'}>
                  {/* 第四張海報裡三台螢幕在畫面下方約 62–80%（上方是看板與海圖）：放大的中心壓低，裁在三台螢幕上 */}
                  <PosterImage n={4} theme={isDark ? 'night' : 'dawn'} eager sync position="50% 82%" zoom />
                </picture>
              </figure>
              <MarketBoard board={board} monitor={monitor} stockCount={stockCount} industryCount={industryCount} />
              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
                <p className="text-[15px] leading-[1.75] text-foreground lg:text-[17px]">
                  <HandoffHeading />
                  往下，就是觀測台。
                </p>
                <Button type="button" onClick={goToTerminal}>
                  進入觀測台
                  <ArrowDown aria-hidden />
                </Button>
              </div>
            </article>
          </div>
        </div>
      )}
    </section>
  );
}
