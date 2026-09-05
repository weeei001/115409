import apiClient from './client';
import type { TextBriefRequest, TextBriefResponse } from '../types/textBrief';

/** 後端 LLM 撰寫實測約 90 秒，偶發超過 5 分鐘；與 Next 代理的 maxDuration 對齊 */
export const AI_TIMEOUT_MS = 600_000;

/**
 * openapi: POST /analyze/stock-behavior/text-brief
 *
 * 後端會依 symbol／as_of_date／設定做快取（`cached=true`），所以同一天第二次進頁面通常是秒回；
 * 真的要重跑才帶 `force_refresh`。
 */
export async function postStockBehaviorTextBrief(
  body: TextBriefRequest
): Promise<TextBriefResponse> {
  const { data } = await apiClient.post<TextBriefResponse>(
    '/analyze/stock-behavior/text-brief',
    body,
    { timeout: AI_TIMEOUT_MS }
  );
  return data;
}

