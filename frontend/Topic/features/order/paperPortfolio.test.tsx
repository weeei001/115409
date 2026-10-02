import assert from 'node:assert/strict';
import React from 'react';
import { AxiosHeaders } from 'axios';
import { renderToStaticMarkup } from 'react-dom/server';
import apiClient from '../../lib/api/client';
import { fetchPaperPortfolio, createPaperOrder, paperMoney, paperDateTime, type PaperOrder } from '../../lib/api/paperPortfolio';
import { isChatAction, isPaperOrderDraftAction } from '../../lib/nav';
import { PaperOrderDraft, PaperOrderStatus } from './PaperOrderDraft';
import { ChatInput } from '../ai/ChatInput';

async function main() {
  const draft = { type: 'paper_order_draft', draft_id: 'stable-draft-id', label: '建立模擬單', symbol: '2330', side: 'buy', budget: 100000, quantity: null, reason: 'Revenue', observation: 'Next report', review_after_days: 20, conversation_id: null } as const;
  assert.equal(isChatAction(draft), true);
  for (const overrides of [{ symbol: '<script>' }, { review_after_days: 251 }, { review_after_days: 0.5 }, { budget: Infinity }, { quantity: 0.5 }, { draft_id: '../bad' }, { side: 'execute' }]) {
    assert.equal(isPaperOrderDraftAction({ ...draft, ...overrides }), false, JSON.stringify(overrides));
  }
  assert.match(renderToStaticMarkup(<PaperOrderDraft initial={draft} requestId={draft.draft_id} />), /登入/);
  const order: PaperOrder = { ...draft, client_request_id: draft.draft_id, id: 'order-one', status: 'pending', filled_quantity: null, fill_price: null, fee: null, tax: null, created_at: '', trade_date: null };
  const pending = renderToStaticMarkup(<PaperOrderStatus order={order} />);
  assert.match(pending, /待成交/);
  assert.doesNotMatch(pending, /已成交|確認建立/);
  const filled = renderToStaticMarkup(<PaperOrderStatus order={{ ...order, status: 'filled', filled_quantity: 100, fill_price: 900, trade_date: '2026-10-02' }} />);
  assert.match(filled, /已成交/);
  assert.match(filled, /100 股/);
  assert.match(renderToStaticMarkup(<PaperOrderStatus order={{ ...order, status: 'cancelled' }} />), /已取消/);
  assert.equal(paperMoney(null), '等待行情');
  assert.equal(paperMoney(0), '0');
  assert.equal(paperMoney(900.5), '900.5', 'Fill prices must preserve cents');
  assert.match(paperDateTime('2026-10-02T00:00:00Z'), /08:00:00/);
  assert.match(renderToStaticMarkup(<ChatInput initialValue="Review my position" onSend={() => { throw new Error('Prefill must not send'); }} disabled={false} />), /Review my position/);

  let calls = 0;
  let release: (() => void) | undefined;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  apiClient.defaults.adapter = async (config) => {
    calls += 1;
    await barrier;
    return { data: { orders: [] }, status: 200, statusText: 'OK', headers: new AxiosHeaders(), config };
  };
  const first = fetchPaperPortfolio();
  const second = fetchPaperPortfolio();
  release!();
  await Promise.all([first, second]);
  assert.equal(calls, 1, 'Concurrent chat cards share one portfolio fetch');
  const sent: unknown[] = [];
  apiClient.defaults.adapter = async (config) => {
    assert.equal(config.method, 'post');
    assert.equal(config.url, '/paper-portfolio/orders');
    sent.push(JSON.parse(config.data));
    return { data: order, status: 200, statusText: 'OK', headers: new AxiosHeaders(), config };
  };
  const { type, draft_id, label, ...body } = draft;
  void type; void label;
  await createPaperOrder(body, draft_id);
  await createPaperOrder(body, draft_id);
  assert.deepEqual(sent[0], sent[1], 'Retries send the same idempotency key and payload');
  assert.equal((sent[0] as { client_request_id: string }).client_request_id, 'stable-draft-id');
  assert.equal('user_id' in (sent[0] as object), false, 'Identity must be supplied by authentication');
  console.log('Paper UI/API passed: untrusted draft validation, login gate, pending/filled/cancelled states, missing prices, passive chat prefill, deduplication, idempotency transport.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
