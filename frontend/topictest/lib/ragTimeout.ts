/**
 * RAG 請求逾時（毫秒）：供 axios 與 RAG 串流請求共用。
 * 設長一點可配合「大庫檢索」較慢的回應；仍須一併調高上游 Nginx／CDN 逾時，否則會先被閘道斷線（常見 504）。
 */
const DEFAULT_MS = 120_000;

function parseTimeoutMs(raw: string | undefined): number {
  if (!raw?.trim()) return DEFAULT_MS;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n >= 10_000 ? n : DEFAULT_MS;
}

/** 瀏覽器與 Node API 皆可讀（NEXT_PUBLIC_ 在 Next 會注入兩端，故不需另一個伺服器端變數） */
export function getRagApiTimeoutMs(): number {
  return parseTimeoutMs(process.env.NEXT_PUBLIC_RAG_API_TIMEOUT_MS);
}
