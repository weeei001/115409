import assert from 'node:assert/strict';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import apiClient from '../../lib/api/client';
import { AUTH_CHANGE_EVENT } from '../../lib/auth/storage';
import { useChat } from './useChat';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
const values = new Map<string, string>([
  ['topictest_access_token', 'fixture-token'],
  ['topictest_user', JSON.stringify({ id: 7 })],
]);
const fakeWindow = Object.assign(new EventTarget(), {
  setTimeout, clearTimeout,
  requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
  cancelAnimationFrame: clearTimeout,
});
Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => values.get(key) ?? null,
} });

let state: ReturnType<typeof useChat>;
function Harness() { state = useChat(); return null; }
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const encoder = new TextEncoder();
const apiRequests: Array<{ method?: string; url?: string }> = [];
let historyMessages: Array<Record<string, unknown>> = [];
const previousAdapter = apiClient.defaults.adapter;
const previousFetch = globalThis.fetch;
apiClient.defaults.adapter = async (config) => {
  apiRequests.push({ method: config.method, url: config.url });
  let data: unknown;
  if (config.url === '/api/conversations' && config.method === 'post') data = { id: 'conversation', messages: [] };
  else if (config.url === '/api/conversations' && config.method === 'get') data = { items: [], has_more: false };
  else if (config.url === '/api/conversations/conversation' && config.method === 'get') data = { id: 'conversation', messages: historyMessages };
  else if (config.url?.endsWith('/feedback')) data = { message_id: config.url.split('/').at(-2), rating: 'up' };
  else throw new Error(`Unexpected request: ${config.method} ${config.url}`);
  return { data, config, status: 200, statusText: 'OK', headers: {} };
};
let streamRequest: RequestInit | undefined;
let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
const streamingFetch = async (_url: string | URL | Request, options?: RequestInit) => {
  streamRequest = options;
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      options?.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
    },
  }));
};
const event = (value: Record<string, unknown>) => streamController!.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
const completedFetch = (messageId?: string) => async () => new Response(
  `data: ${JSON.stringify({ type: 'done', answer: 'Completed answer', actions: [], ...(messageId ? { message_id: messageId } : {}) })}\n\n`,
);

async function main() {
  let renderer: ReactTestRenderer | undefined;
  const feedbackCount = () => apiRequests.filter((request) => request.url?.endsWith('/feedback')).length;
  try {
    await act(async () => { renderer = create(<Harness />); await flush(); });
    assert.equal(state!.signedIn, true);
    globalThis.fetch = completedFetch('saved-first');
    await act(async () => { await state!.send('First'); await flush(); });
    const first = state!.messages.at(-1)!;
    assert.equal(first.status, 'completed');
    assert.equal(first.serverId, 'saved-first');
    assert.equal(apiRequests.filter((request) => request.method === 'get' && request.url === '/api/conversations/conversation').length, 0,
      'Completing a reply must not refetch all conversation messages');
    await act(async () => { await state!.rate(first.id, 'up'); });
    assert.equal(apiRequests.at(-1)!.url, '/api/conversations/conversation/messages/saved-first/feedback');

    globalThis.fetch = completedFetch('saved-second');
    await act(async () => { await state!.send('Second'); });
    assert.deepEqual(state!.messages.filter((message) => message.role === 'assistant').map((message) => message.serverId), ['saved-first', 'saved-second'],
      'Each local answer receives its own acknowledgment, regardless of later turns');

    globalThis.fetch = completedFetch();
    await act(async () => { await state!.send('Unsaved legacy reply'); });
    const unsaved = state!.messages.at(-1)!;
    assert.equal(unsaved.status, 'completed');
    assert.equal(unsaved.serverId, undefined);
    const ratedBeforeUnsaved = feedbackCount();
    await act(async () => { await state!.rate(unsaved.id, 'up'); });
    assert.equal(feedbackCount(), ratedBeforeUnsaved, 'Completion without a saved ID cannot be rated');

    globalThis.fetch = streamingFetch;
    let pending: Promise<void>;
    await act(async () => { pending = state!.send('Cancel'); await flush(); event({ type: 'text', content: 'Partial' }); await flush(); });
    const cancelledId = state!.messages.at(-1)!.id;
    await act(async () => { state!.stop(); await pending!; await flush(); });
    assert.equal(streamRequest?.signal?.aborted, true);
    assert.equal(state!.messages.at(-1)!.status, 'interrupted');
    assert.equal(state!.messages.at(-1)!.serverId, undefined);
    await act(async () => { await state!.rate(cancelledId, 'up'); });
    assert.equal(feedbackCount(), ratedBeforeUnsaved);

    historyMessages = [{ id: 'failed-saved', role: 'assistant', content: 'Failed', status: 'failed' }];
    await act(async () => { await state!.openConversation('conversation'); await state!.rate('failed-saved', 'up'); });
    assert.equal(feedbackCount(), ratedBeforeUnsaved, 'A persisted incomplete reply is not rateable');

    let deliverOldResponse: (response: Response) => void;
    globalThis.fetch = async () => new Promise<Response>((resolve) => { deliverOldResponse = resolve; });
    await act(async () => { pending = state!.send('Old account'); await flush(); });
    await act(async () => {
      values.set('topictest_access_token', 'second-token');
      values.set('topictest_user', JSON.stringify({ id: 8 }));
      fakeWindow.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
      deliverOldResponse!(new Response('data: {"type":"done","answer":"Late answer","message_id":"stale-saved"}\n\n'));
      await pending!;
      await flush();
    });
    assert.equal(state!.messages.length, 0, 'An account boundary clears the old reply and ignores its completion');
    await act(async () => { await state!.rate(first.id, 'up'); });
    assert.equal(feedbackCount(), ratedBeforeUnsaved);

    globalThis.fetch = completedFetch('current-account-message');
    await act(async () => { await state!.send('Current account'); });
    const currentReply = state!.messages.at(-1)!;
    values.set('topictest_user', JSON.stringify({ id: 9 }));
    await act(async () => { await state!.rate(currentReply.id, 'up'); });
    assert.equal(state!.messages.length, 0);
    assert.equal(feedbackCount(), ratedBeforeUnsaved, 'An unsignaled account change is checked before submitting feedback');

    await act(async () => {
      values.delete('topictest_access_token');
      fakeWindow.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
    });
    globalThis.fetch = completedFetch('untrusted-guest-id');
    await act(async () => { await state!.send('Guest'); });
    assert.equal(state!.messages.at(-1)!.status, 'completed');
    assert.equal(state!.messages.at(-1)!.serverId, undefined, 'Guest replies retain completion without persisted metadata');
    assert.equal(state!.conversationId, null);
    console.log('Chat hook passed: saved IDs, zero completion history fetches, per-turn association, unsaved/interrupted feedback gating and account isolation.');
  } finally {
    await act(async () => { renderer?.unmount(); });
    apiClient.defaults.adapter = previousAdapter;
    globalThis.fetch = previousFetch;
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
