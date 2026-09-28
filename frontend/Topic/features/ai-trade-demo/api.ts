import { parseSimEvent } from './events';
import { createSseBlockParser } from './sse';
import type { SimDayEvent, SimInitEvent, SimMetrics, SimulateParams } from './types';

/** 參數順序與實測時相同；五個參數都一樣才會命中快取 */
export function buildSimulateUrl(apiBase: string, params: SimulateParams): string {
  const query = new URLSearchParams({
    symbol: params.symbol,
    start: params.start,
    end: params.end,
    initial_cash: String(params.initialCash),
    confidence: String(params.confidence),
  });
  return `${apiBase}/api/simulate_trading_stream?${query}`;
}

export interface SimulateStreamHandlers {
  onInit: (event: SimInitEvent) => void;
  onDay: (event: SimDayEvent) => void;
  onDone: (metrics: SimMetrics) => void;
  /** 認得 type 但格式不符、已略過的事件 */
  onInvalid?: () => void;
}

export type StreamErrorSource = 'event' | 'http' | 'network';

export type SimulateStreamOutcome =
  | { kind: 'done' }
  | { kind: 'error'; source: StreamErrorSource; message: string }
  /** 串流結束了，但沒收到 done 或 error */
  | { kind: 'incomplete' }
  | { kind: 'aborted' };

const isAbortError = (err: unknown) => (err as { name?: unknown } | null)?.name === 'AbortError';

/**
 * 非 2xx 回應是 JSON，不是 SSE：
 * - 日期超出範圍實測為 400 {"detail":"日期需在資料有效範圍內：2023-05-14 ~ 2026-09-03"}
 * - 參數驗證失敗依 openapi2.json 是 422 HTTPValidationError（detail 為陣列）
 */
export async function httpErrorMessage(res: Response): Promise<string> {
  try {
    const body = JSON.parse(await res.text()) as { detail?: unknown };
    if (typeof body.detail === 'string' && body.detail.trim()) return body.detail.trim();
    if (Array.isArray(body.detail)) {
      const messages = body.detail
        .map((item) => (typeof (item as { msg?: unknown })?.msg === 'string' ? (item as { msg: string }).msg : null))
        .filter((msg): msg is string => !!msg);
      if (messages.length) return `參數不正確：${messages.join('；')}`;
    }
  } catch {
    /* 不是 JSON，改用通用訊息 */
  }
  return `Demo 後端回應錯誤（HTTP ${res.status}），請稍後再試。`;
}

/**
 * 用 fetch + ReadableStream 讀 SSE。不用 EventSource：它斷線會自動重連，
 * 重連就可能再觸發一次整段 LLM 回測。收到 done 或 error 後立刻停止讀取並取消串流。
 * 除了 abort 以外不丟例外，一律回傳結果。
 */
export async function streamSimulateTrading(
  apiBase: string,
  params: SimulateParams,
  handlers: SimulateStreamHandlers,
  signal?: AbortSignal,
): Promise<SimulateStreamOutcome> {
  let res: Response;
  try {
    res = await fetch(buildSimulateUrl(apiBase, params), {
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
      cache: 'no-store',
      signal,
    });
  } catch (err) {
    if (signal?.aborted || isAbortError(err)) return { kind: 'aborted' };
    return { kind: 'error', source: 'network', message: '無法連線到 Demo 後端，請確認網路連線後重試。' };
  }
  if (!res.ok) return { kind: 'error', source: 'http', message: await httpErrorMessage(res) };
  if (!res.body) return { kind: 'error', source: 'network', message: '瀏覽器無法讀取串流回應，請改用其他瀏覽器再試。' };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseBlockParser();

  /** 回傳非 null 代表要停止讀取 */
  const handle = (data: string): SimulateStreamOutcome | null => {
    const event = parseSimEvent(data);
    switch (event?.type) {
      case 'init':
        handlers.onInit(event);
        return null;
      case 'day':
        handlers.onDay(event);
        return null;
      case 'done':
        handlers.onDone(event.metrics);
        return { kind: 'done' };
      case 'error':
        return { kind: 'error', source: 'event', message: event.message };
      case 'invalid':
        handlers.onInvalid?.();
        return null;
      default:
        return null;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      // stream: true 讓被切開的多位元組中文字留到下一個 chunk 再解碼
      const blocks = done ? [...parser.push(decoder.decode()), ...parser.flush()] : parser.push(decoder.decode(value, { stream: true }));
      for (const data of blocks) {
        const outcome = handle(data);
        if (outcome) {
          await reader.cancel().catch(() => undefined);
          return outcome;
        }
      }
      if (done) return { kind: 'incomplete' };
    }
  } catch (err) {
    if (signal?.aborted || isAbortError(err)) return { kind: 'aborted' };
    return { kind: 'error', source: 'network', message: '串流連線中斷，畫面保留已收到的資料。' };
  }
}
