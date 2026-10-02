import type { ChatDashboard } from './chatDashboard';
import { safeHttpUrl } from '../utils/url';

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
  article_id?: string | null;
  category?: string;
  url?: string;
}

export function parseChatSources(value: unknown): ChatSource[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || typeof item.citation_id !== 'string'
      || !/^S[1-9][0-9]*$/.test(item.citation_id) || seen.has(item.citation_id)
      || !['title', 'content', 'pub_time', 'stock_id'].every((key) => typeof item[key] === 'string')) return [];
    seen.add(item.citation_id);
    const { citation_id, title, content, pub_time, stock_id } = item;
    const source: ChatSource = { citation_id, title, content, pub_time, stock_id };
    if (item.article_id === null || (typeof item.article_id === 'string' && item.article_id.length <= 64)) source.article_id = item.article_id;
    if (typeof item.category === 'string') source.category = item.category;
    const url = typeof item.url === 'string' ? safeHttpUrl(item.url) : null;
    if (url) source.url = url;
    return [source];
  });
}

export type ChatMessageStatus = 'streaming' | 'completed' | 'failed' | 'interrupted';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  status?: ChatMessageStatus | null;
  error?: string | null;
  /** 串流中後端 `type: "status"` 的狀態文字 */
  streamStatus?: string;
  actions?: ChatAction[];
  dashboard?: ChatDashboard | null;
  sources?: ChatSource[];
}
