/** 從常見 FastAPI／後端 `{ detail: ... }` 形狀抽出人類可讀訊息，供 axios client 與 RAG client 共用 */
export function pickDetailMessage(data: unknown, status: number): string {
  if (!data || typeof data !== 'object') {
    return status === 404 ? '找不到請求的資源（404）' : `API 錯誤 (${status})`;
  }
  if (!('detail' in data)) {
    return status === 404 ? '找不到請求的資源（404）' : `API 錯誤 (${status})`;
  }
  const d = (data as { detail?: unknown }).detail;
  if (d === undefined || d === null) {
    return status === 404 ? '找不到請求的資源（404）' : `API 錯誤 (${status})`;
  }
  if (typeof d === 'string') {
    if (status === 404 && /not\s*found/i.test(d)) return '找不到請求的資源（404）';
    return d;
  }
  if (Array.isArray(d) && d[0] && typeof d[0] === 'object' && d[0] !== null && 'msg' in d[0]) {
    return String((d[0] as { msg: unknown }).msg);
  }
  if (typeof d === 'object' && d !== null && 'msg' in d) {
    return String((d as { msg: unknown }).msg);
  }
  try {
    return JSON.stringify(d);
  } catch {
    return `API 錯誤 (${status})`;
  }
}
