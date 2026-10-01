import assert from 'node:assert/strict';
import { CHAT_SESSION_KEY, MAX_CHAT_SESSION_CHARS, clearChatSession, loadChatSession, saveChatSession } from './session';
import { AUTH_CHANGE_EVENT, clearAuth, isAuthSessionBoundary, setAuth, updateStoredUser } from '../auth/storage';
import type { UserPublic } from '../types';
import type { ChatMessage } from '../types/chat';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  failRead = false;
  failWrite = false;
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { if (this.failRead) throw new Error('Storage disabled'); return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.failWrite) throw new Error('Quota exceeded'); this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
const storage = new MemoryStorage();
const messages: ChatMessage[] = [
  { id: 'u1', role: 'user', content: 'Question', timestamp: '2026-10-01T00:00:00Z' },
  { id: 'a1', role: 'assistant', content: 'Answer[S1]', status: 'completed', timestamp: '2026-10-01T00:00:01Z',
    sources: [{ citation_id: 'S1', title: '# []\nLiteral', content: 'Full evidence', stock_id: '2330', pub_time: '', category: 'news', article_id: 'article/one' }],
    dashboard: { title: 'Data', blocks: [{ kind: 'metrics', title: 'Stock', description: '', source_ids: ['S1'], items: [{ label: 'Close', value: 100, unit: 'TWD', date: '2026-09-30' }] }] },
    actions: [{ type: 'follow_up', label: 'More', query: 'More information' }] },
];
assert.equal(saveChatSession('user:1', messages, storage).saved, true);
assert.deepEqual(loadChatSession('user:1', storage).messages, messages);
for (const status of ['failed', 'interrupted', 'streaming'] as const) {
  const input = [messages[0], { ...messages[1], status, error: status === 'failed' ? 'Failure' : undefined }];
  saveChatSession('user:1', input, storage);
  const restored = loadChatSession('user:1', storage).messages[1];
  assert.equal(restored.status, status === 'streaming' ? 'interrupted' : status);
  assert.equal(restored.content, input[1].content);
  assert.deepEqual(restored.sources, input[1].sources);
  assert.deepEqual(restored.dashboard, input[1].dashboard);
}
const privateValue = 'DO_NOT_CACHE_AUTH_VALUE';
const injected = JSON.parse(JSON.stringify(messages));
injected[1].token = privateValue;
injected[1].sources[0].api_key = privateValue;
injected[1].dashboard.blocks[0].api_key = privateValue;
injected[1].dashboard.blocks[0].items[0].password = privateValue;
injected[1].actions[0].token = privateValue;
injected[1].streamStatus = privateValue;
saveChatSession('user:1', injected, storage);
assert.ok(!storage.getItem(CHAT_SESSION_KEY)!.includes(privateValue));
assert.deepEqual(loadChatSession('user:1', storage).messages, messages);

for (const raw of ['{bad', 'x'.repeat(MAX_CHAT_SESSION_CHARS + 1),
  JSON.stringify({ version: 2, owner: 'user:1', messages }),
  JSON.stringify({ version: 1, owner: 'user:2', messages }),
  JSON.stringify({ version: 1, owner: 'user:1', messages: [messages[0], { ...messages[1], status: 'unknown' }] }),
  JSON.stringify({ version: 1, owner: 'user:1', messages: [messages[0], messages[0]] })]) {
  storage.setItem(CHAT_SESSION_KEY, raw);
  assert.deepEqual(loadChatSession('user:1', storage).messages, []);
  assert.equal(storage.getItem(CHAT_SESSION_KEY), null);
}
const many = Array.from({ length: 60 }, (_, index) => messages.map((message) => ({ ...message, id: `${message.id}-${index}`, content: 'x'.repeat(12_000) }))).flat();
assert.equal(saveChatSession('user:1', many, storage).trimmed, true);
const recent = loadChatSession('user:1', storage).messages;
assert.equal(recent[0].role, 'user');
assert.equal(recent.length % 2, 0);
assert.equal(recent.at(-1)?.id, many.at(-1)?.id);
assert.ok(storage.getItem(CHAT_SESSION_KEY)!.length <= MAX_CHAT_SESSION_CHARS);
assert.equal(saveChatSession('user:1', [messages[0], { ...messages[1], content: 'x'.repeat(MAX_CHAT_SESSION_CHARS) }], storage).saved, false);
assert.equal(storage.getItem(CHAT_SESSION_KEY), null);
storage.failWrite = true;
assert.equal(saveChatSession('user:1', messages, storage).saved, false);
storage.failWrite = false;
storage.failRead = true;
assert.equal(loadChatSession('user:1', storage).available, false);
storage.failRead = false;
assert.equal(saveChatSession('user:1', messages, null).saved, false);
assert.equal(loadChatSession('user:1', null).available, false);
clearChatSession(storage);

// All account operations here target fake browser storage, never real accounts.
const local = new MemoryStorage();
const fakeWindow = Object.assign(new EventTarget(), { sessionStorage: storage, localStorage: local });
let logoutEvent = false;
fakeWindow.addEventListener(AUTH_CHANGE_EVENT, (event) => { logoutEvent = Boolean((event as CustomEvent).detail?.logout); });
Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local });
const user = (id: number): UserPublic => ({ id, email: `fixture-${id}@example.com`, display_name: 'Fixture' });
setAuth('fixture-token', user(1));
saveChatSession('user:1', messages);
setAuth('new-fixture-token', user(1));
assert.ok(storage.getItem(CHAT_SESSION_KEY));
updateStoredUser({ ...user(1), display_name: 'New name' });
assert.ok(storage.getItem(CHAT_SESSION_KEY));
assert.equal(logoutEvent, false);
setAuth('fixture-token-2', user(2));
assert.equal(storage.getItem(CHAT_SESSION_KEY), null);
saveChatSession('user:2', messages);
clearAuth();
assert.equal(storage.getItem(CHAT_SESSION_KEY), null);
assert.equal(logoutEvent, true);
setAuth('fixture-token', user(2));
assert.deepEqual(loadChatSession('user:2').messages, []);
assert.equal(isAuthSessionBoundary({ key: 'topictest_access_token', oldValue: 'fixture-token', newValue: null }), true);
assert.equal(isAuthSessionBoundary({ key: 'topictest_access_token', oldValue: 'fixture-token', newValue: 'refreshed' }), false);
assert.equal(isAuthSessionBoundary({ key: 'topictest_user', oldValue: JSON.stringify(user(1)), newValue: JSON.stringify(user(2)) }), true);
assert.equal(isAuthSessionBoundary({ key: 'topictest_user', oldValue: JSON.stringify(user(1)), newValue: JSON.stringify({ ...user(1), display_name: 'Updated' }) }), false);
assert.equal(isAuthSessionBoundary({ key: null, oldValue: null, newValue: null }), true);
console.log('Chat session fixtures passed: restore/statuses, literal sources/panels, field whitelist, corruption/version/owner/size limits, quota failures, whole-turn trimming, and account clearing.');
