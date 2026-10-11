/**
 * 首頁旅程的版面：3D 場景，或只有首屏海報。
 * 一律跑 3D（減少動態、低功耗裝置也是，決議 N1-1）；只有不支援 WebGL2、或場景出錯時，才只留首屏海報、直接接觀測台。
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
