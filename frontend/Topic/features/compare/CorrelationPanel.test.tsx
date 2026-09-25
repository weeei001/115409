import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compareLineOption, institutionalCompareOption } from '../../lib/charts/adapters';
import { CorrelationPanel } from './CorrelationPanel';

const matrix = { A: { A: 1, B: -0.9, C: null }, B: { A: -0.9, B: 1, C: null }, C: { A: null, B: null, C: null } };
const sampleCounts = { A: { A: 24, B: 21, C: 1 }, B: { A: 21, B: 23, C: 0 }, C: { A: 1, B: 0, C: 1 } };
const pair = renderToStaticMarkup(<CorrelationPanel symbols={['A', 'B']} matrix={matrix} sampleCounts={sampleCounts} />);
assert.match(pair, /有效配對樣本：21 筆/);
assert.match(pair, /-0\.90/);
assert.doesNotMatch(pair, /可作為避險配對|分散效果佳/);

const markup = renderToStaticMarkup(<CorrelationPanel symbols={['A', 'B', 'C']} matrix={matrix} sampleCounts={sampleCounts} />);
const cells = [...markup.matchAll(/<td\b[^>]*>(.*?)<\/td>/g)].map((match) => match[1]);
assert.equal(cells.length, 9);
assert.match(cells[1], /-0\.90.*21 筆/);
assert.match(cells[2], /--.*1 筆＊/);
assert.match(cells[5], /--.*0 筆＊/);
assert.match(cells[8], /--.*1 筆＊/);

const chart = { dates: ['2026-09-01', '2026-09-02', '2026-09-03'], values: { A: [100, null, 102] } };
for (const option of [compareLineOption(chart, ['A'], { A: '#fff' }, 'price', false), institutionalCompareOption(chart, ['A'], { A: '#fff' }, false)]) {
  assert.ok(Array.isArray(option?.series));
  const series = option.series[0];
  assert.equal(series.type, 'line');
  if (series.type === 'line') {
    assert.equal(series.connectNulls, false);
    assert.deepEqual(series.data, [100, null, 102]);
  }
}

console.log('Comparison presentation checks passed: exact pair counts, undefined correlation, and chart gaps.');
