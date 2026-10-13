import assert from 'node:assert/strict';
import React, { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import apiClient from '../../../lib/api/client';
import { FavoritesProvider, useFavorites } from '../../../lib/favorites/FavoritesContext';
import { useTerminalData } from './useTerminalData';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (key: string) => key === 'topictest_access_token' ? 'fixture-token' : null },
});

let state: ReturnType<typeof useTerminalData>;
let favorites: ReturnType<typeof useFavorites>;
let screenUpdates = 0;
function Harness() {
  state = useTerminalData();
  favorites = useFavorites();
  useEffect(() => { screenUpdates += 1; }, [state.board, state.monitor]);
  return null;
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const pendingQuotes: Array<() => void> = [];
let benchmarkClose = 22_010;
const previousAdapter = apiClient.defaults.adapter;
apiClient.defaults.adapter = async (config) => {
  let data: unknown;
  if (config.url === '/stocks/info') {
    data = [
      { symbol: '2330', name: 'TSMC', industry: 'Semiconductors' },
      { symbol: '2317', name: 'Hon Hai', industry: 'Electronics' },
    ];
  } else if (config.url === '/stocks/benchmark/history') {
    data = { data: [{ date: '2026-10-08', close: 22_000 }, { date: '2026-10-09', close: benchmarkClose }] };
  } else if (config.url === '/stocks/compare/multiple') {
    data = {
      symbols: ['2330', '2317'],
      data: [
        { date: '2026-10-08', prices: { '2330': 1_000, '2317': 200 } },
        { date: '2026-10-09', prices: { '2330': 1_010, '2317': 202 } },
      ],
    };
  } else if (config.url === '/favorites/') {
    data = { items: [] };
  } else if (config.url === '/favorites/2317' && config.method === 'put') {
    data = { symbol: '2317', name: 'Hon Hai', created_at: '2026-10-09T00:00:00Z' };
  } else if (config.url?.endsWith('/latest')) {
    await new Promise<void>((resolve) => pendingQuotes.push(resolve));
    data = { symbol: config.url.split('/')[2], date: '2026-10-09', close: 1_010 };
  } else if (config.url?.endsWith('/chart/candlestick-ma')) {
    data = { candlestick: [] };
  } else if (config.url?.endsWith('/statistics')) {
    data = {};
  } else if (/\/(institutional-trades|technical-indicators|volume-with-chips)$/.test(config.url ?? '')) {
    data = { data: [] };
  } else {
    throw new Error(`Unexpected request: ${config.method} ${config.url}`);
  }
  return { data, config, status: 200, statusText: 'OK', headers: {} };
};

async function main() {
  let renderer: ReactTestRenderer | undefined;
  const previousNow = Date.now;
  try {
    await act(async () => { renderer = create(<FavoritesProvider><Harness /></FavoritesProvider>); await flush(); });
    await act(async () => { await flush(); });
    assert.equal(state!.board?.close, 22_010);
    assert.equal(state!.monitor?.symbol, '2330');
    assert.equal(state!.quote.status, 'loading');
    const board = state!.board;
    const monitor = state!.monitor;
    const updates = screenUpdates;

    await act(async () => { pendingQuotes.splice(0).forEach((resolve) => resolve()); await flush(); });
    assert.equal(state!.quote.status, 'ready');
    assert.strictEqual(state!.board, board, 'Independent panel responses preserve the board texture input');
    assert.strictEqual(state!.monitor, monitor);

    await act(async () => { state!.select('2330'); state!.setRange('6M'); await flush(); });
    await act(async () => { await favorites!.add('2317'); await flush(); });
    assert.equal(state!.watchRows.find((row) => row.symbol === '2317')?.favorite, true);
    assert.strictEqual(state!.monitor, monitor, 'Favorite changes preserve the selected monitor texture input');
    assert.equal(screenUpdates, updates, 'Unrelated terminal state must not repaint the 3D screen textures');

    const refreshedAt = previousNow() + 61_000;
    Date.now = () => refreshedAt;
    await act(async () => { state!.boardState.reload(); await flush(); });
    assert.strictEqual(state!.board, board, 'An unchanged benchmark response preserves the board texture input');
    assert.equal(screenUpdates, updates);

    benchmarkClose = 22_020;
    Date.now = () => refreshedAt + 61_000;
    await act(async () => { state!.boardState.reload(); await flush(); });
    assert.equal(state!.board?.close, 22_020);
    assert.notStrictEqual(state!.board, board, 'Changed benchmark values still reach the 3D screen');
    assert.equal(screenUpdates, updates + 1);

    await act(async () => { state!.select('2317'); await flush(); });
    assert.equal(state!.monitor?.symbol, '2317');
    assert.deepEqual(state!.monitor?.closes, [200, 202]);
    assert.equal(screenUpdates, updates + 2, 'Changing the selected stock updates its 3D screen');
    console.log('Terminal screen data identity tests passed');
  } finally {
    await act(async () => { renderer?.unmount(); pendingQuotes.splice(0).forEach((resolve) => resolve()); await flush(); });
    apiClient.defaults.adapter = previousAdapter;
    Date.now = previousNow;
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
