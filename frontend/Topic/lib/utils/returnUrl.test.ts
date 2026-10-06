import assert from 'node:assert/strict';
import { safeReturnUrl } from './returnUrl';

assert.equal(safeReturnUrl('/stock/2330'), '/stock/2330');
assert.equal(safeReturnUrl('/me?tab=password#top'), '/me?tab=password#top');
assert.equal(safeReturnUrl('  /compare  '), '/compare');
// 點區段解析後仍是單一斜線開頭的站內路徑：照常接受
assert.equal(safeReturnUrl('/news/../favorites'), '/favorites');
assert.equal(safeReturnUrl('/%2Fexample.com'), '/%2Fexample.com');

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

// 02-F2 的 9 個繞過值。router.query 給的是解碼後的字串，所以查詢字串編碼的那幾個要先 decodeURIComponent 再測，
// 直接傳 `%2F..` 開頭的原字串本來就會因為不是 `/` 開頭被擋，測了等於沒測。
const dotSegmentBypasses = [
  '/..//example.com',
  '/.//example.com',
  '/a/../..//example.com',
  '/%2e%2e//example.com',
  '/.%2e//example.com',
  decodeURIComponent('%2F..%2F%2Fexample.com'),
  decodeURIComponent('%2F.%2F%2Fexample.com'),
  decodeURIComponent('%2F%2e%2e%2F%2Fexample.com'),
  decodeURIComponent('/%2E./%2Fexample.com'),
];
for (const raw of dotSegmentBypasses) {
  assert.ok(raw.startsWith('/') && !raw.startsWith('//'), `fixture must reach the URL parser: ${raw}`);
  assert.equal(safeReturnUrl(raw), null, `should reject dot-segment bypass ${JSON.stringify(raw)}`);
}

console.log('returnUrl tests passed');
