import apiClient from './client';
import type { TextBriefRequest, TextBriefResponse } from '../types/textBrief';

/** 後端 LLM 撰寫實測約 90 秒，偶發超過 5 分鐘 */
export const AI_TIMEOUT_MS = 600_000;

/**
 * openapi: POST /analyze/stock-behavior/text-brief
 * With cache_only, read the latest eligible saved response through the cutoff without generating analysis.
 */
export async function postStockBehaviorTextBrief(body: TextBriefRequest): Promise<TextBriefResponse> {
  const { data } = await apiClient.post<TextBriefResponse>('/analyze/stock-behavior/text-brief', body, {
    timeout: AI_TIMEOUT_MS,
  });
  return data;
}
