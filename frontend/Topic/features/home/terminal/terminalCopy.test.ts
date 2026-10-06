import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NO_STOCKS_TEXT, rovingIndex, watchTabStops } from './Watchlist';
import { terminalIndicatorRows } from './terminalIndicators';

// P2-083：上下鍵在列之間移動，頭尾不繞回
assert.equal(rovingIndex(5, 0, 'ArrowDown'), 1);
assert.equal(rovingIndex(5, 4, 'ArrowDown'), 4);
assert.equal(rovingIndex(5, 0, 'ArrowUp'), 0);
assert.equal(rovingIndex(5, 3, 'Home'), 0);
assert.equal(rovingIndex(5, 1, 'End'), 4);
assert.equal(rovingIndex(5, 1, 'Tab'), null, 'Tab leaves the list');
assert.equal(rovingIndex(0, 0, 'ArrowDown'), null);

// 整份清單只有一個 Tab 停駐點：上次聚焦 > 目前選中 > 第一列
const order = ['2317', '2330', '1101', '1102', '2002', '2303', '2454', '2603', '2881', '2882'];
assert.deepEqual([...watchTabStops(order, null, null, null)], ['2317']);
assert.deepEqual([...watchTabStops(order, null, '2330', null)], ['2330']);
assert.deepEqual([...watchTabStops(order, '1101', '2330', null)], ['1101']);
assert.deepEqual([...watchTabStops(order, '9999', '2330', null)], ['2330'], 'Unknown focus falls back to the selected row');
// 手機收合時，停駐點在收合範圍外：第一列也要能 Tab 進來
assert.deepEqual([...watchTabStops(order, null, '2882', 8)].sort(), ['2317', '2882'].sort());
assert.deepEqual([...watchTabStops(order, null, '2330', 8)], ['2330']);
assert.equal(watchTabStops([], null, null, 8).size, 0);

// P2-091：指標名稱帶參數、小數位和個股頁一致
const rows = terminalIndicatorRows({ rsi10: 61.3456, kd_k9: 83.821, kd_d9: 74.88, macd_hist: 6.4213 });
assert.deepEqual(rows.map((row) => [row.label, row.value]), [
  ['RSI（10）', '61.3'],
  ['KD（9）', 'K 83.8 / D 74.9'],
  ['MACD 柱（12, 26, 9）', '+6.421'],
]);
const negative = terminalIndicatorRows({ rsi10: null, kd_k9: 50, kd_d9: null, macd_hist: -0.5 });
assert.deepEqual(negative.map((row) => row.value), ['--', '--', '−0.500']);

// P1-24／P1-25／P2-084～P2-090：首頁觀測台不寫資料管線的內部用語、不用比喻代替說明
assert.equal(NO_STOCKS_TEXT, '目前沒有股票資料，請稍後再來看。');
const source = ['ObservationTerminal.tsx', 'Watchlist.tsx'].map((file) => readFileSync(join(__dirname, file), 'utf8')).join('\n');
for (const phrase of ['資料庫', '匯入', '燈暫時熄了', '都要等它', '正在看觀測清單裡的一檔', '換一檔', '回到海面', '紅漲綠跌依台股慣例', '重新讀取', '讀取']) {
  assert.ok(!source.includes(phrase), `ObservationTerminal/Watchlist still contains「${phrase}」`);
}
assert.ok(source.includes('兩者分開更新，各自顯示最近一個收盤日'));
assert.ok(source.includes('${plotted.first} → ${plotted.last}'), 'Range separator uses →');
assert.ok(source.includes('回到頂端'));

// P2-079～P2-081：首屏按鈕說明會發生什麼；首頁只用「觀測台」一個詞
const journey = readFileSync(join(__dirname, '../journey/BeaconJourney.tsx'), 'utf8');
const header = readFileSync(join(__dirname, '../HomeHeader.tsx'), 'utf8');
for (const phrase of ['登上燈塔\n', '直接看觀測台', '觀測室。', '資料庫最近儲存', 'stop="觀測室"']) assert.ok(!journey.includes(phrase), `BeaconJourney still contains「${phrase.trim()}」`);
assert.ok(journey.includes('往下看介紹') && journey.includes('直接看行情'));
assert.ok(header.includes('直接看行情') && !header.includes('跳到觀測台\n'));

console.log('Home terminal copy and keyboard tests passed.');
