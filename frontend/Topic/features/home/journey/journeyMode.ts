/**
 * 首頁旅程要跑 3D 場景，還是改用靜態海報。
 * decideJourneyMode 是純函式（單元測試在 journeyMode.test.ts）；readJourneyEnv、probeWebGL2 才碰瀏覽器。
 */

export type JourneyMode = 'scene' | 'poster';
export type PosterReason = 'reduced-motion' | 'low-power' | 'no-webgl';

export interface JourneyEnv {
  reducedMotion: boolean;
  /** navigator.hardwareConcurrency；瀏覽器沒提供時是 undefined */
  hardwareConcurrency?: number;
  /** navigator.deviceMemory（GB，Chromium 才有） */
  deviceMemory?: number;
  /** navigator.connection.saveData */
  saveData?: boolean;
  userAgent?: string;
  /** 跑在 Capacitor 原生殼裡（window.Capacitor 存在且不是網頁平台） */
  capacitor?: boolean;
}

export interface JourneyDecision {
  mode: JourneyMode;
  reason: PosterReason | null;
}

/** 低功耗裝置：4 核以下、記憶體 4GB 以下、省流量模式、Android WebView 或 Capacitor 殼 */
export function isLowPower(env: JourneyEnv): boolean {
  if (typeof env.hardwareConcurrency === 'number' && env.hardwareConcurrency > 0 && env.hardwareConcurrency <= 4) return true;
  if (typeof env.deviceMemory === 'number' && env.deviceMemory > 0 && env.deviceMemory <= 4) return true;
  if (env.saveData) return true;
  if (env.capacitor) return true;
  if (env.userAgent && env.userAgent.includes('; wv)')) return true;
  return false;
}

/**
 * webgl：null 表示還沒測（首屏先不建 WebGL context，等閒置時再測），false 表示測過不能用。
 * 順序：減少動態 > 低功耗 > 沒有 WebGL。
 */
export function decideJourneyMode(env: JourneyEnv, webgl: boolean | null = null): JourneyDecision {
  if (env.reducedMotion) return { mode: 'poster', reason: 'reduced-motion' };
  if (isLowPower(env)) return { mode: 'poster', reason: 'low-power' };
  if (webgl === false) return { mode: 'poster', reason: 'no-webgl' };
  return { mode: 'scene', reason: null };
}

interface NavigatorExtras {
  deviceMemory?: number;
  connection?: { saveData?: boolean };
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
}

/** 從瀏覽器讀出判斷需要的值（只在 client 呼叫） */
export function readJourneyEnv(win: Window): JourneyEnv {
  const nav = win.navigator as Navigator & NavigatorExtras;
  const cap = (win as Window & { Capacitor?: CapacitorGlobal }).Capacitor;
  let capacitor = false;
  if (cap) {
    try {
      capacitor = typeof cap.isNativePlatform === 'function' ? cap.isNativePlatform() : true;
    } catch {
      capacitor = true;
    }
  }
  return {
    reducedMotion: win.matchMedia('(prefers-reduced-motion: reduce)').matches,
    hardwareConcurrency: nav.hardwareConcurrency,
    deviceMemory: nav.deviceMemory,
    saveData: nav.connection?.saveData === true,
    userAgent: nav.userAgent,
    capacitor,
  };
}

/** 建一個 WebGL2 context 試試看，測完立刻釋放；three 0.186 只支援 WebGL2 */
export function probeWebGL2(doc: Document): boolean {
  try {
    const canvas = doc.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}
