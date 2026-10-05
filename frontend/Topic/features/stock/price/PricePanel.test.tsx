import assert from 'node:assert/strict';
import React from 'react';
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import type { InternalAxiosRequestConfig } from 'axios';
import apiClient from '@/lib/api/client';
import { useStockDashboard, type UseStockDashboardResult } from '@/lib/hooks/useStockDashboard';
import { HistoryTable, PriceChangeTable, StatisticsPanel, VolumeTable } from './PriceTables';

Object.assign(globalThis, {
  React, IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
  cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
});

const quote = (date: string, close = 1000) => ({
  symbol: '2330', date, open: close, high: close + 10, low: close - 10,
  close, change: 5, volume_shares: 1000000, amount: 1000000000, trades: 100,
});
const dates = Array.from({ length: 63 }, (_, index) => {
  const date = new Date('2026-10-02T00:00:00Z');
  date.setUTCDate(date.getUTCDate() - index);
  return date.toISOString().slice(0, 10);
});
const held: Array<() => void> = [];
const requests: InternalAxiosRequestConfig[] = [];
let holdStart: string | null = null;

const responseData = (config: InternalAxiosRequestConfig): unknown => {
  const url = config.url ?? '';
  const params = config.params ?? {};
  const end = params.end_date ?? '2026-10-02';
  const close = end === '2026-10-01' ? 1100 : 1000;
  if (url.endsWith('/latest')) return quote('2026-10-02');
  if (url.endsWith('/date-range')) return { min_date: '2021-01-01', max_date: '2026-10-02' };
  if (url.endsWith('/history')) {
    // The fixed rolling-volume window intentionally does not use start_date.
    if (!params.start_date) return { total: 63, data: dates.slice(0, 60).map((date) => quote(date)) };
    if (params.start_date > '2026-10-02') return { total: 0, data: [] };
    return { total: 63, data: dates.slice(params.skip ?? 0, (params.skip ?? 0) + params.limit).map((date) => quote(date, close)) };
  }
  if (url.endsWith('/chart/candlestick-ma')) return {
    candlestick: [{ date: end, open: close, high: close + 10, low: close - 10, close, volume: 1000000 }],
    dates: [end], moving_averages: {},
  };
  if (url.endsWith('/chart/volume')) return { data: [{ date: end, volume: 1000000, amount: 1000000000, close, change: 5 }] };
  if (url.endsWith('/chart/price-change')) return { data: [{ date: end, close, change: 5, change_percent: 0.5 }] };
  if (url.endsWith('/statistics')) return {
    start_date: params.start_date, end_date: end, highest_price: close + 10, lowest_price: close - 10,
    average_close: close, total_volume: 1000000, total_amount: 1000000000, trading_days: 63,
  };
  if (/\/(institutional-trades|technical-indicators|volume-with-chips)$/.test(url)) return { data: [] };
  throw new Error(`Unexpected fixture request: ${url}`);
};

const previousAdapter = apiClient.defaults.adapter;
apiClient.defaults.adapter = (config) => {
  requests.push(config);
  return new Promise((resolve, reject) => {
    const finish = () => {
      const rangeEndpoint = /\/(chart\/[^/]+|statistics)$/.test(config.url ?? '');
      if (config.params?.start_date > '2026-10-02' && rangeEndpoint) {
        reject(new Error('所選日期區間沒有資料'));
      } else {
        resolve({ config, status: 200, statusText: 'OK', headers: {}, data: responseData(config) });
      }
    };
    if (config.params?.start_date === holdStart) held.push(finish);
    else finish();
  });
};

let dashboard: UseStockDashboardResult;
const current = () => dashboard;
function Harness({ open = true }: { open?: boolean }) {
  dashboard = useStockDashboard('2330');
  return open ? <>
    {!dashboard.chartLoading ? <>
      <VolumeTable data={dashboard.volumeData} />
      {dashboard.showPriceChange ? <PriceChangeTable data={dashboard.priceChangeData} /> : null}
    </> : null}
    {dashboard.statistics ? <StatisticsPanel stats={dashboard.statistics} /> : null}
    <HistoryTable data={dashboard.history} loading={dashboard.historyLoading} error={dashboard.historyError}
      page={dashboard.historyPage} pageSize={dashboard.historyPageSize} onPageChange={dashboard.setHistoryPage} />
  </> : null;
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const text = (node: ReactTestInstance): string => node.children.map((child) => typeof child === 'string' ? child : text(child)).join('');
const historySection = (renderer: ReactTestRenderer) => renderer.root.findAllByType('section').find((node) => String(node.props['aria-label']).startsWith('歷史股價'))!;
const expandButton = (renderer: ReactTestRenderer) => historySection(renderer).findAllByType('button').find((node) => node.props['aria-expanded'] !== undefined)!;
const pageButton = (renderer: ReactTestRenderer, label: string) => historySection(renderer).findAllByType('button').find((node) => text(node) === label)!;
const expanded = (renderer: ReactTestRenderer) => assert.equal(expandButton(renderer).props['aria-expanded'], true);

async function main() {
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(async () => { renderer = create(<Harness />); await flush(); });
    await act(async () => { current().setShowPriceChange(true); await flush(); });
    assert.equal(current().statistics?.average_close, 1000);
    assert.equal(current().priceChangeData?.data[0].date, '2026-10-02');
    assert.ok(renderer!.root.findAllByType('section').some((node) => node.props['aria-label'] === '量能統計（所選日期區間）'));
    assert.ok(renderer!.root.findAllByType('section').some((node) => node.props['aria-label'] === '漲跌明細'));

    // Empty ranges must drop every range-specific result, including after drawer reopen.
    await act(async () => { current().setStartDate('2026-10-03'); current().setEndDate('2026-10-03'); await flush(); });
    assert.equal(current().priceChart, null);
    assert.equal(current().volumeData, null);
    assert.equal(current().priceChangeData, null);
    assert.equal(current().statistics, null);
    assert.equal(current().history?.total, 0);
    assert.ok(current().volumeInsight, 'fixed rolling volume history is still available');
    assert.ok(!renderer!.root.findAllByType('section').some((node) => node.props['aria-label'] === '量能統計（所選日期區間）'));
    assert.ok(!renderer!.root.findAllByType('section').some((node) => node.props['aria-label'] === '漲跌明細'));
    await act(async () => { renderer!.update(<Harness open={false} />); });
    await act(async () => { renderer!.update(<Harness />); });
    assert.equal(current().statistics, null);
    assert.ok(!JSON.stringify(renderer!.toJSON()).includes('平均收盤價'));
    assert.ok(!JSON.stringify(renderer!.toJSON()).includes('2026-10-02'));

    await act(async () => { current().setStartDate('2026-07-01'); current().setEndDate('2026-10-01'); await flush(); });
    assert.equal(current().statistics?.average_close, 1100);
    assert.equal(current().volumeData?.data[0].date, '2026-10-01');
    assert.equal(current().priceChangeData?.data[0].date, '2026-10-01');
    assert.ok(renderer!.root.findAllByType('section').some((node) => node.props['aria-label'] === '量能統計（所選日期區間）'));
    assert.ok(renderer!.root.findAllByType('section').some((node) => node.props['aria-label'] === '漲跌明細'));

    // A late response for range A must never overwrite the current range B.
    holdStart = '2026-09-01';
    await act(async () => { current().setStartDate(holdStart!); await flush(); });
    assert.equal(current().statistics, null);
    assert.equal(current().volumeData, null);
    assert.equal(current().history, null);
    await act(async () => { current().setStartDate('2026-09-15'); await flush(); });
    await act(async () => { held.splice(0).forEach((finish) => finish()); await flush(); });
    holdStart = null;
    assert.equal(current().statistics?.start_date, '2026-09-15');
    assert.ok(requests.filter((request) => request.params?.limit === 60).every((request) => !request.params.start_date));

    // Pagination loading keeps the section and its expanded state, but removes old rows.
    await act(async () => { expandButton(renderer!).props.onClick({ defaultPrevented: false }); });
    expanded(renderer!);
    const next = pageButton(renderer!, '下一頁');
    assert.equal(pageButton(renderer!, '上一頁').props.disabled, true);
    holdStart = '2026-09-15';
    await act(async () => { next.props.onClick(); await flush(); });
    expanded(renderer!);
    assert.equal(current().historyPage, 2);
    assert.equal(current().history?.total, 63);
    assert.deepEqual(current().history?.rows, []);
    assert.equal(pageButton(renderer!, '下一頁'), next, 'retain the pagination button instance');
    assert.equal(next.props.disabled, true);
    await act(async () => { held.splice(0).forEach((finish) => finish()); await flush(); });
    holdStart = null;
    expanded(renderer!);
    assert.equal(current().history?.rows.length, 30);
    assert.equal(current().history?.rows[0].date, dates[30]);
    await act(async () => { pageButton(renderer!, '下一頁').props.onClick(); await flush(); });
    expanded(renderer!);
    assert.equal(current().historyPage, 3);
    assert.equal(current().history?.rows.length, 3);
    assert.equal(pageButton(renderer!, '下一頁').props.disabled, true);
    await act(async () => { pageButton(renderer!, '上一頁').props.onClick(); await flush(); });
    expanded(renderer!);
    assert.equal(current().historyPage, 2);
    await act(async () => { current().setStartDate('2026-09-20'); await flush(); });
    expanded(renderer!);
    assert.equal(current().historyPage, 1);
    assert.equal(pageButton(renderer!, '上一頁').props.disabled, true);
    console.log('PricePanel range, race, drawer and pagination regressions passed');
  } finally {
    await act(async () => { renderer?.unmount(); });
    apiClient.defaults.adapter = previousAdapter;
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
