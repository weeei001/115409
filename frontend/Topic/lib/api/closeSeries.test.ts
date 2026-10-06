import assert from 'node:assert/strict';
import type { InternalAxiosRequestConfig } from 'axios';
import apiClient from './client';
import { CLOSE_SERIES_BATCH, closeChange, closeSeriesFromMultiStock, fetchCloseSeries, lastCloseChange } from './closeSeries';

// 首頁觀測清單與收藏清單共用：每檔一條由舊到新的收盤序列，只看這一檔有收盤的日子（P1-29）
const series = closeSeriesFromMultiStock({
  symbols: ['2330', '2317', '9999'],
  data: [
    { date: '2026-10-02', prices: { '2330': 1460, '2317': 210, '9999': null } },
    { date: '2026-09-30', prices: { '2330': 1440, '2317': 212, '9999': null } },
    { date: '2026-10-01', prices: { '2330': 1450, '2317': null, '9999': null } },
  ],
});
assert.deepEqual(series['2330'], { closes: [1440, 1450, 1460], date: '2026-10-02' }, 'Days are sorted old to new');
assert.deepEqual(series['2317'], { closes: [212, 210], date: '2026-10-02' }, 'A gap day is skipped, not filled');
assert.deepEqual(series['9999'], { closes: [], date: null });

// 最後兩筆收盤 → 收盤、漲跌、漲跌幅
assert.deepEqual(lastCloseChange([1440, 1450, 1460]), { close: 1460, change: 10, changePercent: (10 / 1450) * 100 });
assert.deepEqual(lastCloseChange([212, 210]), { close: 210, change: -2, changePercent: (-2 / 212) * 100 });
assert.deepEqual(lastCloseChange([100]), { close: 100, change: null, changePercent: null });
assert.deepEqual(lastCloseChange([]), { close: null, change: null, changePercent: null });
assert.deepEqual(closeChange(5, 0), { change: 5, changePercent: null }, 'No percent against a zero previous close');
assert.deepEqual(closeChange(5, null), { change: null, changePercent: null });

async function main() {
  const requests: InternalAxiosRequestConfig[] = [];
  /** 含這些代號的批次請求失敗（沒有 response 的錯誤，client 原樣丟出） */
  let failing = new Set<string>();
  const originalAdapter = apiClient.defaults.adapter;
  apiClient.defaults.adapter = async (config) => {
    requests.push(config);
    const symbols = String(config.params.symbols).split(',');
    if (symbols.some((symbol) => failing.has(symbol))) throw new Error(`batch failed: ${symbols[0]}`);
    const data = [
      { date: '2026-10-02', prices: Object.fromEntries(symbols.map((symbol, i) => [symbol, 100 + i])) },
      { date: '2026-10-01', prices: Object.fromEntries(symbols.map((symbol) => [symbol, 100])) },
    ];
    return { data: { start_date: config.params.start_date, end_date: config.params.end_date, symbols, data }, status: 200, statusText: 'OK', headers: {}, config };
  };
  const symbols = Array.from({ length: 23 }, (_, i) => String(1000 + i));
  try {
    // 每 10 檔一次請求，順序不變
    const all = await fetchCloseSeries(symbols, '2026-09-01', '2026-10-02', 'test-all');
    assert.equal(CLOSE_SERIES_BATCH, 10);
    assert.equal(requests.length, 3);
    assert.deepEqual(requests.map((r) => r.url), Array(3).fill('/stocks/compare/multiple'));
    assert.deepEqual(requests.map((r) => r.params.symbols), [symbols.slice(0, 10), symbols.slice(10, 20), symbols.slice(20)].map((g) => g.join(',')));
    assert.ok(requests.every((r) => r.params.start_date === '2026-09-01' && r.params.end_date === '2026-10-02'));
    assert.deepEqual(Object.keys(all).sort(), symbols);
    assert.deepEqual(all['1011'], { closes: [100, 101], date: '2026-10-02' });

    // 同一組請求 60 秒內共用結果，不重抓
    await fetchCloseSeries(symbols, '2026-09-01', '2026-10-02', 'test-all');
    assert.equal(requests.length, 3);

    // 部分批次失敗：其他批次照常回傳，失敗那批的股票不在結果裡
    requests.length = 0;
    failing = new Set(['1010']);
    const partial = await fetchCloseSeries(symbols, '2026-09-01', '2026-10-02', 'test-partial');
    assert.equal(requests.length, 3);
    assert.deepEqual(Object.keys(partial).sort(), [...symbols.slice(0, 10), ...symbols.slice(20)]);

    // 全部批次失敗：丟出第一批的錯誤
    failing = new Set(symbols);
    await assert.rejects(fetchCloseSeries(symbols, '2026-09-01', '2026-10-02', 'test-failed'), /batch failed: 1000/);

    // 沒有代號：不發請求
    requests.length = 0;
    assert.deepEqual(await fetchCloseSeries([], '2026-09-01', '2026-10-02', 'test-empty'), {});
    assert.equal(requests.length, 0);
  } finally {
    apiClient.defaults.adapter = originalAdapter;
  }
  console.log('Close series checks passed: 10-symbol batches, last two closes, partial failure tolerated, all-failed throws.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
