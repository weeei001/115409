import assert from 'node:assert/strict';
import { fmtInstitutionalShares, fmtLotsAxisLabel, fmtVolume, isUnderOneLot, lotToneValue, sharesToLots } from './format';
import { lots, signedLots, signedShares } from '../../features/stock/signedShares';

// P1-21：股數一律顯示成張（1 張 = 1,000 股，四捨五入到整數張），同一欄不切換股／萬股／億股
assert.equal(fmtVolume(28_966_200), '28,966 張');
assert.equal(fmtVolume(1_000), '1 張');
assert.equal(fmtVolume(0), '0 張');
assert.equal(fmtVolume(null), '--');
assert.equal(fmtInstitutionalShares(-15_147_000), '-15,147 張');
assert.equal(signedShares(-15_147_000), '−15,147 張', 'U+2212 for net sells');
assert.equal(signedShares(1_200_000), '+1,200 張');
assert.equal(signedShares(0), '0 張');
assert.equal(signedLots(-80_755_500), '−80,756');
assert.equal(lots(84_000), '84');

// 決議（2026-10-06）：不滿 1 張的非零值寫「不到 1 張」，不帶號，也不上漲跌色
for (const value of [350, -350, 999, -1]) {
  assert.equal(isUnderOneLot(value), true, String(value));
  assert.equal(fmtVolume(Math.abs(value)), '不到 1 張');
  assert.equal(fmtInstitutionalShares(value), '不到 1 張');
  assert.equal(signedShares(value), '不到 1 張');
  assert.equal(signedLots(value), '不到 1 張');
  assert.equal(lotToneValue(value), 0, 'Under one lot is not colored');
}
assert.equal(isUnderOneLot(0), false);
assert.equal(isUnderOneLot(1_000), false);
assert.equal(lotToneValue(-1_000), -1_000);
assert.equal(lotToneValue(null), null);
// 1,000 股以上但四捨五入後仍照常帶號：1,499 股 → +1 張
assert.equal(signedShares(1_499), '+1 張');

// 圖表：資料點換成張，刻度 1 萬張以上寫「萬」
assert.equal(sharesToLots(15_147_000), 15_147);
assert.equal(fmtLotsAxisLabel(15_000), '1.5萬');
assert.equal(fmtLotsAxisLabel(-20_000), '-2萬');
assert.equal(fmtLotsAxisLabel(5_000), '5000');
assert.equal(fmtLotsAxisLabel(0.5), '0.5');

console.log('Lot (張) formatting tests passed');
