import assert from 'node:assert/strict';
import type { InternalAxiosRequestConfig } from 'axios';
import apiClient from './client';
import {
  fetchCandlestickMA,
  fetchDateRange,
  fetchHistory,
  fetchInstitutionalTrades,
  fetchLatestPrice,
  fetchMultipleStocks,
  fetchPriceChange,
  fetchStatistics,
  fetchTechnicalIndicators,
  fetchVolume,
  fetchVolumeWithChips,
} from './stock';

async function main() {
  const start = '2026-09-01';
  const end = '2026-10-01';
  const requests: InternalAxiosRequestConfig[] = [];
  const fixture = { fixture: 'stock-response' };
  const originalAdapter = apiClient.defaults.adapter;
  apiClient.defaults.adapter = async (config) => {
    requests.push(config);
    return { data: fixture, status: 200, statusText: 'OK', headers: {}, config };
  };
  const endpoints: Array<[string, (symbol: string) => Promise<unknown>]> = [
    ['latest', fetchLatestPrice],
    ['date-range', fetchDateRange],
    ['history', (symbol) => fetchHistory(symbol, { start_date: start, end_date: end, skip: 30, limit: 30 })],
    ['chart/candlestick-ma', (symbol) => fetchCandlestickMA(symbol, start, end, '5,10,20')],
    ['chart/volume', (symbol) => fetchVolume(symbol, start, end)],
    ['chart/price-change', (symbol) => fetchPriceChange(symbol, start, end)],
    ['statistics', (symbol) => fetchStatistics(symbol, start, end)],
    ['institutional-trades', (symbol) => fetchInstitutionalTrades(symbol, start, end)],
    ['technical-indicators', (symbol) => fetchTechnicalIndicators(symbol, start, end)],
    ['volume-with-chips', (symbol) => fetchVolumeWithChips(symbol, start, end)],
  ];
  try {
    for (const symbol of ['2330', '0050', '00632R', 'TAIEX', 'ABCDEFGHIJ']) {
      for (const [endpoint, fetch] of endpoints) {
        assert.equal(await fetch(symbol), fixture);
        const config = requests.at(-1)!;
        assert.equal(config.url, `/stocks/${symbol}/${endpoint}`);
        assert.equal(new URL(config.url!, config.baseURL).origin, new URL(config.baseURL!).origin);
      }
    }
    const beforeInvalid = requests.length;
    for (const symbol of [
      '', '.', '..', '../admin', '2330/../../admin', '2330?url=https://outside.test', '2330#fragment',
      '//outside.test', 'https://outside.test', '\\outside.test', '2330%2f..', '2330%252f..',
      ' 2330', '2330 ', '股票', 'ABCDEFGHIJK', '2330\u0000',
    ]) {
      for (const [, fetch] of endpoints) await assert.rejects(fetch(symbol), /Invalid stock symbol/);
    }
    assert.equal(requests.length, beforeInvalid, 'Invalid identifiers must fail before any request is dispatched.');

    const controller = new AbortController();
    await fetchLatestPrice('2330', { signal: controller.signal });
    assert.equal(requests.at(-1)!.signal, controller.signal);
    await fetchHistory('2330', { start_date: start, end_date: end, skip: 30, limit: 30 }, { signal: controller.signal });
    assert.equal(requests.at(-1)!.signal, controller.signal);
    assert.deepEqual(requests.at(-1)!.params, { start_date: start, end_date: end, skip: 30, limit: 30 });
    await fetchCandlestickMA('2330', start, end, '5,10,20');
    assert.deepEqual(requests.at(-1)!.params, { start_date: start, end_date: end, ma_periods: '5,10,20' });
    await fetchMultipleStocks('2330,0050', start, end);
    assert.equal(requests.at(-1)!.url, '/stocks/compare/multiple');
    assert.deepEqual(requests.at(-1)!.params, { symbols: '2330,0050', start_date: start, end_date: end });
  } finally {
    apiClient.defaults.adapter = originalAdapter;
  }
  console.log('Stock API identifiers preserve supported symbols and cannot change request paths or origins.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
