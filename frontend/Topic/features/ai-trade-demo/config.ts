/**
 * Demo 後端網址。刻意不用主系統的 NEXT_PUBLIC_API_URL 與 axios client。
 * Next 只會在建置時替換寫死全名的 process.env.NEXT_PUBLIC_*，所以不能用動態 key 讀。
 */
const RAW_API_URL = process.env.NEXT_PUBLIC_AI_TRADE_DEMO_API_URL;

/** 沒設定時回傳 null，由畫面顯示「Demo 未設定 API 網址」 */
export function getDemoApiBase(): string | null {
  const url = RAW_API_URL?.trim().replace(/\/+$/, '');
  return url ? url : null;
}
