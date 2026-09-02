/**
 * 主後端 API 基底：正式與 dev 都是同源 proxy 路徑 /api/backend（見 .env.*），
 * 只有完全沒設環境變數時才退回本機 8000。
 */
export const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(
  /\/+$/,
  '',
);
