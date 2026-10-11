import assert from 'node:assert/strict';
import { ApiRequestError } from './client';
import { streamAIBacktest, type AIBacktestEvent, type AIBacktestParams } from './backtest';

const PARAMS: AIBacktestParams = { symbol: ' 2330 ', start: '2025-01-01', end: '2025-12-31', preset: 'standard', initial_cash: 1_000_000, ai: true };
const RESULT = { symbol: '2330', groups: [], decisions: [] };

function respondWith(chunks: string[], status = 200, contentType = 'text/event-stream') {
  const calls: string[] = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const encoder = new TextEncoder();
    return new Response(new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }), { status, headers: { 'Content-Type': contentType } });
  };
  return calls;
}

async function main() {
  // 一行被切在兩個區塊之間、事件之間夾著空行，仍然逐一解析
  const calls = respondWith([
    'data: {"type":"init","symbol":"2330","decisions":2,"groups":["rule"],"llm_calls":0,"cached":false}\n\ndata: {"type":"progr',
    'ess","done":1,"total":2,"date":"2025-01-02"}\n\n',
    `data: {"type":"progress","done":2,"total":2,"date":"2025-01-09"}\n\ndata: ${JSON.stringify({ type: 'done', result: RESULT })}\n\n`,
  ]);
  const seen: AIBacktestEvent['type'][] = [];
  const result = await streamAIBacktest(PARAMS, (event) => seen.push(event.type));
  assert.deepEqual(seen, ['init', 'progress', 'progress', 'done']);
  assert.deepEqual(result, RESULT);
  assert.match(calls[0], /\/admin\/ai-backtest\/stream\?symbol=2330&start=2025-01-01&end=2025-12-31&preset=standard&initial_cash=1000000&ai=true$/);

  respondWith(['data: {"type":"init","decisions":2}\n\n', 'data: {"type":"error","message":"模型服務暫時無法回應"}\n\n']);
  await assert.rejects(streamAIBacktest(PARAMS, () => {}), (err) => err instanceof ApiRequestError && err.message === '模型服務暫時無法回應');

  respondWith(['data: {"type":"progress","done":1,"total":2}\n\n']);
  await assert.rejects(streamAIBacktest(PARAMS, () => {}), /提前結束/);

  respondWith([JSON.stringify({ detail: '股票清單裡沒有 9999' })], 404, 'application/json');
  await assert.rejects(streamAIBacktest(PARAMS, () => {}), (err) => err instanceof ApiRequestError && err.status === 404 && err.message === '股票清單裡沒有 9999');

  console.log('AI backtest stream passed: split chunks, progress, done, error event, early end, HTTP error.');
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
