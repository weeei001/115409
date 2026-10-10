import apiClient from './client';
import type { AIFeedbackSummary, AITrackRecordResponse, AIUsageSummary, MessageFeedback } from '../types/api';

/** openapi: GET /analyze/stock-behavior/track-record（省略 symbol 為全站統計） */
export async function fetchAITrackRecord(symbol?: string, signal?: AbortSignal): Promise<AITrackRecordResponse> {
  const params = symbol ? { symbol } : {};
  return (await apiClient.get<AITrackRecordResponse>('/analyze/stock-behavior/track-record', { params, signal })).data;
}

/** openapi: PUT（評分）／DELETE（取消評分）/api/conversations/{conversation_id}/messages/{message_id}/feedback */
export async function rateChatMessage(conversationId: string, messageId: string, rating: 'up' | 'down' | null): Promise<MessageFeedback> {
  const path = `/api/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/feedback`;
  const response = rating
    ? await apiClient.put<MessageFeedback>(path, { rating })
    : await apiClient.delete<MessageFeedback>(path);
  return response.data;
}

/** openapi: GET /admin/ai-feedback */
export async function fetchAIFeedbackSummary(signal?: AbortSignal): Promise<AIFeedbackSummary> {
  return (await apiClient.get<AIFeedbackSummary>('/admin/ai-feedback', { signal })).data;
}

/** openapi: GET /admin/ai-usage */
export async function fetchAIUsageSummary(signal?: AbortSignal): Promise<AIUsageSummary> {
  return (await apiClient.get<AIUsageSummary>('/admin/ai-usage', { signal })).data;
}
