import { ApiRequestError } from './client';

/** 個股 AI 分析：把 API／網路錯誤轉成給使用者看的繁中說明，不含技術細節（決議 D13） */
export function formatAdvisorError(err: unknown): string {
  if (err instanceof ApiRequestError) {
    if (err.status === 404) return 'AI 分析暫時無法取得，請稍後再試。';
    if (err.status === 401 || err.status === 403) return '請先登入後再使用 AI 投資分析。';
    if (err.status === 503) return 'AI 服務暫時無法回應，請稍後重新整理頁面再試一次。';
    if (err.status === 504 || (!err.status && err.message.includes('逾時'))) {
      return 'AI 分析處理時間較長，請稍後重新整理頁面再試一次。';
    }
    if (!err.status) return '目前無法連線到 AI 分析服務，請稍後再試。';
    return err.message;
  }
  return '取得 AI 分析結果失敗，請稍後再試。';
}
