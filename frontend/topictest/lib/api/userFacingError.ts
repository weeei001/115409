import { API_BASE } from '../apiBase';
import { ApiRequestError } from './client';
import { AI_TIMEOUT_MS } from './stockBehaviorTextBrief';

function apiBaseLabel(): string {
  return API_BASE;
}

/** 個股 AI 分析：將 API／網路錯誤轉成繁中說明 */
export function formatAdvisorError(err: unknown): string {
  const base = apiBaseLabel();

  if (err instanceof ApiRequestError) {
    if (err.status === 404 || /not\s*found/i.test(err.message)) {
      return `AI 分析服務目前無法使用（HTTP 404）。請確認後端已啟動且 OpenAPI 含 /analyze/stock-behavior 端點。（目前連線：${base}）`;
    }
    if (err.status === 401 || err.status === 403) {
      return '請先登入後再使用 AI 投資分析。';
    }
    if (err.status === 503) {
      return `AI 服務暫時無法回應（HTTP 503），請稍後按「重新分析」再試一次。（目前連線：${base}）`;
    }
    if (err.status === 504) {
      return `後端 AI 分析逾時（HTTP 504）。此為伺服器端限制，請請後端管理者調高處理逾時或檢查 LLM 服務。（目前連線：${base}）`;
    }
    if (!err.status) {
      if (err.message.includes('逾時')) {
        return (
          `AI 分析逾時（前端已等待約 ${Math.round(AI_TIMEOUT_MS / 1000)} 秒）。` +
          `撰寫那一段實測約 90 秒，偶發更久。請稍後按「重新分析」，或請後端檢查 LLM／資料庫效能。（目前連線：${base}）`
        );
      }
      return `${err.message}（目前連線：${base}）`;
    }
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return '取得 AI 分析結果失敗，請稍後再試。';
}
