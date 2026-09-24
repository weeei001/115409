import type { ChatDashboard } from './chatDashboard';

/** AI 對話回覆附帶的動作（openapi: ChatAction／ChatFollowUp） */
export type ChatAction =
  | { type: 'navigate'; label: string; path: string }
  | { type: 'follow_up'; label: string; query: string };

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  /** 串流中後端 `type: "status"` 的狀態文字 */
  streamStatus?: string;
  actions?: ChatAction[];
  dashboard?: ChatDashboard;
}
