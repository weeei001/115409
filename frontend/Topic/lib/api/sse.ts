import { genericMessageForStatus, pickDetailMessage } from './errorDetail';

/*
 * 用 fetch 讀 SSE 的共用部分：AI 對話（ragAsk.ts）與 AI 回測串流（backtest.ts）。
 * 不用 EventSource：它帶不了登入標頭，斷線還會自動重連、把整段請求重跑一次。
 */

/** 非 2xx 回應的錯誤訊息：與 axios client 同一套規則，中文 detail 原樣，其餘依狀態碼給通用文案（決議 D13） */
export async function errorMessageFrom(res: Response): Promise<string> {
  try {
    return pickDetailMessage(JSON.parse(await res.text()), res.status);
  } catch {
    return genericMessageForStatus(res.status);
  }
}

/**
 * 一行 SSE 取出 `data: {...}` 的事件；空行、註解行（`:` 開頭）、`[DONE]`、解析不了或沒有 type 的內容都回傳 null。
 * lenient：`data:` 不分大小寫，也接受整行 JSON（/api/ask 的後端可能直接回 AskResponse）。
 */
export function parseSseEvent<T extends { type: string }>(line: string, { lenient = false } = {}): T | null {
  const text = line.replace(/\r$/, '').trim();
  let json: string | null = null;
  if (lenient ? text.slice(0, 5).toLowerCase() === 'data:' : text.startsWith('data:')) json = text.slice(5).trim();
  else if (lenient && (text.startsWith('{') || text.startsWith('['))) json = text;
  if (!json || json === '[DONE]') return null;
  try {
    const event = JSON.parse(json) as T | null;
    return typeof event?.type === 'string' ? event : null;
  } catch {
    return null;
  }
}

/**
 * 逐行讀回應本文：一行可能被切在兩個區塊之間，留到下一塊再接；串流結束時沒有換行的最後一行也會讀到。
 * onChunk 在每收到一塊時呼叫（例如重新計算逾時、留一份原文）。迴圈提早結束或出錯時一律取消讀取，連線不會留著。
 */
export async function* streamLines(body: ReadableStream<Uint8Array>, onChunk?: (chunk: string) => void): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let carry = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      const chunk = done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (!done) onChunk?.(chunk);
      carry += chunk;
      const lines = carry.split('\n');
      carry = done ? '' : lines.pop() ?? '';
      yield* lines;
      if (done) return;
    }
  } finally {
    reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
