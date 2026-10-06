import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterContext } from 'next/dist/shared/lib/router-context.shared-runtime';
import type { NextRouter } from 'next/router';
import { SiteHeader } from './SiteHeader';
import { SiteFooter } from './SiteFooter';
import { Breadcrumbs } from './Breadcrumbs';
import { LightGlyph } from '../common/Ledger';
import { isNavPathActive } from '../../lib/nav';
import { bulkSearchTarget, compareHref, parseCompareQuery } from '../../lib/utils/compareQuery';

const router = (pathname: string) => ({
  route: pathname,
  pathname,
  asPath: pathname,
  query: {},
  isReady: true,
  events: { on() {}, off() {}, emit() {} },
  push: async () => true,
  replace: async () => true,
  prefetch: async () => {},
  back() {},
  beforePopState() {},
}) as unknown as NextRouter;

const render = (node: React.ReactElement, path = '/favorites') =>
  renderToStaticMarkup(<RouterContext.Provider value={router(path)}>{node}</RouterContext.Provider>);

// P1-19：1024 以下的子頁頁首有搜尋鈕（lg 以上用頁首搜尋框）
{
  const html = render(<SiteHeader title="收藏股" />);
  const button = html.match(/<button[^>]*aria-label="搜尋股票"[^>]*>/)?.[0];
  assert.ok(button, 'Sub-page header must offer a stock search button on small screens');
  assert.match(button, /lg:hidden/);
  assert.match(button, /aria-expanded="false"/);
  assert.ok(!html.includes('換班'), 'Theme toggle copy no longer uses the shift metaphor');
}

// P2-055／P2-056：頁尾標出目前頁，連結填滿格子
{
  const html = render(<SiteFooter />, '/favorites');
  const current = html.match(/<a[^>]*aria-current="page"[^>]*>([^<]*)<\/a>/);
  assert.equal(current?.[1], '收藏股');
  assert.equal(html.split('aria-current="page"').length, 2, 'Only the current page is marked');
  assert.match(current?.[0] ?? '', /w-full/);
  // P2-057～P2-059 文案
  assert.ok(html.includes('交易與決策紀錄存在你的帳號裡'));
  assert.ok(html.includes('收盤日載入中 · 非即時'));
  assert.ok(html.includes('加權指數（不含息）') && !html.includes('TWSE'));
  assert.ok(!render(<SiteFooter />, '/stock/2330').includes('aria-current="page"'), 'Pages outside the footer nav mark nothing');
}

assert.equal(isNavPathActive('/', '/'), true);
assert.equal(isNavPathActive('/', '/favorites'), false);
assert.equal(isNavPathActive('/order', '/order'), true);
assert.equal(isNavPathActive('/order', '/orders'), false);

// P2-056：麵包屑連結至少 44 寬
{
  const html = render(<Breadcrumbs items={[{ label: '首頁', href: '/' }, { label: '收藏股' }]} />);
  assert.match(html.match(/<a[^>]*>首頁<\/a>/)?.[0] ?? '', /min-w-11/);
}

// P2-061：燈質記號念出資料狀態
assert.match(renderToStaticMarkup(<LightGlyph state="loading" />), /aria-label="載入中"/);
assert.match(renderToStaticMarkup(<LightGlyph state="ready" />), /aria-label="已載入"/);
assert.match(renderToStaticMarkup(<LightGlyph state="error" />), /aria-label="載入失敗"/);

// P2-062：頁首與首頁搜尋貼上多個代號 → 比較頁帶入全部；一檔 → 個股頁
{
  const known = ['2330', '2317', '2454'];
  assert.equal(bulkSearchTarget('2330 2317,9999', known), '/compare?s=2330,2317');
  assert.equal(bulkSearchTarget('2330；2330', known), '/stock/2330');
  assert.equal(bulkSearchTarget('9999 abc', known), null);
  assert.deepEqual(parseCompareQuery({ s: compareHref(['2330', '2317']).split('s=')[1] }, known), { symbols: ['2330', '2317'], startDate: null, endDate: null });
}

console.log('Header, footer and nav chrome tests passed.');
