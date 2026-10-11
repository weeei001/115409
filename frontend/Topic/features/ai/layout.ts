/** AI 對話工作台（lg 以上）的共用尺寸與版面偏好 */

/** 訊息與輸入框的閱讀欄：對話欄很寬時置中，一行約 46 個全形字 */
export const CHAT_COLUMN = 'max-w-[46rem]';

/** 資料欄占（對話欄＋資料欄）寬度的比例：拖曳分隔線或用方向鍵調整，記在這個瀏覽器 */
export const DATA_RATIO_KEY = 'tei:ai-data-ratio:v1';
export const DATA_RATIO_DEFAULT = 0.5;
/** 兩欄的最小寬度（px），和 ChatArea 格線樣式裡的 22rem、24rem 一致 */
export const DATA_MIN_PX = 352;
export const CHAT_MIN_PX = 384;

/** 歷史對話欄收合成細條：記在這個瀏覽器；沒有記錄時 1440 以上展開、以下收合 */
export const HISTORY_COLLAPSED_KEY = 'tei:ai-history-collapsed:v1';

/** 依目前寬度夾住比例：兩欄都不小於最小寬度；放不下兩欄時以資料欄的最小寬度為準 */
export function clampDataRatio(ratio: number, width: number): number {
  if (!Number.isFinite(ratio) || !(width > 0)) return DATA_RATIO_DEFAULT;
  const lo = Math.min(1, DATA_MIN_PX / width);
  const hi = Math.max(lo, 1 - CHAT_MIN_PX / width);
  return Math.min(hi, Math.max(lo, ratio));
}

export function parseDataRatio(raw: string): number | null {
  const value = Number(raw);
  return raw.trim() && Number.isFinite(value) && value > 0 && value < 1 ? value : null;
}
