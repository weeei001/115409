import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EvidenceDetail } from '../../features/brief/EvidenceDetail';
import { KeyPointsTab, ScenarioTab } from '../../features/brief/BriefSections';
import type { Brief, EvidenceItem } from '../types/textBrief';
import { buildEvidenceIndex, resolveEvidenceItem } from './textBriefEvidence';
import { buildClaimIndex, claimsUsingEvidence } from './textBriefClaims';
import { buildFacets, FACET_RULES } from './textBriefFacets';

/** 取自 /analyze/stock-behavior/text-brief 對 2330 的實際回應 */
const CATALOG: EvidenceItem[] = [
  {
    id: 'd_40',
    field: 'daily_timeline',
    date: '2026-09-03',
    value: { close: 2390, chg_pct: 0.21, vol_lots: 13477, vol_vs_ma5_pct: -43, foreign_net_lots: -961 },
  },
  { id: 'ch_01', field: 'foreign_net_10d_lots', date: '2026-09-03', value: 3989 },
  { id: 'lt_04', field: 'vs_ma60_pct', date: '2026-09-03', value: 0.1 },
  { id: 'lt_03', field: 'close_pos_in_1y_pct', date: '2026-09-03', value: 91.1 },
  {
    id: 'fd_01',
    field: 'eps',
    date: '2026-06-30',
    period: '2026Q2',
    value: 27.25,
    qoq_pct: 23.4,
    yoy_pct: 77.4,
    last4q: [
      ['2025Q3', 17.44],
      ['2026Q2', 27.25],
    ],
  },
  { id: 'fd_06', field: 'per', date: '2026-09-02', value: 27.65, pct_rank_1y: 42 },
  {
    id: 'nw_11',
    field: 'news',
    date: '2026-07-17',
    kind: 'general',
    title: '焦點股》台積電：跳水大跌逾3％',
    value: '晶圓代工龍頭台積電昨日召開法說會，釋出的毛利率展望低於市場預期。',
    url: 'https://news.ltn.com.tw/news/example',
    publisher: '自由時報',
  },
  // 舊快照沒有 url／publisher，畫面要顯示「系統彙整資料」而不是編一個網址
  {
    id: 'nw_12',
    field: 'news',
    date: '2026-07-16',
    kind: 'guidance',
    title: 'AI浪潮助攻 多家機構看好台積電',
    value: '台積電在法說會中釋出的正向訊號是推升股價預期的關鍵。',
  },
  // 日期晚於基準日：資料有問題，不可當成可用來源
  { id: 'd_99', field: 'daily_timeline', date: '2026-09-10', value: { close: 2500, chg_pct: 1.5 } },
];

const AS_OF = '2026-09-03';

/* ── 可讀名稱：畫面上不再出現 fd_01 / d_40 這種內部代號 ─────────── */
{
  const label = (id: string) =>
    resolveEvidenceItem(CATALOG.find((item) => item.id === id)!, AS_OF).label;

  assert.equal(label('d_40'), '09/03 交易資料');
  assert.equal(label('ch_01'), '近十日外資統計');
  assert.equal(label('lt_04'), '相對季線位置');
  assert.equal(label('fd_01'), '2026Q2 每股盈餘');
  assert.equal(label('fd_06'), '本益比');
  assert.equal(label('nw_11'), '07/17 自由時報報導');
  // 沒有發布媒體時退回中性說法，不猜是誰發的
  assert.equal(label('nw_12'), '07/16 財經新聞');
}

/* ── 顯示數字必須與證據一致，換算單位時保留原始值 ───────────────── */
{
  const daily = resolveEvidenceItem(CATALOG[0], AS_OF);
  assert.deepEqual(
    daily.metrics.map((metric) => `${metric.name} ${metric.value}`),
    [
      '收盤價 2390 元',
      '漲跌幅 +0.21%',
      '成交量 13,477 張',
      '量能較五日均量 -43%',
      '外資買賣超 −961 張',
    ]
  );

  const eps = resolveEvidenceItem(CATALOG[4], AS_OF);
  assert.equal(eps.metrics[0].value, '27.25 元');
  assert.ok(eps.metrics.some((metric) => metric.name === '年增' && metric.value === '+77.4%'));

  const revenue = resolveEvidenceItem(
    { id: 'fd_04', field: 'revenue_monthly', period: '2026-07', value: 467580548000, yoy_pct: 44.7 },
    AS_OF
  );
  assert.equal(revenue.metrics[0].value, '4675.81 億元（467,580,548,000 元）');

  const chips = resolveEvidenceItem(CATALOG[1], AS_OF);
  assert.equal(chips.metrics[0].value, '+3,989 張');
}

/* ── 出處 metadata：有就顯示，沒有就留空，不編 ───────────────────── */
{
  const withUrl = resolveEvidenceItem(CATALOG[6], AS_OF);
  assert.equal(withUrl.url, 'https://news.ltn.com.tw/news/example');
  assert.equal(withUrl.publisher, '自由時報');
  assert.equal(withUrl.category, 'news');

  const withoutUrl = resolveEvidenceItem(CATALOG[7], AS_OF);
  assert.equal(withoutUrl.url, null);
  assert.equal(withoutUrl.publisher, null);
  // 財測展望要另外分類，不能顯示成已實現的財務結果
  assert.equal(withoutUrl.category, 'guidance');
}

/* ── 索引與資料驗證 ─────────────────────────────────────────────── */
{
  const index = buildEvidenceIndex(CATALOG, AS_OF);

  assert.equal(index.total, CATALOG.length);
  assert.deepEqual(
    index.groups.map((group) => group.label),
    ['交易資料', '法人籌碼', '長期位階', '基本面', '新聞']
  );

  // 目錄查不到的引用不可顯示成可點擊來源
  assert.deepEqual(index.unresolved(['d_40', 'nope_01']), ['nope_01']);
  assert.equal(index.usable('d_40'), true);
  assert.equal(index.usable('nope_01'), false);

  // 證據日期不得晚於 as_of_date
  assert.deepEqual(index.futureDatedIds, ['d_99']);
  assert.equal(index.usable('d_99'), false);
  assert.equal(index.resolve('d_99')?.futureDated, true);

  const emptyIndex = buildEvidenceIndex([], AS_OF);
  assert.equal(emptyIndex.total, 0);
  assert.equal(emptyIndex.usable('d_40'), false);
}

/* ── 雙向反查 ───────────────────────────────────────────────────── */
{
  const brief = {
    headline: '基本面強、籌碼弱',
    current_status: [
      { id: 'cs_01', claim_type: 'observation', text: '股價在季線附近', evidence_ids: ['d_40', 'lt_04'] },
    ],
    positive_factors: [
      { id: 'pos_01', claim_type: 'observation', text: 'EPS 創高', evidence_ids: ['fd_01'] },
    ],
    negative_factors: [
      { id: 'neg_01', claim_type: 'inference', text: '外資調節', evidence_ids: ['d_40', 'ch_01'] },
    ],
    risks: [{ id: 'rk_01', risk_type: '籌碼', description: '外資賣超', trigger: '連續賣超', evidence_ids: ['ch_01'] }],
    watch_points: [
      { id: 'wp_01', what_to_watch: '外資轉買', why_it_matters: '確認轉折', when: '一週內', evidence_ids: ['ch_01'] },
    ],
    forward_views: {
      short_1_5: { stance: 'mildly_bearish', reason: '量能不足', invalidation: '站回月線', evidence_ids: ['d_40'] },
    },
  } as unknown as Brief;

  const claims = buildClaimIndex(brief);
  assert.deepEqual(claims.get('cs_01')?.evidenceIds, ['d_40', 'lt_04']);
  assert.equal(claims.get('rk_01')?.section, '情境風險');
  assert.equal(claims.get('fv:short_1_5')?.section, '短線 1–5 日');

  // 點證據 → 反查所有引用它的結論（順序＝畫面順序）
  assert.deepEqual(
    claimsUsingEvidence(claims, 'ch_01').map((ref) => ref.key),
    ['neg_01', 'rk_01', 'wp_01']
  );
  assert.deepEqual(
    claimsUsingEvidence(claims, 'd_40').map((ref) => ref.key),
    ['cs_01', 'neg_01', 'iv:short_1_5', 'fv:short_1_5']
  );
  assert.deepEqual(claimsUsingEvidence(claims, 'nope_01'), []);
  assert.equal(claims.get('neg_01')?.claimType, 'inference');
}

/* ── 面向分級：門檻寫死、依據可對帳，資料缺就說資料不足 ─────────── */
{
  const facets = buildFacets(CATALOG, { asOfDate: AS_OF, brief: { risks: [{}, {}, {}] } as Brief });
  const byKey = Object.fromEntries(facets.map((facet) => [facet.key, facet]));

  assert.equal(byKey.fundamental.levelLabel, '強'); // EPS 年增 77.4% ≥ 15%
  assert.ok(byKey.fundamental.basis.includes('+77.4%'));
  assert.deepEqual(byKey.fundamental.evidenceIds, ['fd_01']);

  assert.equal(byKey.valuation.levelLabel, '中性'); // 本益比第 42 百分位
  assert.equal(byKey.momentum.levelLabel, '普通'); // 相對季線 +0.1%
  assert.equal(byKey.chips.levelLabel, '買超'); // 近十日 +3,989 張
  assert.equal(byKey.risk.levelLabel, 'AI 列出 3 項');
  assert.equal(byKey.risk.label, '情境風險');

  // 門檻邊界
  const strong = buildFacets([
    { id: 'fd_01', field: 'eps', period: '2026Q2', value: 1, yoy_pct: FACET_RULES.fundamentalStrongYoyPct },
    { id: 'fd_06', field: 'per', value: 30, pct_rank_1y: FACET_RULES.valuationHighRank },
    { id: 'lt_04', field: 'vs_ma60_pct', value: FACET_RULES.momentumWeakPct },
    { id: 'ch_01', field: 'foreign_net_10d_lots', value: -1 },
  ]);
  const strongByKey = Object.fromEntries(strong.map((facet) => [facet.key, facet]));
  assert.equal(strongByKey.fundamental.levelLabel, '強');
  assert.equal(strongByKey.valuation.levelLabel, '偏高');
  assert.equal(strongByKey.momentum.levelLabel, '弱');
  assert.equal(strongByKey.chips.levelLabel, '賣超');

  // 沒有證據時不猜分數
  const unknown = buildFacets([], {});
  assert.deepEqual(
    unknown.map((facet) => facet.levelLabel),
    ['資料不足', '資料不足', '資料不足', '資料不足', '未列出']
  );
  // 缺資料時要寫出缺什麼，不提內部的「證據目錄」；情境風險空的時候不能說成沒有風險
  assert.ok(unknown.every((facet) => !facet.basis.includes('證據目錄')));
  assert.equal(unknown.find((facet) => facet.key === 'risk')!.basis, '本次未列出或未通過檢查（不代表沒有風險）');
  assert.equal(
    buildFacets([{ id: 'fd_06', field: 'per', value: 28.98 }]).find((facet) => facet.key === 'valuation')!.basis,
    '缺少近一年百分位，無法分級'
  );

  // 沒有均線證據時，技術動能不另找來源
  const fallback = buildFacets([]);
  const momentum = fallback.find((facet) => facet.key === 'momentum')!;
  assert.equal(momentum.levelLabel, '資料不足');
  assert.equal(momentum.evidenceIds.length, 0);

  // 日期晚於基準日的證據不參與分級
  const excluded = buildFacets(
    [{ id: 'ch_01', field: 'foreign_net_10d_lots', date: '2026-09-10', value: 5000 }],
    { asOfDate: AS_OF }
  );
  assert.equal(excluded.find((facet) => facet.key === 'chips')!.levelLabel, '資料不足');
}

{
  const source: EvidenceItem = { id: 'nw_shared', field: 'news', value: 'Monthly revenue', shared_fact_ids: ['revenue_1'] };
  assert.match(resolveEvidenceItem(source).publicationBasis ?? '', /不代表多份獨立證據/);
  assert.equal(resolveEvidenceItem({ ...source, shared_fact_ids: [] }).publicationBasis, null);
}

{
  const source: EvidenceItem = {
    id: 'nw_saved', field: 'news', value: 'Saved article', article_id: 'article-123', url: 'https://example.com/original',
    source_state: { eligible: true, status: 'active', revision_id: 'a'.repeat(64) },
  };
  const resolved = resolveEvidenceItem(source);
  assert.equal(resolved.url, source.url);
  assert.equal(resolved.savedVersionUrl, `/news/article-123?revision_id=${'a'.repeat(64)}`);
  const html = renderToStaticMarkup(React.createElement(EvidenceDetail, { item: resolved, usedBy: [] }));
  assert.ok(html.includes('href="https://example.com/original"'));
  assert.ok(html.includes(`href="/news/article-123?revision_id=${'a'.repeat(64)}"`));
  assert.equal(resolveEvidenceItem({ ...source, source_state: undefined }).savedVersionUrl, null);
  assert.equal(resolveEvidenceItem({ ...source, article_id: '../other' }).savedVersionUrl, null);
  assert.equal(resolveEvidenceItem({ ...source, source_state: { eligible: true, status: 'active', revision_id: 'invalid' } }).savedVersionUrl, null);
}

console.log('textBrief evidence / claims / facets tests passed');

{
  const item = resolveEvidenceItem({ id: 'd_40', field: 'daily_timeline', value: { close: 2475, macd: 12, macd_signal: 6.19, macd_hist: 5.81 } });
  assert.ok(item.metrics.some(metric => metric.name === 'MACD 柱' && metric.value === '5.81'));
  assert.ok(item.metrics.some(metric => metric.name === 'MACD 訊號線' && metric.value === '6.19'));
  assert.ok(item.metrics.some(metric => metric.name === '收盤價' && metric.value === '2475 元'));
  const empty = {} as Brief;
  const scenario = renderToStaticMarkup(React.createElement(ScenarioTab, { brief: empty }));
  const points = renderToStaticMarkup(React.createElement(KeyPointsTab, { brief: empty }));
  assert.ok(scenario.includes('沒有通過檢查的依據'));
  assert.ok(scenario.includes('這不代表沒有風險'));
  assert.ok(scenario.includes('觀察點判讀'));
  assert.ok(points.includes('這不代表沒有風險'));
  const industry = resolveEvidenceItem({ id: 'nw_industry', field: 'news', value: 'Shipping demand',
    source_relationships: [{ symbol: '2603', scope: 'industry', relationship: 'industry_context', target_id: 'TWSE:15' }] });
  assert.ok(industry.publicationBasis?.includes('產業背景，不代表這家公司已發生相同事件'));
}
