import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { RagHistoryMessage } from './ragAsk';

async function check() {
  const { API_BASE } = await import('../apiBase');
  const { ragAsk, appendCompletedChatTurn } = await import('./ragAsk');
  assert.equal(API_BASE, process.env.EXPECTED_API_BASE);
  const source = { citation_id: 'S1', title: 'Evidence', content: 'Observed', pub_time: '', stock_id: '2330' };
  const action = { type: 'follow_up', label: 'Explain more', query: 'Explain 2330 more' };
  for (const answerDetail of ['plain', 'standard', 'technical'] as const) {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, `${API_BASE}/api/ask`);
      assert.equal(options?.method, 'POST');
      assert.equal((options?.headers as Record<string, string>).Accept, 'application/json');
      assert.deepEqual(JSON.parse(String(options?.body)), {
        query: 'Question', stock_id: null, answer_detail: answerDetail, history: [], stream: false,
      });
      return new Response(JSON.stringify({ answer: 'Complete answer[S1]', actions: [action, { type: 'trade' }],
        sources: [source, { citation_id: 'S99' }], message_id: 'untrusted-guest-id' }));
    };
    const result = await ragAsk({ query: 'Question', answer_detail: answerDetail });
    assert.equal(result.answer, 'Complete answer[S1]');
    assert.deepEqual(result.actions, [action]);
    assert.deepEqual(result.sources, [source]);
    assert.equal(result.serverId, undefined);
  }
  const history: RagHistoryMessage[] = Array.from({ length: 10 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user', content: index % 2 ? 'Answer[S1]【引用來源】unused' : 'Question',
  }));
  globalThis.fetch = async (_url, options) => {
    const sent = JSON.parse(String(options?.body));
    assert.equal(sent.history.length, 8);
    assert.equal(sent.history[1].content, 'Answer');
    return new Response(JSON.stringify({ answer: '', actions: [] }));
  };
  assert.equal((await ragAsk({ query: 'History', history })).answer, '');
  assert.equal(appendCompletedChatTurn(history.slice(-8), 'Next', 'Answer[S1]').length, 8);
  assert.deepEqual(appendCompletedChatTurn([], 'Question', ''), []);

  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'fixture-token' } });
  globalThis.fetch = async (url, options) => {
    assert.equal(url, `${API_BASE}/api/conversations/conversation%2Fone/ask`);
    assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer fixture-token');
    return new Response(JSON.stringify({ answer: 'Saved', message_id: 'saved-id' }));
  };
  assert.equal((await ragAsk({ query: 'Saved' }, { conversationId: 'conversation/one' })).serverId, 'saved-id');
  for (const messageId of [null, '', '  ', 123, {}]) {
    globalThis.fetch = async () => new Response(JSON.stringify({ answer: 'Reply', message_id: messageId }));
    assert.equal((await ragAsk({ query: 'Saved' }, { conversationId: 'one' })).serverId, undefined);
  }
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: '請先登入' }), { status: 401 });
  await assert.rejects(ragAsk({ query: 'Unauthorized' }), (error: Error & { status?: number }) =>
    error.status === 401 && error.message.includes('請先登入'));
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: {
    code: 'upstream_model_error', message: '模型服務暫時無法回應，請稍後重試',
    context: { token: 'fixture-secret-token', upstream: 'http://internal-provider' },
  } }), { status: 503 });
  await assert.rejects(ragAsk({ query: 'Model unavailable' }), (error: Error & { status?: number }) => {
    assert.equal(error.status, 503);
    assert.equal(error.message, '模型服務暫時無法回應，請稍後重試');
    assert.doesNotMatch(error.message, /fixture-secret-token|internal-provider|upstream_model_error/);
    return true;
  });
  globalThis.fetch = async () => new Response(JSON.stringify({ actions: [] }));
  await assert.rejects(ragAsk({ query: 'Malformed' }), /未回傳完整回答/);
  globalThis.fetch = async () => { throw new TypeError('secret provider URL'); };
  await assert.rejects(ragAsk({ query: 'Network' }), (error: Error) => {
    assert.match(error.message, /連線中斷/);
    assert.doesNotMatch(error.message, /secret/);
    return true;
  });
  const cancel = new AbortController();
  globalThis.fetch = async (_url, options) => new Promise<Response>((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    cancel.abort();
  });
  await assert.rejects(ragAsk({ query: 'Cancel' }, { signal: cancel.signal }), (error: Error) => error.name === 'AbortError');
  const originalSetTimeout = globalThis.setTimeout;
  let expire = () => {};
  globalThis.setTimeout = ((callback: () => void) => { expire = callback; return 0; }) as unknown as typeof setTimeout;
  try {
    globalThis.fetch = async (_url, options) => new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      expire();
    });
    await assert.rejects(ragAsk({ query: 'Timeout' }), /已停止等待/);
  } finally { globalThis.setTimeout = originalSetTimeout; }
}

if (process.argv.includes('--child')) {
  check().catch((error) => { console.error(error); process.exitCode = 1; });
} else {
  for (const [nodeEnv, apiBase, expected] of [
    ['development', '', 'http://127.0.0.1:8002'],
    ['production', '', 'http://127.0.0.1:8003'],
    ['development', 'http://127.0.0.1:8012/', 'http://127.0.0.1:8012'],
    ['production', 'https://production.example/backend/', 'https://production.example/backend'],
  ] as const) {
    const child = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), '--child'], {
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: nodeEnv, NEXT_PUBLIC_API_URL: apiBase, EXPECTED_API_BASE: expected },
    });
    assert.equal(child.status, 0, child.stderr || child.stdout);
  }
  console.log('Chat JSON API passed: routing, bounded history, safe response fields, saved IDs, errors, cancellation, and timeout.');
}
