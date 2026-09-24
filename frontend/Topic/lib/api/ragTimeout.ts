/**
 * AI 對話請求逾時（毫秒）。檢索較慢時可以調長，但上游 Nginx／CDN 的逾時也要一起調高，
 * 否則會先被閘道斷線（常見 504）。NEXT_PUBLIC_ 變數在瀏覽器與 Node 都讀得到。
 */
const DEFAULT_MS = 120_000;

function parseTimeoutMs(raw: string | undefined): number {
  if (!raw?.trim()) return DEFAULT_MS;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n >= 10_000 ? n : DEFAULT_MS;
}

export function getRagApiTimeoutMs(): number {
  return parseTimeoutMs(process.env.NEXT_PUBLIC_RAG_API_TIMEOUT_MS);
}
