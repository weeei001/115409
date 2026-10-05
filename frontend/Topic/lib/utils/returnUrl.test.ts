import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { safeReturnUrl } from './returnUrl';
import { Breadcrumbs } from '../../components/layout/Breadcrumbs';
import { renderedElements, renderedText } from '../testing/markup';

assert.equal(safeReturnUrl('/stock/2330'), '/stock/2330');
assert.equal(safeReturnUrl('/me?tab=password#top'), '/me?tab=password#top');
assert.equal(safeReturnUrl('  /compare  '), '/compare');

for (const raw of [
  '//evil.example',
  '/\\evil.example',
  '/\t/evil.example',
  '/\n/evil.example',
  '/\r/evil.example',
  'https://evil.example',
  'javascript:alert(1)',
  'stock/2330',
  '',
  undefined,
  ['/stock/2330'],
]) {
  assert.equal(safeReturnUrl(raw), null, `should reject ${JSON.stringify(raw)}`);
}

const breadcrumbMarkup = (href: string) => renderToStaticMarkup(React.createElement(Breadcrumbs, {
  items: [{ label: 'Previous page', href }, { label: 'Current page' }],
}));
for (const raw of [
  'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>',
  '//evil.example', '/\\evil.example', '/\t/evil.example', 'https://evil.example', '/unknown',
]) {
  const markup = breadcrumbMarkup(raw);
  assert.equal(renderedElements(markup, 'a').length, 0, raw);
  assert.ok(renderedText(markup).includes('Previous page'), 'Keep unavailable breadcrumb labels visible.');
}
for (const path of ['/', '/compare', '/stock/2330?newsView=%7B%22page%22%3A2%7D#news']) {
  const links = renderedElements(breadcrumbMarkup(path), 'a');
  assert.equal(links.length, 1);
  assert.equal(links[0].attribs.href, path);
}
const encodedQuery = renderedElements(breadcrumbMarkup('/stock/2330?keyword=javascript%3Aalert(1)%26next%3D%2F%2Fevil.example'), 'a')[0];
const destination = new URL(encodedQuery.attribs.href, 'https://app.example');
assert.equal(destination.origin, 'https://app.example');
assert.equal(destination.pathname, '/stock/2330');
assert.equal(destination.searchParams.get('keyword'), 'javascript:alert(1)&next=//evil.example');
assert.equal(destination.searchParams.has('next'), false);

console.log('returnUrl and breadcrumb destination tests passed');
