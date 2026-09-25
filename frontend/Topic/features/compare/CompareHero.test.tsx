import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { StockInfo } from '../../lib/types/api';
import { CompareHero } from './CompareHero';
import { SnapshotCard } from './SnapshotCard';

const stockInfos: Record<string, StockInfo> = {
  '2330': { symbol: '2330', name: '台積電', industry: '半導體業' },
  '2454': { symbol: '2454', name: '聯發科', industry: '半導體業' },
  '2881': { symbol: '2881', name: '富邦金', industry: '金融保險業' },
};
const props = {
  symbols: ['2330', '2454'],
  symbolColors: {},
  stockInfos,
  requestedRange: { startDate: '2026-09-01', endDate: '2026-09-25' },
  analysisRange: { startDate: '2026-09-02', endDate: '2026-09-24' },
  alignedDays: 15,
  onJumpToControls: () => {},
};
const same = renderToStaticMarkup(<CompareHero {...props} />);
assert.match(same, /同產業比較/);
assert.match(same, /相同產業分類不代表商業模式相同/);
assert.match(same, /2330 台積電/);
assert.match(same, /半導體業/);
assert.match(same, /選擇期間：2026-09-01 至 2026-09-25/);
assert.match(same, /實際比較期間：2026-09-02 至 2026-09-24/);
assert.match(same, /共同日漲跌樣本 15 筆/);

const cross = renderToStaticMarkup(<CompareHero {...props} symbols={['2330', '2881']} />);
assert.match(cross, /跨產業比較/);
assert.doesNotMatch(cross, /同產業比較/);

const missing = renderToStaticMarkup(<CompareHero {...props} stockInfos={{}} analysisRange={null} alignedDays={0} />);
assert.match(missing, /產業未提供/);
assert.match(missing, /暫時無法判斷是否為同產業比較/);
assert.match(missing, /共同價格資料不足/);
assert.doesNotMatch(missing, /實際比較期間：/);

const single = renderToStaticMarkup(<CompareHero {...props} symbols={['2330']} />);
assert.match(single, /請選擇至少兩檔股票/);
assert.doesNotMatch(single, /同產業比較：|跨產業比較：/);

const snapshot = renderToStaticMarkup(<SnapshotCard symbol="2330" color="#000" stockInfos={stockInfos}
  data={{ start_date: '2026-09-02', end_date: '2026-09-24', symbols: ['2330'], data: [] }} returnPct={null} />);
assert.match(snapshot, /2330 台積電/);
assert.match(snapshot, /半導體業/);
assert.match(snapshot, /期間價格漲跌/);
assert.match(snapshot, /走勢資料不足/);
console.log('Comparison metadata and analysis-window rendering checks passed.');
