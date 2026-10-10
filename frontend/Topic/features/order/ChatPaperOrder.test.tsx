import assert from 'node:assert/strict';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import apiClient, { ApiRequestError } from '../../lib/api/client';
import type { PaperOrder, PaperPortfolio } from '../../lib/api/paperPortfolio';
import type { ChatAction, ChatMessage as Message } from '../../lib/types/chat';
import { ChatMessage } from '../ai/ChatMessage';

Object.assign(globalThis, {
  React, IS_REACT_ACT_ENVIRONMENT: true, self: globalThis,
  requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
  cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
});
const values = new Map<string, string>([
  ['topictest_access_token', 'fixture-token'],
  ['topictest_user', JSON.stringify({ id: 7, email: 'fixture@example.test', display_name: 'Fixture' })],
]);
const fakeWindow = new EventTarget();
Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
} });

const action: Extract<ChatAction, { type: 'paper_order_draft' }> = {
  type: 'paper_order_draft', draft_id: 'chat-draft', label: '建立模擬單草稿',
  symbol: '2330', side: 'buy', budget: null, quantity: null,
  reason: 'Research from this discussion', observation: 'Next earnings report',
  review_after_days: 20, conversation_id: 'owned-conversation',
};
const message: Message = {
  id: 'reply', role: 'assistant', content: 'Review the conditions before investing.',
  timestamp: '', status: 'completed', actions: [action],
};
const basePortfolio: PaperPortfolio = {
  initialized: true, total_deposits: 50000, total_withdrawals: 0, net_contributions: 50000,
  total_pnl: 0, fund_movements: [], initial_cash: 50000, cash: 50000, available_cash: 50000,
  reserved_cash: 0, equity: 50000, realized_pnl: 0, unrealized_pnl: 0, as_of: null,
  positions: [], orders: [], reviews: [],
};
let portfolio = basePortfolio;
let failNextOrder = false;
let finishOrder: (() => void) | undefined;
const sent: Array<Record<string, unknown>> = [];
const previousAdapter = apiClient.defaults.adapter;
apiClient.defaults.adapter = async (config) => {
  let data: unknown;
  if (config.url === '/stocks/info') data = [{ symbol: '2330', name: '台積電', industry: null }];
  else if (config.url === '/stocks/2330/latest') data = { close: 1000, date: '2026-10-09' };
  else if (config.url === '/paper-portfolio') data = portfolio;
  else if (config.url === '/paper-portfolio/orders' && config.method === 'post') {
    const body = JSON.parse(config.data) as Record<string, unknown>;
    sent.push(body);
    if (failNextOrder) { failNextOrder = false; throw new ApiRequestError('連線中斷，請重試。'); }
    await new Promise<void>((resolve) => { finishOrder = resolve; });
    data = { ...body, id: 'created-order', status: 'pending', filled_quantity: null,
      fill_price: null, fee: null, tax: null, created_at: '', trade_date: null };
  } else throw new Error(`Unexpected fixture request: ${config.method} ${config.url}`);
  return { data, config, status: 200, statusText: 'OK', headers: {} };
};

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const text = (node: ReactTestInstance): string => node.children.map((child) => typeof child === 'string' ? child : text(child)).join('');
const focused: string[] = [];
const view = (overrides: Partial<Message> = {}, streamActive = false) => <ChatMessage
  message={{ ...message, ...overrides }} reducedMotion streamActive={streamActive} followUpDisabled={false} />;
const button = (renderer: ReactTestRenderer, label: string) => {
  const found = renderer.root.findAllByType('button').find((node) => text(node) === label);
  assert.ok(found, `Missing button: ${label}`);
  return found;
};
const click = async (renderer: ReactTestRenderer, label: string) => {
  await act(async () => { button(renderer, label).props.onClick(); await flush(); });
};
const review = async (renderer: ReactTestRenderer) => {
  await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }); await flush(); });
};

async function main() {
  let renderer: ReactTestRenderer | undefined;
  const mount = async (overrides: Partial<Message> = {}, streaming = false) => {
    await act(async () => {
      renderer = create(view(overrides, streaming), { createNodeMock: (element) => {
        const props = element.props as { type?: string; children?: unknown };
        if (element.type === 'input' && props.type === 'number') return { focus: () => focused.push('amount') };
        if (element.type === 'button' && props.children === '確認送出') return { focus: () => focused.push('confirm') };
        return null;
      } });
      await flush();
    });
  };
  const unmount = async () => { await act(async () => { renderer?.unmount(); }); renderer = undefined; };
  try {
    await mount();
    assert.match(text(renderer!.root), /要為 2330 台積電 建立模擬單嗎？/);
    assert.equal(renderer!.root.findAllByType('form').length, 0);
    assert.equal(sent.length, 0, 'Receiving an AI proposal must not create an order');
    await click(renderer!, '暫時不用');
    assert.match(text(renderer!.root), /這次先不建立模擬單/);
    assert.equal(sent.length, 0, 'Declining must not create an order');
    await click(renderer!, '重新開啟模擬單');
    assert.ok(focused.includes('amount'), 'Opening the draft moves focus to its amount field');
    assert.equal(sent.length, 0, 'Accepting the invitation only opens the editable draft');
    await act(async () => { renderer!.root.findByType('input').props.onChange({ target: { value: '60000' } }); });
    await review(renderer!);
    assert.match(text(renderer!.root), /可用資金不足/);
    assert.equal(sent.length, 0);
    await act(async () => { renderer!.root.findByType('input').props.onChange({ target: { value: '10000' } }); });
    await review(renderer!);
    assert.match(text(renderer!.root), /確認委託內容/);
    assert.match(text(renderer!.root), /Research from this discussion/);
    assert.match(text(renderer!.root), /Next earnings report/);
    assert.ok(focused.includes('confirm'));
    assert.equal(sent.length, 0, 'Reviewing a summary must not create an order');
    await click(renderer!, '返回修改');
    assert.equal(renderer!.root.findAllByType('section').filter((node) => node.props['aria-label'] === '確認委託內容').length, 0);
    await review(renderer!);
    failNextOrder = true;
    await click(renderer!, '確認送出');
    assert.equal(sent.length, 1);
    assert.match(text(renderer!.root), /連線中斷/);
    await review(renderer!);
    await review(renderer!);
    assert.equal(sent.length, 2, 'Repeated submit events must not duplicate the in-flight retry');
    assert.deepEqual(sent[1], sent[0], 'An uncertain result retries the exact payload and request ID');
    assert.equal(sent[0].client_request_id, action.draft_id);
    assert.equal(sent[0].conversation_id, action.conversation_id);
    assert.equal(sent[0].budget, 10000);
    assert.equal(sent[0].quantity, null);
    assert.equal('user_id' in sent[0], false);
    await act(async () => { finishOrder!(); await flush(); });
    assert.match(text(renderer!.root), /待成交/);
    assert.doesNotMatch(text(renderer!.root), /已成交|確認送出|建立模擬單嗎/);
    const created = { ...sent[0], id: 'created-order', status: 'pending', filled_quantity: null,
      fill_price: null, fee: null, tax: null, created_at: '', trade_date: null } as unknown as PaperOrder;
    await unmount();
    portfolio = { ...basePortfolio, orders: [created] };
    await mount();
    assert.match(text(renderer!.root), /待成交/);
    assert.doesNotMatch(text(renderer!.root), /建立模擬單嗎/);
    assert.equal(sent.length, 2, 'Restoring history displays the existing order without another POST');
    await unmount();
    portfolio = { ...basePortfolio, initialized: false };
    await mount();
    await click(renderer!, '建立模擬單');
    assert.match(text(renderer!.root), /先設定想投入的模擬資金/);
    assert.equal(sent.length, 2);
    await unmount();
    for (const status of ['streaming', 'failed', 'interrupted'] as const) {
      await mount({ status }, status === 'streaming');
      assert.doesNotMatch(text(renderer!.root), /建立模擬單嗎/);
      await unmount();
    }
    console.log('Chat paper orders passed: invitation, decline, edit, validation, summary, explicit confirmation, retry, restoration and incomplete-reply gating.');
  } finally {
    await unmount();
    apiClient.defaults.adapter = previousAdapter;
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
