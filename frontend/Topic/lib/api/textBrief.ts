import apiClient, { API_DEFAULT_TIMEOUT_MS } from './client';
import type { TextBriefRequest, TextBriefResponse } from '../types/textBrief';

/**
 * openapi: POST /analyze/stock-behavior/text-brief
 * With cache_only, read the latest eligible saved response through the cutoff without generating analysis.
 * 前端一律只讀排程預先產生的分析（cache_only），不會等模型撰寫，所以用一般請求的逾時：
 * 後端卡住時 30 秒內就顯示錯誤與重試，不會讓摘要卡一直停在「載入中」。
 */
export async function postStockBehaviorTextBrief(body: TextBriefRequest): Promise<TextBriefResponse> {
  const { data } = await apiClient.post<TextBriefResponse>('/analyze/stock-behavior/text-brief', body, {
    timeout: API_DEFAULT_TIMEOUT_MS,
  });
  return data;
}
