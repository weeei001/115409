import assert from 'node:assert/strict';
import { isStockSymbol } from './useStockDashboard';

assert.equal(isStockSymbol('2330'), true);
assert.equal(isStockSymbol('2454'), true);
assert.equal(isStockSymbol('0050'), true);
assert.equal(isStockSymbol('00878'), true);
assert.equal(isStockSymbol('4eb8adfebd390ab892a1e72ac47a1451'), false);
assert.equal(isStockSymbol('5223D90CD690B8C178AEB74E494D5828'), false);
assert.equal(isStockSymbol(''), false);
assert.equal(isStockSymbol('   '), false);
assert.equal(isStockSymbol('abc'), false);
assert.equal(isStockSymbol('123'), false); // less than 4 digits

console.log('isStockSymbol validation tests passed!');
