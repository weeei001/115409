const PARSE_BASE = 'http://return-url.local';

/**
 * 只接受站內路徑，回傳 `pathname+search+hash`；其餘回 null。
 * 控制字元與 `\` 一律拒絕：瀏覽器解析 URL 時會刪掉 tab／換行、把 `\` 當 `/`，
 * `/\t/evil.example` 會變成 `//evil.example` 導到外站（上線前稽核 A1，決議 D13）。
 * 解析時會吃掉點區段（`/..//evil.example`、`/%2e%2e//evil.example` 的 pathname 是 `//evil.example`），
 * 所以組好結果後再檢查一次：不能是 `//` 開頭，用同一個 base 再解析也要留在站內（02-F2）。
 */
export function safeReturnUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/') || /[\u0000-\u001F\u007F\\]/.test(trimmed)) return null;
  try {
    const url = new URL(trimmed, PARSE_BASE);
    if (url.origin !== PARSE_BASE) return null;
    const out = `${url.pathname}${url.search}${url.hash}`;
    if (out.startsWith('//') || new URL(out, PARSE_BASE).origin !== PARSE_BASE) return null;
    return out;
  } catch {
    return null;
  }
}
