/**
 * SSE 區塊切分。事件之間以空行分隔；一個事件可能被切在兩個 chunk 之間，
 * 沒湊齊的尾巴留在 buffer 等下一個 chunk。CRLF、CR 都當成換行。
 */
export interface SseBlockParser {
  /** 放入一段已解碼的文字，回傳這次湊齊的事件 data（多行 data 以 \n 連接） */
  push(chunk: string): string[];
  /** 串流結束時呼叫，取出最後一個沒有以空行結尾的事件 */
  flush(): string[];
}

/** 只取 data 欄位；註解行（: 開頭）與 event、id、retry 忽略 */
function dataOf(block: string): string | null {
  const lines: string[] = [];
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    if ((colon === -1 ? line : line.slice(0, colon)) !== 'data') continue;
    const value = colon === -1 ? '' : line.slice(colon + 1);
    lines.push(value.startsWith(' ') ? value.slice(1) : value);
  }
  return lines.length ? lines.join('\n') : null;
}

const collect = (blocks: string[]) => blocks.map(dataOf).filter((data): data is string => data !== null);

export function createSseBlockParser(): SseBlockParser {
  let buffer = '';
  return {
    push(chunk) {
      buffer += chunk;
      // 結尾的 \r 可能是 \r\n 的前半，先留著，等下一個 chunk 再一起換成 \n
      const pendingCr = buffer.endsWith('\r');
      const text = (pendingCr ? buffer.slice(0, -1) : buffer).replace(/\r\n?/g, '\n');
      const blocks = text.split('\n\n');
      buffer = (blocks.pop() ?? '') + (pendingCr ? '\r' : '');
      return collect(blocks);
    },
    flush() {
      const rest = buffer.replace(/\r\n?/g, '\n');
      buffer = '';
      return collect(rest.split('\n\n'));
    },
  };
}
