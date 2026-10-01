import { isChatAction } from '../nav';
import { parseChatSources, type ChatMessage, type ChatMessageStatus } from '../types/chat';
import { parseChatDashboard, type ChatDashboard } from '../types/chatDashboard';

export const CHAT_SESSION_KEY = 'stockbeacon-chat-session';
export const MAX_CHAT_SESSION_CHARS = 500_000;
const MAX_MESSAGES = 100;
const statuses: ChatMessageStatus[] = ['streaming', 'completed', 'failed', 'interrupted'];
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

function browserStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; }
}

/** Preserve dashboard data, but never serialize unknown fields from the API. */
function dashboardData(value: unknown): ChatDashboard | undefined {
  const dashboard = parseChatDashboard(value);
  if (!dashboard) return;
  return { title: dashboard.title, blocks: dashboard.blocks.map((block) => {
    const base = { title: block.title, description: block.description, source_ids: block.source_ids };
    switch (block.kind) {
      case 'metrics': return { ...base, kind: block.kind, items: block.items.map(({ label, value, unit, date }) => ({ label, value, unit, date })) };
      case 'chart': return { ...base, kind: block.kind, dates: block.dates, unit: block.unit, series: block.series.map(({ name, values }) => ({ name, values })) };
      case 'table': return { ...base, kind: block.kind, columns: block.columns, rows: block.rows };
      case 'news': return { ...base, kind: block.kind, items: block.items.map(({ title, publisher, published_at, url, source_id, article_id }) => ({ title, publisher, published_at, url, source_id, article_id })) };
    }
  }) };
}

function messageData(value: unknown, restoring: boolean): ChatMessage | null {
  if (!record(value) || typeof value.id !== 'string' || !value.id || value.id.length > 120
    || (value.role !== 'user' && value.role !== 'assistant') || typeof value.content !== 'string'
    || typeof value.timestamp !== 'string' || value.timestamp.length > 64 || Number.isNaN(Date.parse(value.timestamp))) return null;
  const message: ChatMessage = { id: value.id, role: value.role, content: value.content, timestamp: value.timestamp };
  if (message.role === 'assistant') {
    if (!statuses.includes(value.status as ChatMessageStatus)) return null;
    message.status = restoring && value.status === 'streaming' ? 'interrupted' : value.status as ChatMessageStatus;
    if (typeof value.error === 'string') message.error = value.error.slice(0, 2000);
    if (Array.isArray(value.actions)) message.actions = value.actions.filter(isChatAction).slice(0, 20)
      .map((action) => action.type === 'navigate' ? { type: action.type, label: action.label, path: action.path }
        : { type: action.type, label: action.label, query: action.query });
    const dashboard = dashboardData(value.dashboard);
    if (dashboard) message.dashboard = dashboard;
    if (Array.isArray(value.sources)) message.sources = parseChatSources(value.sources).slice(0, 120);
  }
  return message;
}

export function clearChatSession(storage: Storage | null = browserStorage()): void {
  try { storage?.removeItem(CHAT_SESSION_KEY); } catch { /* Storage may be disabled. */ }
}

export function loadChatSession(owner: string, storage: Storage | null = browserStorage()): { messages: ChatMessage[]; available: boolean } {
  if (!storage) return { messages: [], available: false };
  let raw: string | null;
  try { raw = storage.getItem(CHAT_SESSION_KEY); } catch { return { messages: [], available: false }; }
  try {
    if (!raw) return { messages: [], available: true };
    if (raw.length > MAX_CHAT_SESSION_CHARS) throw new Error('Oversize session');
    const data: unknown = JSON.parse(raw);
    if (!record(data) || data.version !== 1 || data.owner !== owner || !Array.isArray(data.messages) || data.messages.length > MAX_MESSAGES) throw new Error('Invalid session');
    const messages = data.messages.map((message) => messageData(message, true));
    if (messages.some((message) => !message) || new Set(messages.map((message) => message?.id)).size !== messages.length) throw new Error('Invalid messages');
    return { messages: messages as ChatMessage[], available: true };
  } catch {
    clearChatSession(storage);
    return { messages: [], available: true };
  }
}

/** Keep whole recent turns; an oversize newest turn disables this snapshot safely. */
export function saveChatSession(owner: string, input: ChatMessage[], storage: Storage | null = browserStorage()): { saved: boolean; trimmed: boolean } {
  if (!storage) return { saved: false, trimmed: false };
  if (!input.length) { clearChatSession(storage); return { saved: true, trimmed: false }; }
  const parsed = input.map((message) => messageData(message, false));
  if (parsed.some((message) => !message)) { clearChatSession(storage); return { saved: false, trimmed: false }; }
  const messages = parsed as ChatMessage[];
  let trimmed = false;
  let raw = '';
  while (messages.length) {
    raw = JSON.stringify({ version: 1, owner, messages });
    if (messages.length <= MAX_MESSAGES && raw.length <= MAX_CHAT_SESSION_CHARS) break;
    const nextTurn = messages.findIndex((message, index) => index > 0 && message.role === 'user');
    if (nextTurn < 0) { clearChatSession(storage); return { saved: false, trimmed: true }; }
    messages.splice(0, nextTurn);
    trimmed = true;
  }
  try { storage.setItem(CHAT_SESSION_KEY, raw); return { saved: true, trimmed }; }
  catch { clearChatSession(storage); return { saved: false, trimmed }; }
}
