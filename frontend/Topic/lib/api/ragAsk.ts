import { API_BASE } from '../apiBase';
import { getToken } from '../auth/storage';
import { isChatAction } from '../nav';
import { parseChatSources, type ChatSource, type ChatAction } from '../types/chat';
import { parseChatDashboard, type ChatDashboard } from '../types/chatDashboard';
import { ApiRequestError } from './client';
import { genericMessageForStatus, pickDetailMessage, userFacingMessage } from './errorDetail';
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

/** 只有完整取得回答的回合才加入 history；最多保留 8 則（openapi maxItems 8） */
export function appendCompletedChatTurn(history: RagHistoryMessage[], query: string, answer: string): RagHistoryMessage[] {
  const turn = [cleanHistoryMessage({ role: 'user', content: query }), cleanHistoryMessage({ role: 'assistant', content: answer })];
  return turn.every((message) => message.content) ? [...history, ...turn].slice(-8) : history;
}

export interface RagAskResponse {
  answer: string;
  actions: ChatAction[];
  dashboard?: ChatDashboard;
  sources: ChatSource[];
  /** 登入使用者的回答完成並成功儲存後，才會帶入訊息 ID。 */
  serverId?: string;
}

const STREAM_DROPPED_MESSAGE = '與伺服器的連線中斷，尚未取得完整回覆。請確認網路連線後重試。';

/** 讀取 SSE：delta 逐段交給 onDelta，done 回傳與 JSON 相同的結果，error 轉成錯誤。 */
async function readAnswerStream(res: Response, onDelta: (text: string) => void): Promise<unknown> {
  if (!res.body) throw new ApiRequestError(STREAM_DROPPED_MESSAGE);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let end = buffer.indexOf('\n\n');
    while (end >= 0) {
      const data = buffer.slice(0, end).split('\n').filter((line) => line.startsWith('data: '))
        .map((line) => line.slice(6)).join('\n');
      buffer = buffer.slice(end + 2);
      end = buffer.indexOf('\n\n');
      if (!data) continue;
      const event = JSON.parse(data) as { type?: string; text?: unknown; response?: unknown; message?: unknown; status?: unknown };
      if (event.type === 'delta' && typeof event.text === 'string') onDelta(event.text);
      else if (event.type === 'done') return event.response;
      else if (event.type === 'error') {
        throw new ApiRequestError(typeof event.message === 'string' ? event.message : '伺服器無法完成回覆，請稍後再試。',
          typeof event.status === 'number' ? event.status : undefined);
      }
    }
    if (done) throw new ApiRequestError(STREAM_DROPPED_MESSAGE);
  }
}

/**
 * 提出問題。提供 onDelta 時以 SSE 串流，回答文字產生後立即逐段傳入；
 * 兩種方式最後都回傳完整文字、來源及已儲存訊息 ID。
 */
export async function ragAsk(
  params: RagAskParams,
  options?: { signal?: AbortSignal; conversationId?: string; onDelta?: (text: string) => void },
): Promise<RagAskResponse> {
  const ctrl = new AbortController();
  const timeoutMs = getRagApiTimeoutMs();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  const abort = () => ctrl.abort();
  if (options?.signal?.aborted) ctrl.abort();
  else options?.signal?.addEventListener('abort', abort, { once: true });
  try {
    const token = typeof window !== 'undefined' ? getToken() : null;
    const url = options?.conversationId ? `${API_BASE}/api/conversations/${encodeURIComponent(options.conversationId)}/ask` : ASK_URL;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: options?.onDelta ? 'text/event-stream' : 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        query: params.query, stock_id: params.stock_id ?? null, answer_detail: params.answer_detail ?? 'plain',
        history: (params.history ?? []).slice(-8).map(cleanHistoryMessage).filter((message) => message.content),
        stream: false,
      }),
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      let message = genericMessageForStatus(res.status);
      try { message = pickDetailMessage(await res.json(), res.status); } catch { /* 使用狀態碼對應訊息。 */ }
      // 閘道（Cloudflare）逾時會以英文錯誤頁取代後端的中文說明。
      if ((res.status === 504 || res.status === 524) && message === genericMessageForStatus(res.status)) {
        message = 'AI 回覆時間超過上限，請縮小問題範圍後再試。';
      }
      throw new ApiRequestError(message, res.status);
    }
    const result = options?.onDelta && res.headers.get('content-type')?.includes('text/event-stream')
      ? await readAnswerStream(res, options.onDelta) as Record<string, unknown> | undefined
      : await res.json();
    if (!result || typeof result.answer !== 'string') throw new ApiRequestError('伺服器未回傳完整回答，請重新提問。');
    return {
      answer: result.answer,
      actions: Array.isArray(result.actions) ? result.actions.filter(isChatAction) : [],
      dashboard: parseChatDashboard(result.dashboard),
      sources: parseChatSources(result.sources),
      ...(options?.conversationId && typeof result.message_id === 'string' && result.message_id.trim()
        ? { serverId: result.message_id } : {}),
    };
  } catch (error) {
    if (options?.signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
    const message = timedOut
      ? `AI 回覆超過 ${Math.round(timeoutMs / 1000)} 秒，已停止等待。請重新提問。`
      : error instanceof ApiRequestError
        ? userFacingMessage(error, '伺服器無法完成回覆，請稍後再試。')
        : STREAM_DROPPED_MESSAGE;
    throw new ApiRequestError(message, error instanceof ApiRequestError ? error.status : undefined, { cause: error });
  } finally {
    clearTimeout(timer);
    options?.signal?.removeEventListener('abort', abort);
  }
}
