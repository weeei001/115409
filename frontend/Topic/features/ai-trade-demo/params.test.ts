import assert from 'node:assert/strict';
import { DEFAULT_FORM, formatCashInput, parseCashInput, validateForm, type SimulateFormValues } from './params';

// 初始資金輸入：即時加千分位、丟掉非數字、去掉開頭的 0
assert.equal(formatCashInput('1000000'), '1,000,000');
assert.equal(formatCashInput('1,000,0000'), '10,000,000');
assert.equal(formatCashInput('00012a3'), '123');
assert.equal(formatCashInput(''), '');
assert.equal(formatCashInput('abc'), '');
assert.equal(parseCashInput('1,000,000'), 1_000_000);
assert.equal(parseCashInput(''), null);

const valid = (patch: Partial<SimulateFormValues>) => validateForm({ ...DEFAULT_FORM, ...patch });
const errorsOf = (patch: Partial<SimulateFormValues>) => {
  const result = valid(patch);
  assert.equal(result.ok, false, `應該要擋下：${JSON.stringify(patch)}`);
  return result.ok ? {} : result.errors;
};

// 預設值：約一個月，不用後端的 405 日預設
{
  const result = validateForm(DEFAULT_FORM);
  assert.ok(result.ok);
  assert.deepEqual(result.params, { symbol: '2330', start: '2026-08-03', end: '2026-09-03', initialCash: 1_000_000, confidence: 5 });
}

// 初始資金範圍 10,000～100,000,000（含端點）
assert.ok(valid({ cash: '10,000' }).ok);
assert.ok(valid({ cash: '100,000,000' }).ok);
assert.ok(errorsOf({ cash: '9,999' }).cash);
assert.ok(errorsOf({ cash: '100,000,001' }).cash);
assert.equal(errorsOf({ cash: '' }).cash, '請輸入初始資金');

// 日期
assert.equal(errorsOf({ start: '2026-09-03', end: '2026-08-03' }).end, '結束日不可早於起始日');
assert.ok(valid({ start: '2026-09-03', end: '2026-09-03' }).ok, '起訖同一天可以');
assert.ok(errorsOf({ start: '2026-02-30' }).start, '不存在的日期');
assert.ok(errorsOf({ end: '' }).end);

// 風險偏好：1～10 的整數
assert.ok(valid({ confidence: 1 }).ok);
assert.ok(valid({ confidence: 10 }).ok);
assert.ok(errorsOf({ confidence: 0 }).confidence);
assert.ok(errorsOf({ confidence: 11 }).confidence);
assert.ok(errorsOf({ confidence: 5.5 }).confidence);

console.log('ai-trade-demo params.test.ts: ok');
