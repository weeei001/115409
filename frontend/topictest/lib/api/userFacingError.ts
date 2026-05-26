import { ApiRequestError } from './client';
import { AI_TIMEOUT_MS, RAG_TIMEOUT_MS } from './stockBehaviorAnalyze';

function apiBaseLabel(): string {
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
}

export type AdvisorErrorPhase = 'rag' | 'ai';

/** 個股 AI 分析：將 API／網路錯誤轉成繁中說明 */
export function formatAdvisorError(
  err: unknown,
  options?: { phase?: AdvisorErrorPhase; ragCompleted?: boolean }
): string {
  const base = apiBaseLabel();
  const phase = options?.phase;
  const ragCompleted = options?.ragCompleted ?? false;

  if (err instanceof ApiRequestError) {
    if (err.status === 404 || /not\s*found/i.test(err.message)) {
      return `AI 分析服務目前無法使用（HTTP 404）。請確認後端已啟動且 OpenAPI 含 /analyze/stock-behavior 端點。（目前連線：${base}）`;
    }
    if (err.status === 401 || err.status === 403) {
      return '請先登入後再使用 AI 投資分析。';
    }
    if (err.status === 504) {
      return `後端 AI 分析逾時（HTTP 504）。此為伺服器端限制，請請後端管理者調高處理逾時或檢查 LLM 服務。（目前連線：${base}）`;
    }
    if (!err.status) {
      if (err.message.includes('逾時')) {
        if (phase === 'ai' || ragCompleted) {
          return (
            `第二步「AI 綜合分析」逾時（前端已等待約 ${Math.round(AI_TIMEOUT_MS / 1000)} 秒）。` +
            `新聞整理（RAG）通常幾秒內完成；瓶頸在後端 \`/analyze/stock-behavior/ai\`（實測常需 1.5～2 分鐘，偶發更久）。` +
            `下方若已有新聞來源，代表 RAG 成功、僅 AI 未完成。請稍後按「重新分析」，或請後端檢查 LLM／資料庫效能。（目前連線：${base}）`
          );
        }
        if (phase === 'rag') {
          return `${err.message}（RAG 最長約 ${Math.round(RAG_TIMEOUT_MS / 1000)} 秒；目前連線：${base}）`;
        }
      }
      return `${err.message}（目前連線：${base}）`;
    }
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return '取得 AI 分析結果失敗，請稍後再試。';
}
