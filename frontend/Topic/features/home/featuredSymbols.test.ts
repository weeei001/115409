import assert from 'node:assert/strict';
import { pickFeaturedSymbols } from './featuredSymbols';

const symbols = ['1101', '1102', '1103', '1104', '1105', '1106', '1107', '1108', '1109', '1110'];
const shown = (picks: ReturnType<typeof pickFeaturedSymbols>) => picks.map((pick) => pick.symbol);

// No favorites: identical to the original rotation (advance by count, wrap around the list).
assert.deepEqual(shown(pickFeaturedSymbols(symbols, [], 0, 6)), ['1101', '1102', '1103', '1104', '1105', '1106']);
assert.deepEqual(shown(pickFeaturedSymbols(symbols, [], 1, 6)), ['1107', '1108', '1109', '1110', '1101', '1102']);
assert.deepEqual(shown(pickFeaturedSymbols(symbols, [], 2, 6)), ['1103', '1104', '1105', '1106', '1107', '1108']);
assert.ok(pickFeaturedSymbols(symbols, [], 0, 6).every((pick) => !pick.favorite));

// Lists no longer than count never rotate.
assert.deepEqual(shown(pickFeaturedSymbols(['2330', '2317'], [], 5, 6)), ['2330', '2317']);
assert.deepEqual(pickFeaturedSymbols([], [], 0, 6), []);

// Favorites come first in the given (newest-first) order and are flagged; the rest fill the remaining slots.
const mixed = pickFeaturedSymbols(symbols, ['1105', '1101'], 0, 6);
assert.deepEqual(shown(mixed), ['1105', '1101', '1102', '1103', '1104', '1106']);
assert.deepEqual(mixed.map((pick) => pick.favorite), [true, true, false, false, false, false]);

// The remaining slots rotate through the non-favorite stocks only, never repeating a favorite.
assert.deepEqual(shown(pickFeaturedSymbols(symbols, ['1105', '1101'], 1, 6)), ['1105', '1101', '1107', '1108', '1109', '1110']);
assert.deepEqual(shown(pickFeaturedSymbols(symbols, ['1105', '1101'], 2, 6)), ['1105', '1101', '1102', '1103', '1104', '1106']);

// At most count favorites; with all slots taken there is no rotation at all.
const many = ['1110', '1109', '1108', '1107', '1106', '1105', '1104', '1103'];
for (const tick of [0, 1, 7]) {
  const picks = pickFeaturedSymbols(symbols, many, tick, 6);
  assert.deepEqual(shown(picks), many.slice(0, 6));
  assert.ok(picks.every((pick) => pick.favorite));
}

// Favorites outside the stock list still show; duplicates are ignored.
assert.deepEqual(shown(pickFeaturedSymbols(['2330', '2317'], ['9999', '9999', '2330'], 3, 6)), ['9999', '2330', '2317']);

// Remaining stocks that fit in the open slots do not rotate.
assert.deepEqual(shown(pickFeaturedSymbols(['1101', '1102', '1103'], ['1102'], 4, 6)), ['1102', '1101', '1103']);

console.log('featuredSymbols tests passed');
