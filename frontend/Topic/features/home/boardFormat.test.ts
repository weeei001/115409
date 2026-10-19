import assert from 'node:assert/strict';
import { fmtNum } from '@/lib/utils/format';
import { boardFigures } from './boardFormat';

// ── 首屏燈質列的加權指數：跟觀測台同一組格式（fmtNum／signedText，負號 U+2212） ──
const up = boardFigures({ close: 48475.74, change: 122.25, date: '2026-10-02' });
assert.ok(up);
assert.equal(up.close, fmtNum(48475.74));
assert.equal(up.change, '+122.25（+0.25%）', '百分比相對前一筆收盤（close − change）');
assert.equal(up.tone, 'up');
assert.equal(up.date, '2026-10-02');
const down = boardFigures({ close: 21000, change: -210, date: '2026-10-02' });
assert.equal(down?.change, '−210.00（−0.99%）');
assert.equal(down?.tone, 'down');
const flat = boardFigures({ close: 21000, change: 0, date: '2026-10-02' });
assert.equal(flat?.change, '0.00（0.00%）');
assert.equal(flat?.tone, 'neutral', '平盤是中性色');
const noChange = boardFigures({ close: 21000, change: null, date: '2026-10-02' });
assert.equal(noChange?.change, null);
assert.equal(noChange?.tone, 'neutral');
assert.equal(boardFigures(null), null);

console.log('Home board figure tests passed.');
