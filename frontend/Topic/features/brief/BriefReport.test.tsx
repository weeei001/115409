import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { UseStockTextBriefResult } from '../../lib/hooks/useStockTextBrief';
import type { Brief, EvidenceItem, TextBriefResponse } from '../../lib/types/textBrief';
import { renderedText } from '../../lib/testing/markup';
import { BriefReport } from './BriefReport';
import { StockTextBriefPanel } from './StockTextBriefPanel';

const CATALOG: EvidenceItem[] = [
  { id: 'd_01', field: 'daily_timeline', date: '2026-09-02', value: { close: 100 } },
  { id: 'fd_06', field: 'per', date: '2026-09-03', value: 28.98 },
];
const claim = (id: string, text: string) => ({ id, claim_type: 'observation', text, evidence_ids: ['fd_06'] });
const BRIEF = {
  headline: '估值偏高、方向整理',
  overall_stance: 'neutral',
  confidence: 'medium',
  current_status: [claim('cs_01', '本益比約 28.98 倍')],
  positive_factors: [claim('pos_01', '一'), claim('pos_02', '二'), claim('pos_03', '三'), claim('pos_04', '第四項也要印出來')],
  negative_factors: [],
  risks: [{ id: 'rk_01', risk_type: '估值', description: '估值修正', trigger: '本益比回落', evidence_ids: ['zz_09'] }],
  watch_points: [],
  key_days: [{ id: 'kd_01', date: '2026-09-02', what: '小漲', evidence_ids: ['d_01'], move_pct: 1.2 }],
  forward_views: { short_1_5: { stance: 'neutral', reason: '整理', invalidation: '未確認', evidence_ids: ['fd_06'] } },
  limitations: ['沒有大盤對照'],
} as unknown as Brief;
const DATA = {
  symbol: '2330', as_of_date: '2026-09-03', status: 'limited', brief: BRIEF, evidence_catalog: CATALOG,
  generated_by: 'test-model', analysis_revision: 'abc123', past_review_count: 1, limitations: ['缺少：近期新聞'],
} as TextBriefResponse;

{
  const html = renderToStaticMarkup(React.createElement(BriefReport, { data: DATA, title: '2330 台積電 AI 分析報告' }));
  const plain = renderedText(html);
  assert.ok(plain.includes('列印／存成 PDF'));
  assert.ok(plain.includes('模型test-model'), 'dt and dd are adjacent text nodes');
  assert.ok(plain.includes('參考 1 則已到期判斷的檢討'));
  // 抽屜裡收在「展開更多」的第 4 項，報告直接印出
  assert.ok(plain.includes('第四項也要印出來'));
  assert.ok(plain.includes('依據：本益比'));
  assert.ok(plain.includes('另有 1 筆引用無法核對，未列入'), 'the risk cites an id missing from the catalog');
  for (const title of ['現在是什麼狀態', '正面因素', '負面因素', '不同時間長度的看法', '情境風險', '接下來觀察什麼', '關鍵交易日', '這份分析看不到的部分', '分析限制', '引用資料']) {
    assert.ok(html.includes(`>${title}</h2>`), title);
  }
  assert.ok(!html.includes('>資料互相矛盾的地方</h2>'), 'an empty divergence section is left out, as in the drawer');
  assert.ok(plain.includes('缺少：近期新聞'));
  // 附錄只列被引用的資料
  assert.ok(plain.includes('09/02 交易資料') && plain.includes('本益比'));
  assert.ok(html.includes('print:hidden'), 'the print button and contents are not printed');
}

{
  const brief = {
    loading: false, error: null, data: DATA, seconds: 0, run: async () => {}, reset: () => {},
  } as unknown as UseStockTextBriefResult;
  const html = renderToStaticMarkup(React.createElement(StockTextBriefPanel, { symbol: '2330', brief }));
  assert.ok(html.includes('href="/stock/2330/report"') && html.includes('target="_blank"'));
  assert.ok(renderedText(html).includes('分析版本abc123'));
}

console.log('Brief report render passed: provenance, every item expanded, cited sources, drawer link.');
