import apiClient from './client';
import type { TextBriefRequest, TextBriefResponse } from '../types/textBrief';

/** 後端 LLM 撰寫實測約 90 秒，偶發超過 5 分鐘 */
export const AI_TIMEOUT_MS = 600_000;

/**
 * openapi: POST /analyze/stock-behavior/text-brief
 * 後端依 symbol／as_of_date／設定做快取（`cached=true`），同一天第二次進頁面通常是秒回。
 */
export async function postStockBehaviorTextBrief(body: TextBriefRequest): Promise<TextBriefResponse> {
  const { data } = await apiClient.post<TextBriefResponse>('/analyze/stock-behavior/text-brief', body, {
    timeout: AI_TIMEOUT_MS,
  });
  return data;
}
