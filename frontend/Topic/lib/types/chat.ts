import type { ChatDashboard } from './chatDashboard';

/** AI 對話回覆附帶的動作（openapi: ChatAction／ChatFollowUp） */
export type ChatAction =
  | { type: 'navigate'; label: string; path: string }
  | { type: 'follow_up'; label: string; query: string };

export interface ChatSource {
  citation_id: string;
  title: string;
  content: string;
  pub_time: string;
  stock_id: string;
}

export function parseChatSources(value: unknown): ChatSource[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ChatSource => item !== null && typeof item === 'object'
    && /^S[1-9][0-9]*$/.test(item.citation_id)
    && ['title', 'content', 'pub_time', 'stock_id'].every((key) => typeof item[key] === 'string'))
    .map(({ citation_id, title, content, pub_time, stock_id }) => ({ citation_id, title, content, pub_time, stock_id }));
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  /** 串流中後端 `type: "status"` 的狀態文字 */
  streamStatus?: string;
  actions?: ChatAction[];
  dashboard?: ChatDashboard;
  sources?: ChatSource[];
}
