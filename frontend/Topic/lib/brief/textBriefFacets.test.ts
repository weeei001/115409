import assert from 'node:assert/strict';
import { buildFacets } from './textBriefFacets';
import type { EvidenceItem } from '../types/textBrief';

const evidence: EvidenceItem[] = [
  { id: 'fd_01', field: 'eps', date: '2026-06-30', value: 20, yoy_pct: 20 },
  { id: 'lt_01', field: 'vs_ma60_pct', date: '2026-09-24', value: 5 },
];
const first = buildFacets(evidence, { asOfDate: '2026-09-27', maStructureLabel: '偏多' });
const changedChart = buildFacets(evidence, { asOfDate: '2026-09-27', maStructureLabel: '偏空' });
assert.deepEqual(first, changedChart);
assert.equal(first.find(item => item.key === 'fundamental')?.levelLabel, '強');
assert.equal(buildFacets([], { maStructureLabel: '偏多' }).find(item => item.key === 'momentum')?.levelLabel, '資料不足');
assert.equal(buildFacets([{ id: 'fd_02', field: 'per', value: 10 }]).find(item => item.key === 'valuation')?.levelLabel, '資料不足');
assert.equal(buildFacets(evidence, { asOfDate: '2026-06-01' }).find(item => item.key === 'fundamental')?.levelLabel, '資料不足');
console.log('Brief facets use snapshot evidence independently of chart selection.');
