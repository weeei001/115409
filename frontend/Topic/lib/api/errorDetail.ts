/**
 * 錯誤訊息只給一般使用者看：不出現 HTTP 代碼、網址、CORS 這類技術字眼（決議 D13）。
 * 後端回的中文 `detail` 原樣保留（例如「找不到股票 9999 的價格數據」）；
 * 英文或結構化的內容（FastAPI 預設訊息、422 驗證錯誤）改用依狀態碼的通用文案。
 */

const CJK = /[㐀-鿿]/;

/** 含中文才視為可以直接給使用者看的訊息 */
export function isUserReadable(message: string | null | undefined): message is string {
  return typeof message === 'string' && CJK.test(message);
}

export function genericMessageForStatus(status: number): string {
  if (status === 400 || status === 422) return '輸入的資料格式不正確，請檢查後再試。';
  if (status === 401) return '身分驗證失敗，請確認帳號密碼或重新登入。';
  if (status === 403) return '沒有權限執行這個動作，請先登入。';
  if (status === 404) return '找不到相關資料。';
  if (status === 409) return '資料與現有紀錄衝突，請確認後再試。';
  if (status === 429) return '請求太頻繁，請稍後再試。';
  if (status >= 500) return '伺服器暫時無法處理，請稍後再試。';
  return '請求失敗，請稍後再試。';
}

/** 從 FastAPI `{ detail: ... }` 取出給使用者看的訊息；axios client 與 AI 對話共用 */
export function pickDetailMessage(data: unknown, status: number): string {
  const d = data && typeof data === 'object' ? (data as { detail?: unknown }).detail : undefined;
  let message: unknown = d;
  if (Array.isArray(d) && d[0] && typeof d[0] === 'object' && 'msg' in d[0]) message = (d[0] as { msg: unknown }).msg;
  else if (d && typeof d === 'object' && 'msg' in d) message = (d as { msg: unknown }).msg;
  return typeof message === 'string' && isUserReadable(message) ? message : genericMessageForStatus(status);
}

/** 畫面上顯示錯誤：可讀的中文訊息原樣顯示，其餘用 fallback */
export function userFacingMessage(err: unknown, fallback: string): string {
  return err instanceof Error && isUserReadable(err.message) ? err.message : fallback;
}
