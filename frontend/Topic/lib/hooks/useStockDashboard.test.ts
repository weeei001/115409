import assert from 'node:assert/strict';
import { stockLoadErrorKind, stockRangePreset } from './useStockDashboard';
import { isTaiwanStockCode } from '../utils/stockValidation';
import { ApiRequestError } from '../api/client';
import { shiftYmdMonths } from '../utils/date';

// P1-17：只有 404（沒有儲存的行情）改給搜尋；5xx、斷線（沒有 status）、其他錯誤都可以重試
assert.equal(stockLoadErrorKind(new ApiRequestError('找不到股票 9999 的價格資料', 404)), 'not-found');
assert.equal(stockLoadErrorKind(new ApiRequestError('伺服器暫時無法處理', 500)), 'retryable');
assert.equal(stockLoadErrorKind(new ApiRequestError('目前無法連線到伺服器')), 'retryable');
assert.equal(stockLoadErrorKind(new Error('boom')), 'retryable');
assert.equal(stockLoadErrorKind('not an error'), 'retryable');

assert.equal(isTaiwanStockCode('2330'), true);
assert.equal(isTaiwanStockCode('2454'), true);
assert.equal(isTaiwanStockCode('0050'), true);
assert.equal(isTaiwanStockCode('00878'), true);
assert.equal(isTaiwanStockCode('4eb8adfebd390ab892a1e72ac47a1451'), false);
assert.equal(isTaiwanStockCode('5223D90CD690B8C178AEB74E494D5828'), false);
assert.equal(isTaiwanStockCode(''), false);
assert.equal(isTaiwanStockCode('   '), false);
assert.equal(isTaiwanStockCode('abc'), false);
assert.equal(isTaiwanStockCode('123'), false); // less than 4 digits
assert.equal(isTaiwanStockCode('1234567'), false); // more than 6 digits
assert.equal(isTaiwanStockCode(' 2330'), false, 'Callers trim; the check itself does not');
assert.equal(isTaiwanStockCode(null), false);
assert.equal(isTaiwanStockCode(undefined), false);

console.log('isTaiwanStockCode validation tests passed!');

// 期間快選（04-S3）：結束日是資料最後一天、起日往前推 3／6／12 個月才算選中；其餘是自訂區間
assert.equal(stockRangePreset('2026-07-02', '2026-10-02', '2026-10-02'), '3M');
assert.equal(stockRangePreset('2026-04-02', '2026-10-02', '2026-10-02'), '6M');
assert.equal(stockRangePreset('2025-10-02', '2026-10-02', '2026-10-02'), '1Y');
assert.equal(stockRangePreset('2026-07-01', '2026-10-02', '2026-10-02'), null, 'Custom start date');
assert.equal(stockRangePreset('2026-06-30', '2026-09-30', '2026-10-02'), null, 'End date moved away from the latest data');
assert.equal(stockRangePreset('2026-07-02', '2026-10-02', null), null, 'Range not ready yet');
// 往前推 N 個月：目標月沒有那一天時取月底，不溢位到下個月
assert.equal(shiftYmdMonths('2026-05-31', -3), '2026-02-28');
assert.equal(shiftYmdMonths('2024-03-31', -1), '2024-02-29');
assert.equal(shiftYmdMonths('2026-03-31', -1), '2026-02-28');
assert.equal(shiftYmdMonths('2026-12-31', -6), '2026-06-30');
assert.equal(shiftYmdMonths('2026-01-31', 1), '2026-02-28');
assert.equal(shiftYmdMonths('2026-03-15', -3), '2025-12-15');
assert.equal(shiftYmdMonths('2026-10-06', -12), '2025-10-06');
console.log('Stock range preset tests passed!');
