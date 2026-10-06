import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterContext } from 'next/dist/shared/lib/router-context.shared-runtime';
import type { NextRouter } from 'next/router';
import { SiteHeader } from './SiteHeader';
import { MAIN_CONTENT_ID } from './MainContentAnchor';

const router = {
  route: '/favorites',
  pathname: '/favorites',
  asPath: '/favorites',
  query: {},
  isReady: true,
  events: { on() {}, off() {}, emit() {} },
  push: async () => true,
  replace: async () => true,
  prefetch: async () => {},
  back() {},
} as unknown as NextRouter;

const html = renderToStaticMarkup(
  <RouterContext.Provider value={router}>
    <SiteHeader title="收藏股" subtitle="收藏清單" />
    <main>內容</main>
  </RouterContext.Provider>,
);

// 「跳至主要內容」的落點在整個頁首（sticky 列＋標題區）之後、內容之前（03-F6）
const anchor = html.indexOf(`id="${MAIN_CONTENT_ID}"`);
assert.ok(anchor > 0, 'SiteHeader must render the skip-link target');
assert.equal(html.split(`id="${MAIN_CONTENT_ID}"`).length, 2, 'Exactly one skip-link target');
assert.ok(anchor > html.indexOf('</header>'), 'Target must come after the sticky header');
assert.ok(anchor > html.indexOf('</h1>'), 'Target must come after the title area');
assert.ok(anchor < html.indexOf('<main'), 'Target must come before the page content');
assert.match(html.slice(anchor - 120, anchor + 120), /tabindex="-1"/, 'Target must be focusable by script and skip links');
assert.match(html, /scroll-mt-\[var\(--app-header-height\)\]/, 'Target must clear the sticky header when scrolled to');

console.log('SiteHeader skip-link target tests passed.');
