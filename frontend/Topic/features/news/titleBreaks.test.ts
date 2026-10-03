import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TitleWithBreaks, splitTitleAtPunctuation } from './titleBreaks';

const cases: Array<[string, string[]]> = [
  // 逗號、冒號、頓號之後
  ['台積電法說會，魏哲家：AI需求強勁、產能吃緊', ['台積電法說會，', '魏哲家：', 'AI需求強勁、', '產能吃緊']],
  // 開頭引號在前面斷，收尾引號在後面斷
  ['國巨宣布「全面漲價」後股價大漲', ['國巨宣布', '「全面漲價」', '後股價大漲']],
  // 書名號與括號
  ['《經濟日報》報導（更新）聯發科新品', ['《經濟日報》', '報導', '（更新）', '聯發科新品']],
  // 連續標點視為一組，斷在整組之後
  ['他說：「營收創新高。」股價走揚', ['他說：', '「營收創新高。」', '股價走揚']],
  // 句尾標點不產生空片段
  ['鴻海營收創同期新高！', ['鴻海營收創同期新高！']],
  // 沒有標點：整串一段
  ['台積電ADR上漲', ['台積電ADR上漲']],
  ['', []],
];

for (const [title, expected] of cases) {
  const parts = splitTitleAtPunctuation(title);
  assert.deepEqual(parts, expected, title);
  // 一個字都不改
  assert.equal(parts.join(''), title);
}

const html = renderToStaticMarkup(React.createElement(TitleWithBreaks, { title: '台積電法說會，魏哲家：AI需求強勁、產能吃緊' }));
assert.equal(html, '台積電法說會，<wbr/>魏哲家：<wbr/>AI需求強勁、<wbr/>產能吃緊');

console.log('title break tests passed');
