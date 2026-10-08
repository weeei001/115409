import assert from 'node:assert/strict';
import { buildFacets } from './textBriefFacets';
import type { EvidenceItem } from '../types/textBrief';

const evidence: EvidenceItem[] = [
  { id: 'fd_01', field: 'eps', date: '2026-06-30', value: 20, yoy_pct: 20 },
  { id: 'lt_01', field: 'vs_ma60_pct', date: '2026-09-24', value: 5 },
];
const first = buildFacets(evidence, { asOfDate: '2026-09-27' });
assert.equal(first.find(item => item.key === 'fundamental')?.levelLabel, '強');
assert.equal(buildFacets([]).find(item => item.key === 'momentum')?.levelLabel, '資料不足');
assert.equal(buildFacets([{ id: 'fd_02', field: 'per', value: 10 }]).find(item => item.key === 'valuation')?.levelLabel, '資料不足');
assert.equal(buildFacets(evidence, { asOfDate: '2026-06-01' }).find(item => item.key === 'fundamental')?.levelLabel, '資料不足');
// 近十日外資累計是張：帶正負號、負號 U+2212，和個股頁法人卡同一套格式
const chipsBasis = (value: number) => buildFacets([{ id: 'ch_01', field: 'foreign_net_10d_lots', value }]).find(item => item.key === 'chips')?.basis;
assert.equal(chipsBasis(-6944), '近十日外資累計 −6,944 張');
assert.equal(chipsBasis(32362), '近十日外資累計 +32,362 張');
assert.equal(chipsBasis(0), '近十日外資累計 0 張');
console.log('Brief facets use snapshot evidence independently of chart selection.');
