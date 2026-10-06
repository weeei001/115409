import apiClient from './client';
import { isChatAction } from '../nav';
import { parseChatSources, type ChatMessage } from '../types/chat';
import { parseChatDashboard } from '../types/chatDashboard';

export interface ConversationSummary {
  id: string;
  title: string;
  updated_at: string;
}
export interface Conversation extends ConversationSummary { messages: ChatMessage[] }
export interface ConversationPage { items: ConversationSummary[]; has_more: boolean }

export async function listConversations(q: string, offset = 0, signal?: AbortSignal): Promise<ConversationPage> {
  return (await apiClient.get('/api/conversations', { params: { q, offset, limit: 30 }, signal })).data;
}
export async function createConversation(signal?: AbortSignal): Promise<Conversation> {
  return (await apiClient.post('/api/conversations', {}, { signal })).data;
}
const MESSAGE_STATUSES = new Set(['streaming', 'completed', 'failed', 'interrupted']);
const optionalText = (value: unknown) => (typeof value === 'string' ? value : null);

/**
 * 歷史訊息（openapi: SavedMessage）和串流回覆用同一套驗證：資料面板、來源、動作都過濾過才交給畫面。
 * 格式不完整的舊紀錄只會少掉那個區塊，不會讓整個 /ai 頁崩潰。角色或內文不合格的訊息直接略過。
 */
export function parseSavedMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index): ChatMessage[] => {
    if (!item || typeof item !== 'object') return [];
    const message = item as Record<string, unknown>;
    if ((message.role !== 'user' && message.role !== 'assistant') || typeof message.content !== 'string') return [];
    return [{
      id: typeof message.id === 'string' && message.id ? message.id : `saved-${index}`,
      role: message.role,
      content: message.content,
      timestamp: optionalText(message.timestamp) ?? '',
      status: typeof message.status === 'string' && MESSAGE_STATUSES.has(message.status) ? message.status as ChatMessage['status'] : null,
      error: optionalText(message.error),
      actions: Array.isArray(message.actions) ? message.actions.filter(isChatAction) : [],
      dashboard: parseChatDashboard(message.dashboard) ?? null,
      sources: parseChatSources(message.sources),
    }];
  });
}

export async function getConversation(id: string, signal?: AbortSignal): Promise<Conversation> {
  const data = (await apiClient.get(`/api/conversations/${encodeURIComponent(id)}`, { signal })).data;
  return { ...data, messages: parseSavedMessages(data?.messages) };
}
