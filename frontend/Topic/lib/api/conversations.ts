import apiClient from './client';
import type { ChatMessage } from '../types/chat';

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
export async function getConversation(id: string, signal?: AbortSignal): Promise<Conversation> {
  return (await apiClient.get(`/api/conversations/${encodeURIComponent(id)}`, { signal })).data;
}
