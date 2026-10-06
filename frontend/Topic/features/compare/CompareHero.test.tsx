import assert from 'node:assert/strict';
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
  tradingDays: 16,
  onJumpToControls: () => {},
};
const same = renderToStaticMarkup(<CompareHero {...props} />);
assert.match(same, /同產業比較/);
assert.match(same, /相同產業分類不代表商業模式相同/);
assert.match(same, /2330 台積電/);
assert.match(same, /半導體業/);
assert.match(same, /查詢條件：2026-09-01 → 2026-09-25/);
assert.match(same, /實際比較期間 <\/span>2026-09-02 → 2026-09-24/);
assert.match(same, /共同日漲跌樣本 15 筆/);
assert.match(same, /共 16 個交易日/);

const cross = renderToStaticMarkup(<CompareHero {...props} symbols={['2330', '2881']} />);
assert.match(cross, /跨產業比較/);
assert.doesNotMatch(cross, /同產業比較/);

const missing = renderToStaticMarkup(<CompareHero {...props} stockInfos={{}} analysisRange={null} alignedDays={0} />);
assert.match(missing, /產業未提供/);
assert.match(missing, /暫時無法判斷是否為同產業比較/);
assert.match(missing, /共同價格資料不足/);
assert.doesNotMatch(missing, /實際比較期間 </);

const single = renderToStaticMarkup(<CompareHero {...props} symbols={['2330']} />);
assert.match(single, /請選擇至少兩檔股票/);
assert.doesNotMatch(single, /同產業比較：|跨產業比較：/);

const snapshot = renderToStaticMarkup(<SnapshotCard symbol="2330" color="#000" stockInfos={stockInfos}
  data={{ start_date: '2026-09-02', end_date: '2026-09-24', symbols: ['2330'], data: [] }} returnPct={null} />);
assert.match(snapshot, /2330 台積電/);
assert.match(snapshot, /半導體業/);
assert.match(snapshot, /區間漲跌幅/);
assert.doesNotMatch(snapshot, /期間價格漲跌/);
assert.match(snapshot, /走勢資料不足/);

// 走勢線和區間漲跌幅要是同一段實際比較期間，不能只取尾端 30 日（P0-3）
const windowDates = Array.from({ length: 40 }, (_, i) => new Date(Date.UTC(2026, 6, 6 + i)).toISOString().slice(0, 10));
// 前半段上漲、尾端 30 日下跌：舊做法會畫出一條往下的線，配上 +% 的區間漲跌幅
const windowRows = windowDates.map((date, i) => ({ date, prices: { '2330': i < 10 ? 100 + i * 10 : 190 - (i - 10) } as Record<string, number | null> }));
windowRows[20].prices['2330'] = null;
windowRows[21].prices['2330'] = null;
const windowData = { start_date: windowDates[0], end_date: windowDates[39], symbols: ['2330'], data: windowRows };
const full = renderToStaticMarkup(<SnapshotCard symbol="2330" color="#000" stockInfos={stockInfos} data={windowData} returnPct={61} />);
assert.match(full, /區間漲跌幅/);
assert.match(full, new RegExp(`收盤走勢 ${windowDates[0]} → ${windowDates[39]}，共 40 個交易日；缺 2 日收盤，前後直接連線`));
const plotted = full.match(/points="([^"]+)"/)?.[1].trim().split(/\s+/) ?? [];
assert.equal(plotted.length, 38, '整段 40 日扣掉 2 日缺值都要畫出');
assert.match(full, /stroke-up/, '線色依同一段的區間漲跌幅');

const noGap = renderToStaticMarkup(<SnapshotCard symbol="2330" color="#000" stockInfos={stockInfos}
  data={{ ...windowData, data: windowDates.map((date, i) => ({ date, prices: { '2330': 100 + i } })) }} returnPct={39} />);
assert.match(noGap, /共 40 個交易日<\/p>/);
assert.doesNotMatch(noGap, /缺 \d+ 日收盤/);
console.log('Comparison metadata and analysis-window rendering checks passed.');
