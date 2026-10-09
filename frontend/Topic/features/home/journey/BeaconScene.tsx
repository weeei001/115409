/**
 * 首頁旅程的 3D 場景（只在 client 載入：BeaconJourney 用 next/dynamic ssr:false，閒置後才 import）。
 * 場景本體在 scene/buildBeacon.ts（命令式建 three 物件），這裡負責 R3F 的 Canvas、每格更新、晨夜混合與釋放。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { MotionValue } from 'motion/react';
import { useHtmlDarkClass } from '@/lib/hooks/useClientEnv';
import { createBeacon, type BeaconWorld, type FaceProbe } from './scene/buildBeacon';
import { loadScreenFonts, type ScreenData, type SparkLine, type WatchItem } from './scene/screens';
import { CHAPTERS, HANDOFF_END, HANDOFF_START, handoffValue, type MeasuredTerminal } from './journeyMath';
import { clearHandoff, currentHandoff, writeHandoff, writtenHandoff } from './handoffVar';
import type { BeaconJourneyProps } from './types';

export interface BeaconSceneProps extends Pick<BeaconJourneyProps, 'stockCount' | 'industryCount' | 'board' | 'monitor'> {
  /** 選中股票的產業（中間螢幕的燈質列「代號 · 產業 · 收盤 日期」） */
  industry: string | null;
  /** 觀測清單（/stocks/info）：交接終點的左欄依產業列出 */
  watch: readonly WatchItem[] | null;
  /** 觀測台「加權指數」面板的走勢線（從觀測台讀來；右螢幕畫同一條） */
  spark: SparkLine | null;
  /** 頁面上量到的觀測台三欄（交接終點對齊用） */
  handoff: MeasuredTerminal | null;
  /** 捲動進度 0–1（BeaconJourney 依捲動手動 set） */
  progress: MotionValue<number>;
  /** 舞台在畫面內且分頁可見；false 時整個 render loop 停下 */
  running: boolean;
  mobile: boolean;
  /** 滑鼠裝置才做視差 */
  canHover: boolean;
  /** 第一格畫完 */
  onReady: () => void;
  /** WebGL context 掉了（交給外層改顯示海報） */
  onLost: () => void;
}

/** 晨夜切換的時間（--dur-eclipse） */
const BLEND_SECONDS = 1.25;
/** 進度到了終點交接才走完（三欄排好、房間溶成頁面底色），畫面不再變，可以停 loop（--handoff 已經寫成 1 之後） */
const PARK_AT = HANDOFF_END;
/** 場景平滑後的進度至少走到最後一章，才把交接寫進 --handoff（從遠處一路跳過來時不寫，觀測台保持原樣） */
const HANDOFF_NEAR = CHAPTERS[CHAPTERS.length - 1].start;

/**
 * 每一格更新 --handoff（觀測台頂端的餘光與第一組面板跟著場景的交接走）：
 * - 場景（平滑後）與捲動都還沒到交接：拿掉。場景離最後一章還很遠（從首屏直接跳到觀測台）：也拿掉。
 * - 其他時候寫場景這一格的 h。但捲動已經到底（raw ≥ 1，觀測台可能已經在畫面上）時只往上寫，
 *   觀測台絕對不會在看得到的時候變得更透明。
 */
function syncHandoff(smoothed: number, raw: number) {
  if ((raw < HANDOFF_START && smoothed < HANDOFF_START) || smoothed < HANDOFF_NEAR) {
    // 每一格都會走到這裡：沒寫過就不碰 DOM
    if (writtenHandoff() !== null) clearHandoff();
    return;
  }
  const h = handoffValue(smoothed);
  if (raw >= HANDOFF_END && h < currentHandoff()) return;
  writeHandoff(h);
}

/** 驗證用：?beaconProbe=1 時在 window 上放一個讀取三塊畫面實際位置的函式（一般瀏覽不會有） */
function probeEnabled(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('beaconProbe') === '1';
}

const GL_OPTIONS = { antialias: true, powerPreference: 'high-performance' as const, alpha: false, stencil: false };
const CAMERA_OPTIONS = { fov: 45, near: 0.5, far: 40000 };
// 陰影只在需要時更新（autoUpdate false，由場景標記 needsUpdate）
const SHADOWS = { enabled: true, type: THREE.PCFShadowMap, autoUpdate: false };

/**
 * 海報擷取用：?beaconPoster=1&p=0.3&t=12 會把進度與時間固定住、關掉鏡頭微晃，
 * 不畫任何資料，畫好後設 window.__beaconPosterReady。一般瀏覽不會帶這個參數。
 */
function readPosterParams(): { p: number; t: number } | null {
  if (typeof window === 'undefined') return null;
  const q = new URLSearchParams(window.location.search);
  if (q.get('beaconPoster') !== '1') return null;
  const p = Number(q.get('p'));
  const t = Number(q.get('t'));
  return { p: Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0, t: Number.isFinite(t) ? t : 12 };
}

interface WorldProps {
  progress: MotionValue<number>;
  low: boolean;
  canHover: boolean;
  data: ScreenData;
  handoff: MeasuredTerminal | null;
  poster: { p: number; t: number } | null;
  /** loop 是不是在跑（false 時外層已經拿掉 --handoff，這裡不能再寫回去） */
  activeRef: React.RefObject<boolean>;
  onReady: () => void;
  onPark: (parked: boolean) => void;
  onLost: () => void;
}

function World({ progress, low, canHover, data, handoff, poster, activeRef, onReady, onPark, onLost }: WorldProps) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const dpr = useThree((s) => s.viewport.dpr);
  const isDark = useHtmlDarkClass();
  const [world, setWorld] = useState<BeaconWorld | null>(null);
  const worldRef = useRef<BeaconWorld | null>(null);
  const state = useRef({
    p: 0,
    first: true,
    frames: 0,
    dawn: isDark ? 0 : 1,
    lastDark: isDark,
    blending: false,
    parked: false,
    fonts: false,
    mx: 0,
    my: 0,
    smx: 0,
    smy: 0,
    ready: false,
  });
  // 停下來的 loop 要重新跑（捲回來、主題或資料變了）
  const wake = useCallback(() => {
    if (state.current.parked) {
      state.current.parked = false;
      onPark(false);
    }
  }, [onPark]);

  // 建場景（StrictMode 開發模式會建兩次，第一次會被完整釋放）
  useEffect(() => {
    const w = createBeacon(gl, camera, { low });
    const s = state.current;
    w.applyLook(s.dawn);
    w.settleLook();
    worldRef.current = w;
    setWorld(w);
    const probeHost = window as Window & { __beaconProbe?: () => FaceProbe };
    if (probeEnabled()) probeHost.__beaconProbe = () => w.probe();
    return () => {
      if (probeHost.__beaconProbe) delete probeHost.__beaconProbe;
      worldRef.current = null;
      setWorld(null);
      w.dispose();
    };
  }, [gl, camera, low]);

  // 尺寸變了：調整 render target 與構圖
  useEffect(() => {
    world?.resize(width, height);
  }, [world, width, height, dpr]);

  // 量到的觀測台三欄變了（資料載入、說明列出現、換版面）：交接終點跟著對齊
  useEffect(() => {
    if (!world) return;
    world.setHandoff(handoff);
    wake();
  }, [world, handoff, wake]);

  // 螢幕內容：資料或主題變了就重畫；字型載完再畫一次
  useEffect(() => {
    if (!world) return;
    let cancelled = false;
    world.setScreens(data, isDark);
    wake();
    loadScreenFonts().then(() => {
      if (cancelled) return;
      world.setScreens(data, isDark);
      state.current.fonts = true;
      wake();
    });
    return () => {
      cancelled = true;
    };
  }, [world, data, isDark, wake]);

  // 主題切換：從目前的混合值往目標走 1.25 秒（第一次掛載時已直接套用，不必混合）
  useEffect(() => {
    if (state.current.lastDark === isDark) return;
    state.current.lastDark = isDark;
    state.current.blending = true;
    wake();
  }, [isDark, wake]);

  // 捲回終點前：叫醒停下來的 loop
  useEffect(
    () =>
      progress.on('change', (v) => {
        if (v < PARK_AT) wake();
      }),
    [progress, wake],
  );

  // WebGL context 掉了
  useEffect(() => {
    const el = gl.domElement;
    const lost = () => onLost();
    el.addEventListener('webglcontextlost', lost);
    return () => el.removeEventListener('webglcontextlost', lost);
  }, [gl, onLost]);

  // 滑鼠視差（只有 hover 裝置）
  useEffect(() => {
    if (!canHover || poster) return;
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      state.current.mx = (e.clientX / window.innerWidth) * 2 - 1;
      state.current.my = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => window.removeEventListener('pointermove', move);
  }, [canHover, poster]);

  useFrame((frameState, delta) => {
    const w = worldRef.current;
    if (!w) return;
    const s = state.current;
    // 慢的裝置（或軟體算圖）一格可能超過 50ms：上限放寬到 0.2 秒，捲動的平滑與晨夜混合才不會拖成好幾倍的時間
    const dt = Math.min(0.2, delta);
    // 捲動進度：原型的指數平滑
    const target = poster ? poster.p : progress.get();
    if (s.first) {
      s.p = target;
      s.first = false;
    } else {
      s.p += (target - s.p) * (1 - Math.exp(-dt * 3.2));
      if (Math.abs(target - s.p) < 1e-4) s.p = target;
    }
    // 晨夜混合
    const dawnTarget = isDark ? 0 : 1;
    if (s.blending) {
      const step = dt / BLEND_SECONDS;
      s.dawn = dawnTarget > s.dawn ? Math.min(dawnTarget, s.dawn + step) : Math.max(dawnTarget, s.dawn - step);
      const eased = s.dawn * s.dawn * (3 - 2 * s.dawn);
      w.applyLook(eased);
      if (s.dawn === dawnTarget) {
        s.blending = false;
        w.settleLook();
      }
    }
    // 視差
    const k = 1 - Math.exp(-dt * 3);
    s.smx += (s.mx - s.smx) * k;
    s.smy += (s.my - s.smy) * k;
    const time = poster ? poster.t : frameState.clock.elapsedTime;
    w.render({ time, dt, p: s.p, mx: poster ? 0 : s.smx, my: poster ? 0 : s.smy, sway: !poster });
    s.frames++;
    // 交接：觀測台跟著這一格的 h 走（海報擷取不碰 --handoff）
    if (!poster && activeRef.current) syncHandoff(s.p, target);
    if (!s.ready && s.frames >= 2) {
      s.ready = true;
      onReady();
    }
    if (poster && s.fonts && s.frames >= 6) (window as Window & { __beaconPosterReady?: boolean }).__beaconPosterReady = true;
    // 走到終點且畫面不再變：停下 render loop，等捲回來或主題、資料變了再叫醒。--handoff 一定先寫成 1 才停
    if (!poster && !s.parked && !s.blending && target >= PARK_AT && s.p === target && s.frames > 4 && writtenHandoff() === 1) {
      s.parked = true;
      onPark(true);
    }
  }, 1);

  return null;
}

export function BeaconScene({
  progress,
  running,
  mobile,
  canHover,
  stockCount,
  industryCount,
  board,
  monitor,
  industry,
  watch,
  spark,
  handoff,
  onReady,
  onLost,
}: BeaconSceneProps) {
  const [poster] = useState(readPosterParams);
  // 低階設定只在建立時決定（跨過斷點不重建整個場景）
  const [low] = useState(() => mobile);
  const [parked, setParked] = useState(false);
  const [dpr] = useState(() => Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, mobile ? 1.25 : 1.5, 2));
  const data = useMemo<ScreenData>(
    () =>
      poster
        ? { board: null, monitor: null, industry: null, stockCount: null, industryCount: null, watch: null, spark: null, idle: true }
        : { board, monitor, industry, stockCount, industryCount, watch, spark, idle: false },
    [poster, board, monitor, industry, stockCount, industryCount, watch, spark],
  );
  const frameloop = running && !parked ? 'always' : 'never';

  // 捲出畫面、分頁隱藏就拿掉 --handoff：場景沒在跑的時候，觀測台一定是平常的樣子。
  // 停在終點時 --handoff 已經是 1（觀測台本來就是平常的樣子），留著：捲回來時舞台從透明淡回來，不會先閃一下場景
  const activeRef = useRef(running);
  useEffect(() => {
    activeRef.current = running;
    if (!running) clearHandoff();
  }, [running]);

  // R3F 卸載時只會 forceContextLoss，不會 dispose renderer：等它收完（500ms）再釋放；--handoff 也一起拿掉
  const glRef = useRef<THREE.WebGLRenderer | null>(null);
  useEffect(
    () => () => {
      activeRef.current = false;
      clearHandoff();
      const gl = glRef.current;
      glRef.current = null;
      if (gl) window.setTimeout(() => gl.dispose(), 600);
    },
    [],
  );

  return (
    <Canvas
      onCreated={(state) => {
        glRef.current = state.gl;
      }}
      aria-hidden
      dpr={dpr}
      frameloop={frameloop}
      gl={GL_OPTIONS}
      camera={CAMERA_OPTIONS}
      shadows={SHADOWS}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      <World
        progress={progress}
        low={low}
        canHover={canHover}
        data={data}
        handoff={poster ? null : handoff}
        poster={poster}
        activeRef={activeRef}
        onReady={onReady}
        onPark={setParked}
        onLost={onLost}
      />
    </Canvas>
  );
}
