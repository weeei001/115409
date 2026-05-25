import apiClient, { ApiRequestError } from './client';
import type {
  StockBehaviorAiRequest,
  StockBehaviorAiResponse,
  StockBehaviorRagRequest,
  StockBehaviorRagResponse,
} from '../types/stockBehavior';

/** 與後端 RAG／LLM 處理時間對齊；實測 ai 常需 90～120 秒，偶發超過 5 分鐘 */
export const RAG_TIMEOUT_MS = 180_000;
export const AI_TIMEOUT_MS = 600_000;

/** openapi: POST /analyze/stock-behavior/rag */
export async function postStockBehaviorRag(
  body: StockBehaviorRagRequest
): Promise<StockBehaviorRagResponse> {
  const { data } = await apiClient.post<StockBehaviorRagResponse>(
    '/analyze/stock-behavior/rag',
    body,
    { timeout: RAG_TIMEOUT_MS }
  );
  return data;
}

/** openapi: POST /analyze/stock-behavior/ai */
export async function postStockBehaviorAi(body: StockBehaviorAiRequest): Promise<StockBehaviorAiResponse> {
  const { data } = await apiClient.post<StockBehaviorAiResponse>(
    '/analyze/stock-behavior/ai',
    body,
    { timeout: AI_TIMEOUT_MS }
  );
  return data;
}

/** AI 偶發逾時時重試一次（RAG 結果已快取於呼叫端） */
export async function postStockBehaviorAiWithRetry(
  body: StockBehaviorAiRequest
): Promise<StockBehaviorAiResponse> {
  try {
    return await postStockBehaviorAi(body);
  } catch (err) {
    const isTimeout =
      err instanceof ApiRequestError &&
      !err.status &&
      err.message.includes('逾時');
    if (!isTimeout) throw err;
    return await postStockBehaviorAi(body);
  }
}
