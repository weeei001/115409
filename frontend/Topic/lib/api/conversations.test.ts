import assert from 'node:assert/strict';
import { AxiosError, AxiosHeaders } from 'axios';
import apiClient from './client';
import { createConversation, getConversation, listConversations } from './conversations';
import { getToken, setAuth } from '../auth/storage';

async function main() {
  const values = new Map<string, string>();
  const local = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local });
  const user = { id: 1, email: 'fixture@example.com', display_name: 'Fixture' };
  setAuth('fixture-token', user);
  const summary = { id: 'one', title: 'Question', updated_at: '2026-10-02T00:00:00Z' };
  const detail = { ...summary, messages: [] };
  let mode: 'list' | 'create' | 'get' | 'stale401' | 'current401' = 'list';
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
    return { data: mode === 'list' ? { items: [summary], has_more: true } : detail, status: 200, statusText: 'OK', headers: new AxiosHeaders(), config };
  };
  assert.deepEqual(await listConversations('answer text', 30), { items: [summary], has_more: true });
  mode = 'create';
  assert.deepEqual(await createConversation(), detail);
  mode = 'get';
  assert.deepEqual(await getConversation('one'), detail);
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
