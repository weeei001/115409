import assert from 'node:assert/strict';
import { AxiosError, AxiosHeaders } from 'axios';
import apiClient from './client';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createConversation, getConversation, listConversations, parseSavedMessages } from './conversations';
import { getToken, setAuth } from '../auth/storage';
import { ChatArea } from '../../features/ai/ChatArea';

async function main() {
  const values = new Map<string, string>();
  const local = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local });
  const user = { id: 1, email: 'fixture@example.com', display_name: 'Fixture' };
  setAuth('fixture-token', user);
  const summary = { id: 'one', title: 'Question', updated_at: '2026-10-02T00:00:00Z' };
  const detail = { ...summary, messages: [] };
  let mode: 'list' | 'create' | 'get' | 'stored' | 'stale401' | 'current401' = 'list';
  apiClient.defaults.adapter = async (config) => {
    assert.equal(config.headers.Authorization, 'Bearer fixture-token');
    if (mode === 'stale401' || mode === 'current401') {
      if (mode === 'stale401') setAuth('new-token', { ...user, id: 2 });
      throw new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, {}, { data: {}, status: 401, statusText: 'Unauthorized', headers: new AxiosHeaders(), config });
    }
    if (mode === 'list') {
      assert.equal(config.url, '/api/conversations');
      assert.deepEqual(config.params, { q: 'answer text', offset: 30, limit: 30 });
    } else {
      assert.equal(config.url, mode === 'create' ? '/api/conversations' : '/api/conversations/one');
      assert.equal(config.method, mode === 'create' ? 'post' : 'get');
    }
    const data = mode === 'list' ? { items: [summary], has_more: true } : mode === 'stored' ? { ...summary, messages: legacyMessages } : detail;
    return { data, status: 200, statusText: 'OK', headers: new AxiosHeaders(), config };
  };
  assert.deepEqual(await listConversations('answer text', 30), { items: [summary], has_more: true });
  mode = 'create';
  assert.deepEqual(await createConversation(), detail);
  mode = 'get';
  assert.deepEqual(await getConversation('one'), detail);
  // P2-034：歷史訊息和串流同一套驗證。openapi 的選填欄位（source_ids、description、unit、date）缺了要補預設值，
  // 不合格的面板、來源、動作丟掉，不能讓整個 /ai 頁崩潰
  const legacyMessages = [
    { id: 'q', role: 'user', content: '比較台積電與聯發科', timestamp: '2026-10-04T09:03:00Z' },
    { id: 'a', role: 'assistant', content: '回覆 [S1]', timestamp: '2026-10-04T09:03:30Z', status: 'completed', error: null,
      actions: [{ type: 'navigate', label: '個股', path: '/stock/2330' }, { type: 'navigate', label: '外站', path: 'https://evil.example' }],
      dashboard: { title: '比較', blocks: [
        { kind: 'table', title: '多股比較', columns: ['股票', '區間報酬（%）'], rows: [['2330', '3.73444']] },
        { kind: 'metrics', title: '指標', items: [{ label: '收盤', value: 1475 }] },
        { kind: 'chart', title: '走勢', dates: ['2026-10-02'], series: [{ name: '2330', values: [1475] }] },
        { kind: 'table', title: '壞掉的表', columns: ['A'], rows: [['1', '2']] },
      ] },
      sources: [{ citation_id: 'S1', title: '來源', content: '內容', pub_time: '', stock_id: '2330' }, { citation_id: 'bad' }] },
    { id: 'x', role: 'system', content: 'ignored' },
    null,
  ];
  const parsed = parseSavedMessages(legacyMessages);
  assert.deepEqual(parsed.map((message) => message.id), ['q', 'a']);
  const answer = parsed[1];
  assert.equal(answer.status, 'completed');
  assert.deepEqual(answer.actions, [{ type: 'navigate', label: '個股', path: '/stock/2330' }]);
  assert.deepEqual(answer.sources?.map((source) => source.citation_id), ['S1']);
  assert.deepEqual(answer.dashboard?.blocks.map((block) => block.title), ['多股比較', '指標', '走勢']);
  for (const block of answer.dashboard?.blocks ?? []) {
    assert.deepEqual(block.source_ids, []);
    assert.equal(block.description, '');
  }
  const metrics = answer.dashboard?.blocks[1];
  assert.deepEqual(metrics?.kind === 'metrics' ? metrics.items : null, [{ label: '收盤', value: 1475, unit: '', date: null }]);
  assert.equal(answer.dashboard?.blocks[2].kind === 'chart' ? answer.dashboard.blocks[2].unit : null, '');
  // 修正前這裡會 TypeError（block.source_ids.length）
  const page = renderToStaticMarkup(createElement(ChatArea, { messages: parsed, loading: false, streamingMessageId: null, exampleQuestions: [], onSend: () => undefined }));
  assert.match(page, /多股比較/);
  assert.match(page, /\+3\.73/);
  assert.deepEqual(parseSavedMessages({ not: 'an array' }), []);
  assert.deepEqual(parseSavedMessages([{ role: 'assistant', content: 'no id', dashboard: 'bad', sources: 'bad', actions: 'bad' }]),
    [{ id: 'saved-0', role: 'assistant', content: 'no id', timestamp: '', status: null, error: null, actions: [], dashboard: null, sources: [] }]);
  mode = 'stored';
  const stored = await getConversation('one');
  assert.deepEqual(stored.messages.map((message) => message.id), ['q', 'a']);
  assert.equal(stored.title, 'Question');

  mode = 'stale401';
  await assert.rejects(getConversation('one'));
  assert.equal(getToken(), 'new-token', 'An older account request must not sign out the new account');
  setAuth('fixture-token', user);
  mode = 'current401';
  await assert.rejects(getConversation('one'));
  assert.equal(getToken(), null);
  console.log('Conversation API passed: authenticated endpoints, server search pagination, and stale account errors.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
