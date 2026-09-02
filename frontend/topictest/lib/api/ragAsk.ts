import { RAG_BASE } from '../apiBase';
import { getToken } from '../auth/storage';
import { getRagApiTimeoutMs } from '../ragTimeout';
import { ApiRequestError } from './client';

const RAG_ASK_URL = `${RAG_BASE}/api/ask`;

export interface RagAskParams {
  query: string;
  stock_id?: string | null;
}

export interface RagAskStreamHandlers {
  onText: (chunk: string) => void;
  /** 後端 `type: "status"`（搜尋中、思考中等） */
  onStatus?: (status: string) => void;
  onDone?: () => void;
}

/** SSE data 行 JSON（由後端 /api/ask stream=true） */
interface StreamDataLine {
  type: string;
  content?: string;
  text?: string;
  message?: string;
}

/** 支援 `data: {...}`、`data:{...}`、或整行裸 JSON */
function parseSseOrJsonLine(line: string): StreamDataLine | null {
  const t = line.replace(/\r$/, '').trim();
  if (!t || t.startsWith(':')) return null;

  let jsonStr: string | null = null;
  const low = t.slice(0, 5).toLowerCase();
  if (low === 'data:') {
    jsonStr = t.slice(5).replace(/^\s+/, '');
  } else if (t.startsWith('{') || t.startsWith('[')) {
    jsonStr = t;
  }
  if (!jsonStr || jsonStr === '[DONE]') return null;

  try {
    return JSON.parse(jsonStr) as StreamDataLine;
  } catch {
    return null;
  }
}

function textFromPayload(data: StreamDataLine & Record<string, unknown>): string | null {
  if (data.type !== 'text') return null;
  if (typeof data.content === 'string') return data.content;
  if (typeof data.text === 'string') return data.text;
  const maybeDelta = (data as unknown as { delta?: unknown }).delta;
  if (typeof maybeDelta === 'string') return maybeDelta;
  return null;
}

function tryExtractAnswerFromJsonRoot(data: Record<string, unknown>): string | null {
  const keys = ['answer', 'text', 'content', 'response', 'message', 'raw_answer'] as const;
  for (const k of keys) {
    const v = data[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
}

export interface RagAskStreamResult {
  /** 曾收到至少一段 `type=text` 串流片段 */
  hadStreamText: boolean;
}

/**
 * 財經新聞 RAG：POST /api/ask，`stream: true`，解析 SSE `data:` 行或裸 JSON 行；若無事件則嘗試整段 JSON。
 */
export async function ragAskStream(
  params: RagAskParams,
  handlers: RagAskStreamHandlers,
  options?: { signal?: AbortSignal }
): Promise<RagAskStreamResult> {
  const timeoutMs = getRagApiTimeoutMs();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  if (options?.signal) {
    if (options.signal.aborted) {
      ctrl.abort();
    } else {
      options.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
    }
  }

  const body = JSON.stringify({
    query: params.query,
    stock_id: params.stock_id ?? null,
    stream: true,
    user_token: typeof window !== 'undefined' ? getToken() : null,
  });

  try {
    const res = await fetch(RAG_ASK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream, application/json;q=0.1, */*;q=0.01',
      },
      body,
      signal: ctrl.signal,
      cache: 'no-store',
    });

    if (!res.ok) {
      let message = `RAG API 錯誤 (${res.status})`;
      try {
        const errText = await res.text();
        if (errText) {
          try {
            const j = JSON.parse(errText) as { detail?: unknown; message?: string };
            const d = j.detail;
            if (Array.isArray(d) && d[0] && typeof d[0] === 'object' && d[0] !== null && 'msg' in d[0]) {
              message = String((d[0] as { msg?: string }).msg ?? message);
            } else if (typeof j.message === 'string') {
              message = j.message;
            } else if (errText.length < 300) {
              message = errText;
            }
          } catch {
            if (errText.length < 300) message = errText;
          }
        }
      } catch {
        /* 維持預設訊息 */
      }
      throw new ApiRequestError(message, res.status);
    }

    if (!res.body) {
      throw new ApiRequestError('RAG 回應無內容');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let carry = '';
    let fullRaw = '';
    let hadStreamText = false;

    const processLine = (line: string): 'done' | 'continue' => {
      const data = parseSseOrJsonLine(line);
      if (!data || typeof data.type !== 'string') return 'continue';
      const typ = data.type;
      if (typ === 'status') {
        const raw = data as StreamDataLine & Record<string, unknown>;
        const st =
          typeof raw.content === 'string'
            ? raw.content
            : typeof raw.text === 'string'
              ? raw.text
              : null;
        if (st !== null) {
          handlers.onStatus?.(st);
        }
        return 'continue';
      }

      const chunk = textFromPayload(
        data as StreamDataLine & Record<string, unknown>
      );
      if (typ === 'text' && chunk !== null) {
        hadStreamText = true;
        handlers.onText(chunk);
        return 'continue';
      }
      if (typ === 'done') {
        handlers.onDone?.();
        return 'done';
      }
      if (typ === 'error') {
        const msg =
          typeof data.message === 'string' && data.message.trim()
            ? data.message
            : 'RAG 串流回報錯誤';
        throw new ApiRequestError(msg);
      }
      return 'continue';
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunkStr = decoder.decode(value, { stream: true });
      fullRaw += chunkStr;
      carry += chunkStr;
      const parts = carry.split('\n');
      carry = parts.pop() ?? '';
      for (const raw of parts) {
        const line = raw.replace(/\r$/, '');
        if (!line.trim()) continue;
        switch (processLine(line)) {
          case 'done':
            return { hadStreamText };
          default:
            break;
        }
      }
    }

    if (carry.trim()) {
      const line = carry.replace(/\r$/, '');
      if (line.trim()) {
        switch (processLine(line)) {
          case 'done':
            return { hadStreamText };
          default:
            break;
        }
      }
    }

    if (!hadStreamText && fullRaw.trim()) {
      for (const rawLine of fullRaw.split(/\r?\n/)) {
        const line = rawLine.replace(/\r$/, '');
        if (!line.trim()) continue;
        switch (processLine(line)) {
          case 'done':
            return { hadStreamText };
          default:
            break;
        }
      }
    }

    if (!hadStreamText && fullRaw.trim()) {
      const tryJson = fullRaw.trim();
      try {
        const obj = JSON.parse(tryJson) as Record<string, unknown>;
        if (typeof obj.type === 'string') {
          const inner = obj as StreamDataLine & Record<string, unknown>;
          if (inner.type === 'text') {
            const t = textFromPayload(inner);
            if (t !== null) {
              hadStreamText = true;
              handlers.onText(t);
            }
          } else if (inner.type === 'status') {
            const st =
              typeof inner.content === 'string'
                ? inner.content
                : typeof inner.text === 'string'
                  ? inner.text
                  : null;
            if (st !== null) handlers.onStatus?.(st);
          } else if (inner.type === 'done') {
            handlers.onDone?.();
            return { hadStreamText };
          } else if (inner.type === 'error') {
            const msg =
              typeof inner.message === 'string' && inner.message.trim()
                ? inner.message
                : 'RAG 串流回報錯誤';
            throw new ApiRequestError(msg);
          }
        } else {
          const ans = tryExtractAnswerFromJsonRoot(obj);
          if (ans) {
            hadStreamText = true;
            handlers.onText(ans);
          }
        }
      } catch {
        /* 非 JSON 或格式不符 */
      }
    }

    handlers.onDone?.();
    return { hadStreamText };
  } catch (err) {
    if (err instanceof ApiRequestError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiRequestError('RAG 請求逾時或已中止', undefined, { cause: err });
    }
    throw err instanceof Error ? err : new ApiRequestError(String(err));
  } finally {
    clearTimeout(timer);
  }
}
