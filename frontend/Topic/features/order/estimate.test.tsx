import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { HistoricalPriceList } from '../../lib/types/api';
import { OrderEstimateContent } from './OrderEstimate';
import { estimateAmount, estimateFromHistory, orderEstimateInput } from './estimate';

const history = (date: string, close: string | null, symbol = '2330'): HistoricalPriceList => ({ symbol, start_date: date, end_date: date, total: 1,
  data: [{ symbol, date, close, open: null, high: null, low: null, change: null, trades: null, volume_shares: null, amount: null }] });
const today = '2026-10-01';
assert.deepEqual(orderEstimateInput('2330', '2026-09-30', '1', today), { symbol: '2330', date: '2026-09-30', lots: 1 });
for (const [symbol, date, quantity] of [['', today, '1'], ['23 30', today, '1'], ['2330', today, ''], ['2330', today, '0'], ['2330', today, '1.5'], ['2330', '2026-02-30', '1'], ['2330', '2026-10-02', '1'], ['2330', today, '9007199254740991']]) {
  assert.ok('reason' in orderEstimateInput(symbol, date, quantity, today));
}
assert.equal(estimateAmount('100.25', 2), 200500);
assert.equal(estimateAmount('100.0005', 1), 100001); // Backend ROUND_HALF_UP fixture.
assert.equal(estimateAmount('100.0004999', 1), 100000);
assert.equal(estimateAmount('0.005', 1), 5);
for (const price of ['0', '-1', 'Infinity', 'NaN', '<script>', '999999999999999999999999']) assert.equal(estimateAmount(price, 1), null);
const state = estimateFromHistory(history('2026-09-30', '2380.00'), '2330', '2026-09-30', 1, today);
assert.deepEqual(state, { kind: 'estimate', price: '2380.00', date: '2026-09-30', lots: 1, shares: 1000, amount: 2380000 });
const markup = renderToStaticMarkup(<OrderEstimateContent state={state} />);
assert.match(markup, /2380.00 TWD／股/);
assert.match(markup, /2026-09-30/);
assert.match(markup, /1 張（1,000 股）/);
assert.match(markup, /2,380,000 TWD/);
assert.match(markup, /不計手續費與交易稅/);
assert.match(markup, /不是即時報價或保證成交值/);
for (const input of [history('2026-09-30', null), history('2026-09-29', '200'), history('2026-09-30', '200', '2317')]) {
  assert.equal(estimateFromHistory(input, '2330', '2026-09-30', 1, today).kind, 'unavailable');
}
const missing = { ...history(today, null), total: 0, data: [] };
assert.match(renderToStaticMarkup(<OrderEstimateContent state={estimateFromHistory(missing, '2330', today, 1, today)} />), /今日尚無可用收盤行情/);
assert.match(renderToStaticMarkup(<OrderEstimateContent state={estimateFromHistory(missing, '2330', '2026-09-27', 1, today)} />), /不會改用其他日期价格|不會改用其他日期價格/);
assert.match(renderToStaticMarkup(<OrderEstimateContent state={{ kind: 'loading' }} />), /aria-busy="true"/);
console.log('Order estimate fixtures passed: exact date/symbol, no fallback, missing/invalid data, integer lots and shares, TWD, safe bounds, and backend decimal rounding.');
