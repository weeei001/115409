import { API_BASE } from '../apiBase';
import { getToken } from '../auth/storage';
import { isChatAction } from '../nav';
import type { ChatAction } from '../types/chat';
import { parseChatDashboard, type ChatDashboard } from '../types/chatDashboard';
import { ApiRequestError } from './client';
import { genericMessageForStatus, pickDetailMessage } from './errorDetail';
import { getRagApiTimeoutMs } from './ragTimeout';

const ASK_URL = `${API_BASE}/api/ask`;

/** openapi: AskRequest.answer_detail */
export type AnswerDetail = 'plain' | 'standard' | 'technical';

/** openapi: ChatTurn */
export interface RagHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface RagAskParams {
  query: string;
  stock_id?: string | null;
  answer_detail?: AnswerDetail;
  history?: RagHistoryMessage[];
}

/** 助理回覆去掉引用來源段落與 [S#]，每則最多 6000 字 */
function cleanHistoryMessage(message: RagHistoryMessage): RagHistoryMessage {
  const content =
    message.role === 'assistant'
      ? message.content.replace(/【(?:引用|新聞|資料)來源】[\s\S]*?(?=【[^】]+】|$)/g, '').replace(/\[S\d+\]/g, '')
      : message.content;
  return { role: message.role, content: content.trim().slice(0, 6000) };
}

/** 只有完整收到 done 的回合才加入 history；最多保留 8 則（openapi maxItems 8） */
export function appendCompletedChatTurn(history: RagHistoryMessage[], query: string, answer: string): RagHistoryMessage[] {
  const turn = [cleanHistoryMessage({ role: 'user', content: query }), cleanHistoryMessage({ role: 'assistant', content: answer })];
  return turn.every((message) => message.content) ? [...history, ...turn].slice(-8) : history;
}

export interface RagAskDone {
  actions: ChatAction[];
  dashboard?: ChatDashboard;
}

export interface RagAskStreamHandlers {
  onText: (chunk: string) => void;
  onStatus?: (status: string) => void;
  onDone?: (result: RagAskDone) => void;
  onDashboard?: (result: RagAskDone) => void;
}

/**
 * 後端 SSE 事件（chat/service.py）：status／text 用 content，error 用 message，
 * dashboard 帶 dashboard 與 actions，done 展開整個 AskResponse。只讀這些鍵（決議 D2）。
 */
interface StreamEvent {
  type: string;
  content?: unknown;
  message?: unknown;
  answer?: unknown;
  actions?: unknown;
  dashboard?: unknown;
}

/** 接受 `data: {...}` 或整行 JSON；`[DONE]` 與註解行忽略 */
function parseLine(line: string): StreamEvent | null {
  const t = line.replace(/\r$/, '').trim();
  if (!t || t.startsWith(':')) return null;
  let json: string | null = null;
  if (t.slice(0, 5).toLowerCase() === 'data:') json = t.slice(5).replace(/^\s+/, '');
  else if (t.startsWith('{') || t.startsWith('[')) json = t;
  if (!json || json === '[DONE]') return null;
  try {
    return JSON.parse(json) as StreamEvent;
  } catch {
    return null;
  }
}

const safeActions = (value: unknown): ChatAction[] => (Array.isArray(value) ? value.filter(isChatAction) : []);

/** 與 axios client 同一套規則：中文 detail 原樣，其餘依狀態碼給通用文案（決議 D13） */
async function errorMessageFrom(res: Response): Promise<string> {
  try {
    return pickDetailMessage(JSON.parse(await res.text()), res.status);
  } catch {
    return genericMessageForStatus(res.status);
  }
}

export interface RagAskStreamResult {
  /** 至少收到一段文字 */
  hadStreamText: boolean;
  /** 收到 done（回合完整） */
  completed: boolean;
}

/** POST /api/ask（stream: true）；後端若回一般 JSON（AskResponse）也能處理 */
export async function ragAskStream(
  params: RagAskParams,
  handlers: RagAskStreamHandlers,
  options?: { signal?: AbortSignal },
): Promise<RagAskStreamResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), getRagApiTimeoutMs());
  if (options?.signal) {
    if (options.signal.aborted) ctrl.abort();
    else options.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }

  const body = JSON.stringify({
    query: params.query,
    stock_id: params.stock_id ?? null,
    answer_detail: params.answer_detail ?? 'plain',
    history: (params.history ?? []).slice(-8).map(cleanHistoryMessage).filter((message) => message.content),
    stream: true,
    // openapi 沒有這個欄位，後端會忽略；決議 D1 維持舊版行為照送
    user_token: typeof window !== 'undefined' ? getToken() : null,
  });

  try {
    const res = await fetch(ASK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json;q=0.1, */*;q=0.01' },
      body,
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (!res.ok) throw new ApiRequestError(await errorMessageFrom(res), res.status);
    if (!res.body) throw new ApiRequestError('目前無法取得回覆，請稍後再試。');

    let hadStreamText = false;
    let completed = false;

    const finish = (event: StreamEvent) => {
      // 已經串過文字時，done 裡的 answer 是同一份內容，不再重複送出
      if (!hadStreamText && typeof event.answer === 'string' && event.answer.trim()) {
        hadStreamText = true;
        handlers.onText(event.answer);
      }
      completed = true;
      handlers.onDone?.({ actions: safeActions(event.actions), dashboard: parseChatDashboard(event.dashboard) });
    };

    const processLine = (line: string): boolean => {
      const event = parseLine(line);
      if (!event || typeof event.type !== 'string') return false;
      switch (event.type) {
        case 'status':
          if (typeof event.content === 'string') handlers.onStatus?.(event.content);
          return false;
        case 'dashboard': {
          const dashboard = parseChatDashboard(event.dashboard);
          if (dashboard) handlers.onDashboard?.({ dashboard, actions: safeActions(event.actions) });
          return false;
        }
        case 'text':
          if (typeof event.content === 'string') {
            hadStreamText = true;
            handlers.onText(event.content);
          }
          return false;
        case 'done':
          finish(event);
          return true;
        case 'error':
          throw new ApiRequestError(typeof event.message === 'string' && event.message.trim() ? event.message : '回覆過程發生錯誤，請稍後再試。');
        default:
          return false;
      }
    };

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let carry = '';
    let fullRaw = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      fullRaw += chunk;
      carry += chunk;
      const lines = carry.split('\n');
      carry = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim() && processLine(line)) return { hadStreamText, completed };
      }
    }
    if (carry.trim() && processLine(carry)) return { hadStreamText, completed };

    // 非串流的 AskResponse（整份 JSON，可能跨多行）：只讀 answer、actions、dashboard（決議 D2）
    if (!hadStreamText && fullRaw.trim()) {
      try {
        const obj = JSON.parse(fullRaw.trim()) as StreamEvent;
        if (typeof obj.type !== 'string' && typeof obj.answer === 'string' && obj.answer.trim()) {
          finish(obj);
        }
      } catch {
        /* 不是 JSON */
      }
    }
    return { hadStreamText, completed };
  } catch (err) {
    if (err instanceof ApiRequestError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiRequestError('AI 回覆逾時，請稍後再試。', undefined, { cause: err });
    }
    throw err instanceof Error ? err : new ApiRequestError(String(err));
  } finally {
    clearTimeout(timer);
  }
}
