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

/** 一般 JSON 請求；回答完成後一次回傳文字、來源及已儲存訊息 ID。 */
export async function ragAsk(
  params: RagAskParams,
  options?: { signal?: AbortSignal; conversationId?: string },
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
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
      throw new ApiRequestError(message, res.status);
    }
    const result = await res.json();
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
        : '與伺服器的連線中斷，尚未取得完整回覆。請確認網路連線後重試。';
    throw new ApiRequestError(message, error instanceof ApiRequestError ? error.status : undefined, { cause: error });
  } finally {
    clearTimeout(timer);
    options?.signal?.removeEventListener('abort', abort);
  }
}
