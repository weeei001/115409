/**
 * 首頁旅程的版面：3D 場景，或只有首屏海報。
 * 第一次訪問跑 3D（減少動態、低功耗裝置也是）；看過一次、不支援 WebGL2、或場景出錯時，只留首屏海報、直接接觀測台。
 */

export type JourneyMode = 'scene' | 'poster';

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

const SEEN_KEY = 'beacon-journey-seen';
type SeenStorage = Pick<Storage, 'getItem' | 'setItem'>;

function localStore(): SeenStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** 3D 旅程只在第一次訪問時播：場景畫出來過一次，之後回首頁就只留首屏海報、直接接觀測台 */
export function journeySeen(storage: SeenStorage | null = localStore()): boolean {
  try {
    return storage?.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markJourneySeen(storage: SeenStorage | null = localStore()): void {
  try {
    storage?.setItem(SEEN_KEY, '1');
  } catch {
    // 無痕模式等存不了：下次照樣播
  }
}
