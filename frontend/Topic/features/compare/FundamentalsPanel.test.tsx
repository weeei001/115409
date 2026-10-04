import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { FundamentalsPanel } from './FundamentalsPanel';

const markup = renderToStaticMarkup(<FundamentalsPanel symbols={['2330', '2317']} data={{ '2330': null, '2317': null }} endDate="2026-09-25" />);
assert.match(markup, /2330/);
assert.match(markup, /2317/);
assert.match(markup, /無共同月份或資料不足/);
assert.match(markup, /不能視為截止日當時已公開的資訊/);
assert.match(markup, /<th scope="row"/);
assert.match(markup, /--/);
assert.doesNotMatch(markup, /NaN|Infinity|0\.00%/);
const legacy = renderToStaticMarkup(<FundamentalsPanel symbols={['A', 'B']} data={Object.fromEntries(['A', 'B'].map((symbol) => [symbol, {
  revenues: [], valuations: [], warnings: [], statements: ['2025', '2026'].map((year) => ({
    symbol, date: `${year}-06-30`, statement: 'income', item_type: 'EPS', origin_name: '基本每股盈餘', value: year === '2025' ? '5' : '10',
  })),
}]))} endDate="2026-09-25" />);
assert.doesNotMatch(legacy, /同期間與口徑|100\.00%/);
assert.match(legacy, /合併／個別未提供/);
console.log('Fundamental presentation checks passed: missing stocks, dates, source notes and accessible row headings.');
