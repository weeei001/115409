import assert from 'node:assert/strict';
import { moveActiveIndex } from './Combobox';

// 全部可選（股票搜尋）：頭尾循環；沒有反白時往下是第一項、往上是最後一項
const all = [0, 1, 2];
assert.equal(moveActiveIndex('ArrowDown', all, -1), 0);
assert.equal(moveActiveIndex('ArrowDown', all, 2), 0);
assert.equal(moveActiveIndex('ArrowUp', all, -1), 2);
assert.equal(moveActiveIndex('ArrowUp', all, 0), 2);
assert.equal(moveActiveIndex('ArrowUp', all, 2), 1);
assert.equal(moveActiveIndex('Home', all, 1), 0);
assert.equal(moveActiveIndex('End', all, 0), 2);

// 部分可選（產業搜尋：已全部加入的產業跳過）
const some = [1, 3];
assert.equal(moveActiveIndex('ArrowDown', some, -1), 1);
assert.equal(moveActiveIndex('ArrowDown', some, 1), 3);
assert.equal(moveActiveIndex('ArrowDown', some, 3), 1);
assert.equal(moveActiveIndex('ArrowUp', some, 1), 3);
assert.equal(moveActiveIndex('Home', some, 3), 1);
assert.equal(moveActiveIndex('End', some, 1), 3);

// 其他鍵、沒有可選項：不處理
assert.equal(moveActiveIndex('Enter', all, 0), null);
assert.equal(moveActiveIndex('Escape', all, 0), null);
assert.equal(moveActiveIndex('ArrowDown', [], -1), null);

console.log('Combobox active-index navigation checks passed.');
