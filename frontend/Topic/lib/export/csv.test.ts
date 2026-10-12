import assert from 'node:assert/strict';
import { buildCsv, exportFileName, exportedAtText } from './csv';
import { wrapSegments } from './chartImage';

const now = new Date('2026-10-12T06:30:00Z');
assert.equal(exportedAtText(now), '2026-10-12 14:30（台北時間）');

const csv = buildCsv({
  title: '台積電 2330 月營收',
  source: '公開資訊觀測站',
  period: '2024-10 → 2026-09',
  columns: ['月份', '營收（元）', '年增率（%）'],
  rows: [
    ['2026-09', 330_000_000_000, -1.5],
    ['=HYPERLINK("x")', null, Number.NaN],
    ['含,逗號', '有"引號"', '換\n行'],
    ['-負號開頭的文字', '+12', '@x'],
  ],
  notes: ['單季數字'],
}, now);

assert.ok(csv.startsWith('﻿'), 'Excel 需要 BOM');
const lines = csv.slice(1).split('\r\n');
assert.deepEqual(lines.slice(0, 7), [
  '股海明燈,台積電 2330 月營收',
  '資料來源,公開資訊觀測站',
  '資料期間,2024-10 → 2026-09',
  '匯出時間,2026-10-12 14:30（台北時間）',
  '說明,展示用途，非投資建議',
  '',
  '月份,營收（元）,年增率（%）',
]);
assert.equal(lines[7], '2026-09,330000000000,-1.5', '數字不加千分位、負號用半形');
assert.equal(lines[8], `"'=HYPERLINK(""x"")",,`, '公式開頭的文字補單引號，NaN 輸出空白');
assert.equal(lines[9], '"含,逗號","有""引號""","換\n行"', '逗號、引號、換行要加引號');
assert.ok(csv.includes(`'-負號開頭的文字,'+12,'@x`));
assert.ok(csv.trimEnd().endsWith('註,單季數字'));

// 沒有期間時不寫那一列
assert.ok(!buildCsv({ title: 't', source: 's', columns: ['a'], rows: [[1]] }, now).includes('資料期間'));

assert.equal(exportFileName(['2330', '月營收', '2026-09'], 'csv'), '2330_月營收_2026-09.csv');
assert.equal(exportFileName(['2330/2317', '多股 比較:指標', null, undefined, ' '], 'png'), '23302317_多股_比較指標.png');
assert.equal(exportFileName([], 'csv'), '股海明燈.csv');

// 圖片頁尾只在分隔點換行
const width = (text: string) => text.length;
assert.deepEqual(wrapSegments(['資料來源：甲', '匯出 2026', '股海明燈'], 100, width), ['資料來源：甲 · 匯出 2026 · 股海明燈']);
assert.deepEqual(wrapSegments(['資料來源：甲', '匯出 2026', '股海明燈'], 14, width), ['資料來源：甲', '匯出 2026 · 股海明燈']);
assert.deepEqual(wrapSegments(['一段很長很長很長的文字'], 3, width), ['一段很長很長很長的文字'], '單段太長也不切斷');

console.log('Export checks passed: CSV metadata, escaping, formula guard, BOM, file names, footer wrapping.');
