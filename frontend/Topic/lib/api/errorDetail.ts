/**
 * 錯誤訊息只給一般使用者看：不出現 HTTP 代碼、網址、CORS 這類技術字眼（決議 D13）。
 * 後端回的中文 `detail` 原樣保留（例如「找不到股票 9999 的價格資料」）；
 * 英文、無法辨識或夾帶技術內容的訊息（FastAPI 預設訊息、422 驗證錯誤、英文欄位名）改用依狀態碼的通用文案。
 */

const CJK = /[㐀-鿿]/;
/**
 * 轉碼壞掉的亂碼：取代字元 U+FFFD、私用區字元，或半形「?」緊貼中文（正常文案用全形「？」）。
 * 例：後端曾回「?曆??唳?摰??啗???」，裡面剛好有中文字，不能只靠 CJK 判斷。
 */
const GARBLED = /[\uFFFD\uE000-\uF8FF]|\?[㐀-鿿]|[㐀-鿿]\?/;

/**
 * 夾在中文裡的技術內容（05-D1、02-F3）：
 * snake_case 欄位名（start_time）、網址、traceback、SQL、資料庫驅動、例外類別名稱、
 * Python list／dict 的 repr（「支援：['2330', …]」），以及連續三個以上的英文字（例外訊息，例如 `invalid literal for int()`）。
 */
const TECHNICAL = [
  /\b[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+\b/,
  /:\/\//,
  /traceback|file "|\bselect\s|psycopg|sqlalchemy/i,
  /\b[A-Z]\w*(?:Error|Exception)\b/,
  /[[{]\s*['"]/,
  /[A-Za-z]{2,}(?:[ ,]+[A-Za-z]{2,}){2,}/,
];

/** 含中文、不是亂碼、也沒有夾帶技術內容，才視為可以直接給使用者看的訊息 */
export function isUserReadable(message: string | null | undefined): message is string {
  return typeof message === 'string' && CJK.test(message) && !GARBLED.test(message)
    && !TECHNICAL.some((pattern) => pattern.test(message));
}

/** 沒收到回應的訊息；「逾時」兩字 formatAdvisorError 會用來判斷 */
export const TIMEOUT_MESSAGE = '連線逾時，請稍後再試。';
export const NETWORK_ERROR_MESSAGE = '目前無法連線到伺服器，請稍後再試。';

/** 有日期區間可調的圖表（個股詳細 K 線、多股比較）：逾時時多給一個下一步 */
export function withDateRangeHint(message: string): string {
  return message === TIMEOUT_MESSAGE ? '連線逾時，請縮短日期區間或稍後再試。' : message;
}

export function genericMessageForStatus(status: number): string {
  if (status === 400 || status === 422) return '輸入的資料格式不正確，請檢查後再試。';
  if (status === 401) return '登入已過期，請重新登入。';
  if (status === 403) return '這個帳號沒有權限使用此功能。';
  if (status === 404) return '找不到相關資料。';
  if (status === 409) return '這筆資料已經存在，請確認後再試。';
  if (status === 429) return '操作太頻繁，請稍等一下再試。';
  if (status >= 500) return '伺服器暫時無法處理，請稍後再試。';
  return '暫時無法完成，請稍後再試。';
}

/** 從 FastAPI `{ detail: ... }` 取出給使用者看的訊息；axios client 與 AI 對話共用 */
export function pickDetailMessage(data: unknown, status: number): string {
  const d = data && typeof data === 'object' ? (data as { detail?: unknown }).detail : undefined;
  let message: unknown = d;
  if (Array.isArray(d) && d[0] && typeof d[0] === 'object' && 'msg' in d[0]) message = (d[0] as { msg: unknown }).msg;
  else if (d && typeof d === 'object' && 'msg' in d) message = (d as { msg: unknown }).msg;
  else if (d && typeof d === 'object' && 'message' in d) message = (d as { message: unknown }).message;
  return typeof message === 'string' && isUserReadable(message) ? message : genericMessageForStatus(status);
}

/** 畫面上顯示錯誤：可讀的中文訊息原樣顯示，其餘用 fallback */
export function userFacingMessage(err: unknown, fallback: string): string {
  return err instanceof Error && isUserReadable(err.message) ? err.message : fallback;
}
