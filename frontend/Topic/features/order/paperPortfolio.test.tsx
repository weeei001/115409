import assert from 'node:assert/strict';
import { AxiosHeaders } from 'axios';
import { renderToStaticMarkup } from 'react-dom/server';
import apiClient from '../../lib/api/client';
import { fetchPaperPortfolio, changePaperFunds, createPaperOrder, estimatePaperBuy, estimatePaperSell, paperMoney, paperMoneyWithUnit, paperDateTime, positionReturnPct, PAPER_PORTFOLIO_PROMPT, type PaperOrder } from '../../lib/api/paperPortfolio';
import { isChatAction, isPaperOrderDraftAction } from '../../lib/nav';
import { PaperOrderDraft, PaperOrderStatus, paperEstimateText } from './PaperOrderDraft';
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
  const funds: unknown[] = [];
  apiClient.defaults.adapter = async (config) => {
    assert.equal(config.method, 'post');
    assert.equal(config.url, '/paper-portfolio/funds');
    funds.push(JSON.parse(config.data));
    return { data: { initialized: true, available_cash: 30000 }, status: 200, statusText: 'OK', headers: new AxiosHeaders(), config };
  };
  await changePaperFunds('initial', 30000, 'setup-budget');
  await changePaperFunds('initial', 30000, 'setup-budget');
  await changePaperFunds('withdrawal', 0.01, 'withdraw-cent');
  assert.deepEqual(funds[0], funds[1], 'Fund retries preserve their request identity');
  assert.deepEqual(funds[2], { kind: 'withdrawal', amount: 0.01, client_request_id: 'withdraw-cent' });
  assert.equal('user_id' in (funds[0] as object), false);
  // P1-30：和後端成交規則同一套估算（手續費到分、扣費後買得起的整數股）
  assert.deepEqual(estimatePaperBuy(10000, 1460), { quantity: 6, fee: 12.48, cost: 8772.48 });
  assert.equal(estimatePaperBuy(123, 2500)?.quantity, 0, 'A budget below one share buys nothing');
  assert.equal(estimatePaperBuy(1000.0, 999)?.quantity, 0, 'The fee is included: 999 + 1.42 > 1000');
  assert.equal(estimatePaperBuy(1001.43, 999)?.quantity, 1);
  assert.equal(estimatePaperBuy(0, 100), null);
  assert.deepEqual(estimatePaperSell(100, 900), { fee: 128.25, tax: 270, proceeds: 89601.75 });
  assert.equal(estimatePaperSell(0.5, 900), null);
  const reference = { close: 2500, date: '2026-10-02' };
  assert.equal(paperEstimateText('buy', 123, reference)?.tone, 'warning');
  assert.match(paperEstimateText('buy', 123, reference)?.text ?? '', /買不到 1 股/);
  assert.match(paperEstimateText('buy', 10000, { close: 1460, date: '2026-10-02' })?.text ?? '', /約 6 股，手續費約 12\.48 元/);
  assert.match(paperEstimateText('sell', 100, { close: 900, date: '2026-10-02' })?.text ?? '', /約可拿回 89,601\.75 元/);
  assert.equal(paperEstimateText('buy', 100, { close: null, date: null }), null);
  // P2-119：持股報酬率；P2-124：缺值不接「元」
  assert.equal(positionReturnPct({ quantity: 370, average_cost: 1207.5, unrealized_pnl: -92025 })?.toFixed(2), '-20.60');
  assert.equal(positionReturnPct({ quantity: 10, average_cost: 100, unrealized_pnl: null }), null);
  assert.equal(paperMoneyWithUnit(null), '等待行情');
  assert.equal(paperMoneyWithUnit(1234.5), '1,234.5 元');
  // P1-32：預設問題只請 AI 整理，不請它安排投資
  assert.ok(!/下一步投資安排|建議|買賣/.test(PAPER_PORTFOLIO_PROMPT));
  // P2-128：登入連結說清楚會到模擬投資頁
  assert.match(renderToStaticMarkup(<PaperOrderDraft initial={draft} requestId={draft.draft_id} />), /登入後前往模擬投資/);
  console.log('Paper UI/API passed: untrusted draft validation, login gate, pending/filled/cancelled states, missing prices, passive chat prefill, deduplication, idempotency transport.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
