import { useState, useSyncExternalStore } from 'react';
import { usePrefersReducedMotion } from '@/lib/hooks/useClientEnv';
import { cn } from '@/lib/cn';
import {
  MASCOT_PAINT_ORDER, MASCOT_PAINT_VAR, MASCOT_TICK_MS, SPRITE_HEIGHT, SPRITE_WIDTH,
  mascotFrame, mascotPaths, type MascotLook, type MascotMood,
} from './sprite';

/**
 * 全站共用一個時鐘：畫面上幾隻小燈（按鈕、面板標題）同一格換圖，呼吸與燈閃同步。
 * 沒有人訂閱、或分頁切到背景時停下來，不在背景空轉。
 * 從 64 起算：第一次出現後約 2 秒就閃一次燈，不用等滿 10 秒。
 */
let tick = 64;
let timer: number | null = null;
const listeners = new Set<() => void>();

function start() {
  if (timer !== null || document.hidden || !listeners.size) return;
  timer = window.setInterval(() => {
    tick += 1;
    listeners.forEach((listener) => listener());
  }, MASCOT_TICK_MS);
}

function stop() {
  if (timer === null) return;
  window.clearInterval(timer);
  timer = null;
}

function onVisibilityChange() {
  if (document.hidden) stop();
  else start();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) document.addEventListener('visibilitychange', onVisibilityChange);
  start();
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    stop();
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}

const noSubscribe = () => () => {};

/** 動畫格數；不動（減少動態）時固定 0，也不訂閱時鐘 */
function useMascotTick(running: boolean): number {
  return useSyncExternalStore(running ? subscribe : noSubscribe, () => (running ? tick : 0), () => 0);
}

/**
 * 像素版小燈（商標圖形，不是介面圖示，和 BrandMark 一樣不受「圖示只用 lucide」限制）。
 * scale 是一格幾個 CSS px（className 可以再用 CSS 寬度覆蓋，高度跟著比例）；顏色全部來自 --mascot-* token，晨海、夜海自動切換。
 * still：使用者在面板按了「暫停小燈動作」，和減少動態一樣只畫靜止的圖。
 */
export function LighthouseMascot({ mood, scale = 2, look = 0, drowsy = false, surfing = false, still = false, className }: {
  mood: MascotMood;
  scale?: number;
  look?: MascotLook;
  drowsy?: boolean;
  surfing?: boolean;
  still?: boolean;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion() || still;
  const now = useMascotTick(!reduced);
  // 換心情時記下當時的格數：打招呼、回答完成的跳躍從這一格開始播
  const [anchor, setAnchor] = useState({ mood, since: now });
  if (anchor.mood !== mood) setAnchor({ mood, since: now });
  const paths = mascotPaths(mascotFrame(mood, now, anchor.mood === mood ? anchor.since : now, { look, reduced, drowsy, surfing }));

  return (
    <svg
      viewBox={`0 0 ${SPRITE_WIDTH} ${SPRITE_HEIGHT}`}
      width={SPRITE_WIDTH * scale}
      height={SPRITE_HEIGHT * scale}
      shapeRendering="crispEdges"
      className={cn('shrink-0', className)}
      aria-hidden
      data-mood={mood}
    >
      {MASCOT_PAINT_ORDER.map((paint) => (paths[paint] ? <path key={paint} d={paths[paint]} fill={MASCOT_PAINT_VAR[paint]} /> : null))}
    </svg>
  );
}
