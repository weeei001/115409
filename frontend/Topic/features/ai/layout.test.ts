import assert from 'node:assert/strict';
import { CHAT_MIN_PX, DATA_MIN_PX, DATA_RATIO_DEFAULT, clampDataRatio, parseDataRatio } from './layout';
import { lastCellSpan } from './ChatDashboard';
import { parseFlag, serializeFlag } from '../../lib/hooks/useStoredPreference';

// 寬度夠時照使用者的比例；兩欄都不小於最小寬度
assert.equal(clampDataRatio(0.5, 1200), 0.5);
assert.equal(clampDataRatio(0.05, 1200), DATA_MIN_PX / 1200);
assert.equal(clampDataRatio(0.95, 1200), 1 - CHAT_MIN_PX / 1200);
// 放不下兩欄時以資料欄的最小寬度為準，不會算出負的對話欄
assert.equal(clampDataRatio(0.5, 600), DATA_MIN_PX / 600);
assert.equal(clampDataRatio(0.9, 300), 1);
// 還沒量到寬度、或比例壞掉時回到預設
assert.equal(clampDataRatio(0.7, 0), DATA_RATIO_DEFAULT);
assert.equal(clampDataRatio(Number.NaN, 1200), DATA_RATIO_DEFAULT);

// localStorage 的值：只接受 0～1 之間的數字、'1'／'0'
assert.equal(parseDataRatio('0.62'), 0.62);
for (const raw of ['', ' ', '0', '1', '-0.2', '1.4', 'abc', 'NaN']) assert.equal(parseDataRatio(raw), null, raw);
assert.equal(parseFlag('1'), true);
assert.equal(parseFlag('0'), false);
assert.equal(parseFlag('true'), null);
assert.equal(serializeFlag(true), '1');
assert.equal(serializeFlag(false), '0');

// 指標格最後一格補滿該列：2／3／4／6 欄各自算跨幾欄
assert.equal(lastCellSpan(1), 'col-span-2 @xl:col-span-3 @3xl:col-span-4 @6xl:col-span-6');
assert.equal(lastCellSpan(3), 'col-span-2 @xl:col-span-1 @3xl:col-span-2 @6xl:col-span-4');
assert.equal(lastCellSpan(4), 'col-span-1 @xl:col-span-3 @3xl:col-span-1 @6xl:col-span-3');
assert.equal(lastCellSpan(6), 'col-span-1 @xl:col-span-1 @3xl:col-span-3 @6xl:col-span-1');

console.log('AI workspace layout passed: data ratio clamping, stored preference parsing, metric last-cell spans.');
