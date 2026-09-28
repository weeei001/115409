import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSseBlockParser } from './sse';

/** 2026-09-28 實測的原始回應：init、5 個 day、done */
const FIXTURE = readFileSync(new URL('./fixtures/sse-2330-20260827-20260902.txt', import.meta.url), 'utf8');

function parseAll(chunks: string[]): string[] {
  const parser = createSseBlockParser();
  return [...chunks.flatMap((chunk) => parser.push(chunk)), ...parser.flush()];
}

const whole = parseAll([FIXTURE]);
assert.equal(whole.length, 7, '實測回應應有 7 個事件');
assert.deepEqual(
  whole.map((data) => (JSON.parse(data) as { type: string }).type),
  ['init', 'day', 'day', 'day', 'day', 'day', 'done'],
);

// 在每一個位置切成兩個 chunk，結果都要和一次收到相同（事件被切在兩個 chunk 之間）
for (let i = 0; i <= FIXTURE.length; i++) {
  assert.deepEqual(parseAll([FIXTURE.slice(0, i), FIXTURE.slice(i)]), whole, `切在第 ${i} 個字元`);
}

// 切成很多小段
for (const size of [1, 2, 3, 7, 64]) {
  const chunks: string[] = [];
  for (let i = 0; i < FIXTURE.length; i += size) chunks.push(FIXTURE.slice(i, i + size));
  assert.deepEqual(parseAll(chunks), whole, `每 ${size} 個字元一段`);
}

// 事件還沒以空行結束時不能先吐出來，要等下一個 chunk 補齊
{
  const parser = createSseBlockParser();
  assert.deepEqual(parser.push('data: {"type":"init"'), []);
  assert.deepEqual(parser.push('}\n'), []);
  assert.deepEqual(parser.push('\ndata: {"type":"day"}\n\n'), ['{"type":"init"}', '{"type":"day"}']);
  assert.deepEqual(parser.flush(), []);
}

// CRLF：\r 與 \n 被切到兩個 chunk 也不能多算出一個空行
{
  const crlf = 'data: {"a":1}\r\n\r\ndata: {"b":2}\r\n\r\n';
  for (let i = 0; i <= crlf.length; i++) {
    assert.deepEqual(parseAll([crlf.slice(0, i), crlf.slice(i)]), ['{"a":1}', '{"b":2}'], `CRLF 切在第 ${i} 個字元`);
  }
  assert.deepEqual(parseAll(['data: x\r\rdata: y\r\r']), ['x', 'y'], '單獨的 CR 也算換行');
}

// 多行 data 以 \n 連接；註解、event、id、retry 忽略；沒有 data 的區塊不輸出
assert.deepEqual(
  parseAll([': keep-alive\n\nevent: day\nid: 3\nretry: 1000\ndata: {"x":\ndata: 1}\n\n\n\ndata:no-space\n\n']),
  ['{"x":\n1}', 'no-space'],
);

// 串流結束時最後一個事件沒有空行結尾，flush 要補出來
assert.deepEqual(parseAll(['data: {"type":"done"}']), ['{"type":"done"}']);
assert.deepEqual(parseAll(['data: a\n\ndata: b\n']), ['a', 'b']);

console.log('ai-trade-demo sse.test.ts: ok');
