import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CompareQualityMeta } from '@/lib/types/compare';
import { AnalysisIndex, toggleOpenKey } from './AnalysisIndex';
import { MethodologyPanel } from './MethodologyPanel';
import { CompareHero } from './CompareHero';
import { TechnicalSnapshotTable } from './TechnicalSnapshotTable';
import { institutionalFinding, methodFinding } from './analysisFindings';

const text = (html: string) => html.replace(/<[^>]+>/g, '');

// P2-093：延伸分析可以同時展開多項
assert.deepEqual(toggleOpenKey([], 'a'), ['a']);
assert.deepEqual(toggleOpenKey(['a'], 'b'), ['a', 'b']);
assert.deepEqual(toggleOpenKey(['a', 'b'], 'a'), ['b']);
const index = renderToStaticMarkup(<AnalysisIndex title="延伸分析" entries={[
  { key: 'x', name: 'X', finding: null, description: 'x', content: () => null },
  { key: 'y', name: 'Y', finding: null, description: 'y', content: () => null },
]} />);
assert.ok(!index.includes('一次展開一項'));
assert.ok(index.includes('全部展開'));

// P2-100、P2-106～P2-108：方法說明的用語
const meta: CompareQualityMeta = {
  requestedRange: { startDate: '2026-07-05', endDate: '2026-10-05' },
  analysisRange: { startDate: '2026-07-06', endDate: '2026-10-02' },
  alignedDays: 60,
  samplesBySymbol: { '2330': 60 },
  missingRatioBySymbol: { '2330': 0 },
  qualityWarnings: ['2330 有 3.2% 的交易日缺資料；缺漏日不計入，最大回撤只用有資料的收盤價計算。'],
  generatedAt: '2026-10-05T15:00:00Z',
} as CompareQualityMeta;
const method = text(renderToStaticMarkup(<MethodologyPanel qualityMeta={meta} />));
for (const phrase of ['口徑', '時間戳', '可解釋性', 'Pearson', '起，查詢到', 'TAIEX', '公司行動', '年化波動度']) assert.ok(!method.includes(phrase), `Methodology still says「${phrase}」`);
assert.ok(method.includes('計算方式') && method.includes('資料時間：') && method.includes('資料提醒'));
assert.ok(method.includes('2026-07-06 → 2026-10-02') && method.includes('查詢條件：2026-07-05 → 2026-10-05'));
assert.ok(methodFinding(meta, 61).includes('1 項資料提醒'));

// P2-099、P2-100：比較結果帳頁
const hero = text(renderToStaticMarkup(<CompareHero symbols={['2330', '2317']} symbolColors={{}} stockInfos={{}} requestedRange={meta.requestedRange} analysisRange={meta.analysisRange} alignedDays={60} onJumpToControls={() => {}} />));
assert.ok(hero.includes('修改條件') && !hero.includes('換股 / 換期間'));
assert.ok(hero.includes('查詢條件：2026-07-05 → 2026-10-05') && !hero.includes('查詢到'));

// P2-098：法人發現的負號；P1-21：單位是張
assert.equal(
  institutionalFinding(['2330', '2317'], {
    '2330': { symbol: '2330', totalNet: -80755500 } as never,
    '2317': { symbol: '2317', totalNet: 1200000 } as never,
  }),
  '期間合計淨額最高 2317（+1,200 張）、最低 2330（−80,756 張）',
);

// P2-102：技術指標快照的欄名與數字格式
const technical = text(renderToStaticMarkup(<TechnicalSnapshotTable symbols={['2330']} symbolColors={{}} latestMap={{
  '2330': { date: '2026-10-02', close: 100, ma20: 105, ma60: 90, rsi10: 61.35, kd_k9: 83.82, kd_d9: 74.88, macd_hist: -0.4213 } as never,
}} />));
for (const phrase of ['vs MA', 'KD (K/D)', 'MACD 動能', 'MACD 多方', 'MACD 空方']) assert.ok(!technical.includes(phrase), phrase);
assert.ok(technical.includes('KD（K／D）') && technical.includes('相對 MA20') && technical.includes('MACD 柱'));
assert.ok(technical.includes('61.4') && technical.includes('83.8 / 74.9') && technical.includes('−0.421') && technical.includes('−4.76%'));
assert.ok(technical.includes('偏空'), 'MACD reading uses 偏多／偏空／中性');

console.log('Compare copy checks passed.');
