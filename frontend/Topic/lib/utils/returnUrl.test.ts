import assert from 'node:assert/strict';
import { safeReturnUrl } from './returnUrl';

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

console.log('returnUrl tests passed');
