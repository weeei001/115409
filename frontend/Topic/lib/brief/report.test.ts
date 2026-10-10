import assert from 'node:assert/strict';
import type { Brief, EvidenceItem, TextBriefResponse } from '../types/textBrief';
import type { AIUsageSummary } from '../types/api';
import { buildEvidenceIndex } from './textBriefEvidence';
import { briefProvenance } from './provenance';
import { citationLabels, reportAppendix } from './report';
import { avgTokensText, costNote, latencyText, retryText, tokenSplitText, usdText } from './usage';

const CATALOG: EvidenceItem[] = [
  { id: 'd_01', field: 'daily_timeline', date: '2026-09-02', value: { close: 100, chg_pct: 1.2 } },
  { id: 'd_02', field: 'daily_timeline', date: '2026-09-03', value: { close: 101, chg_pct: 1 } },
  { id: 'fd_06', field: 'per', date: '2026-09-03', value: 28.98 },
  { id: 'nw_01', field: 'news', date: '2026-09-03', value: '台積電法說會釋出展望', title: '法說會', publisher: '鉅亨網', url: 'https://example.com/a' },
  { id: 'nw_02', field: 'news', date: '2026-09-09', value: '基準日之後的新聞', publisher: '自由財經' },
];
const evidence = buildEvidenceIndex(CATALOG, '2026-09-03');

/* ── 產生條件：全部取自回應與目錄，未啟用檢討回饋時不列 ── */
{
  const data = {
    symbol: '2330', as_of_date: '2026-09-03', status: 'verified', price_as_of_date: '2026-09-03',
    generated_at: '2026-09-03T09:30:00+00:00', generated_by: 'google/gemma-4-31b-it', analysis_revision: 'a1b2c3d4e5f6',
  } as TextBriefResponse;
  const rows = Object.fromEntries(briefProvenance(data, evidence).map((row) => [row.label, row.value]));
  assert.equal(rows['分析基準日'], '2026-09-03');
  assert.equal(rows['新聞截止'], '2026-09-03', 'falls back to the analysis date');
  assert.equal(rows['產生時間'], '台北時間 2026/09/03 17:30');
  assert.equal(rows['模型'], 'google/gemma-4-31b-it');
  assert.equal(rows['分析版本'], 'a1b2c3d4e5f6');
  assert.equal(rows['使用資料'], '交易資料 2 筆、基本面 1 筆、新聞 2 則');
  assert.equal(rows['新聞來源'], '鉅亨網、自由財經');
  assert.equal(rows['過去檢討'], undefined, 'not shown when the feature is off');

  const bare = Object.fromEntries(briefProvenance({ symbol: '2330', as_of_date: '2026-09-03', status: 'limited' } as TextBriefResponse,
    buildEvidenceIndex([], '2026-09-03')).map((row) => [row.label, row.value]));
  assert.equal(bare['模型'], '未提供');
  assert.equal(bare['使用資料'], '未提供');
  assert.equal(bare['新聞來源'], undefined);

  const withReviews = (count: number) => briefProvenance({ ...data, past_review_count: count }, evidence).at(-1)!.value;
  assert.equal(withReviews(2), '參考 2 則已到期判斷的檢討');
  assert.equal(withReviews(0), '還沒有已到期判斷的檢討');
}

/* ── 報告的依據與附錄：只列被引用、而且可用的資料 ── */
{
  assert.deepEqual(citationLabels(['fd_06', 'd_02', 'fd_06', 'nw_02', 'zz_99'], evidence),
    { labels: ['本益比', '09/03 交易資料'], unusable: 2 });

  const brief = {
    headline: '整理',
    current_status: [{ id: 'cs_01', text: '收盤上漲', evidence_ids: ['d_02'] }],
    positive_factors: [{ id: 'pos_01', text: '法說展望', evidence_ids: [], news_support: [{ evidence_id: 'nw_01', quote: '釋出展望', use: 'reported_fact' }] }],
    negative_factors: [{ id: 'neg_01', text: '未來新聞', evidence_ids: ['nw_02'] }],
    forward_views: { short_1_5: { stance: 'neutral', reason: '估值偏高', invalidation: '未確認', evidence_ids: ['fd_06'] } },
  } as unknown as Brief;
  const appendix = reportAppendix(brief, evidence);
  assert.deepEqual(appendix.groups.map((group) => [group.label, group.items.map((item) => item.id)]),
    [['交易資料', ['d_02']], ['基本面', ['fd_06']], ['新聞', ['nw_01']]]);
  assert.equal(appendix.uncited, 1, 'd_01 is usable but not cited');
  assert.equal(appendix.unusable, 1, 'nw_02 is dated after the analysis date');
}

/* ── 管理後台的用量與成本文字 ── */
{
  const usage: AIUsageSummary = {
    days: 30, briefs: 40, unavailable: 2, measured: 38, avg_prompt_tokens: 18234.4, avg_completion_tokens: 2890.6,
    avg_latency_seconds: 41.26, retry_rate: 0.125, input_price_per_m: 0.2, output_price_per_m: 1.2,
    avg_cost_usd: 0.007116, total_cost_usd: 0.2704,
  };
  assert.equal(avgTokensText(usage), '21,125');
  assert.equal(tokenSplitText(usage), '輸入 18,234 · 輸出 2,891');
  assert.equal(latencyText(usage), '41.3 秒');
  assert.equal(retryText(usage), '需要第二次呼叫 12.5%');
  assert.equal(usdText(usage.avg_cost_usd), 'US$0.0071');
  assert.equal(usdText(12.345), 'US$12.35');
  assert.equal(usdText(null), '--');
  assert.match(costNote(usage), /^以設定的單價估算：輸入每百萬 token US\$0\.20、輸出 US\$1\.20。40 份中有 38 份有 token 紀錄/);
  assert.match(costNote(usage), /其中 2 份沒有通過檢查/);
  assert.match(costNote({ ...usage, input_price_per_m: 0.075 }), /輸入每百萬 token US\$0\.075、/, 'finer prices are not rounded to cents');
  const empty = { ...usage, measured: 0, avg_prompt_tokens: null, avg_completion_tokens: null, avg_latency_seconds: null, retry_rate: null };
  assert.equal(avgTokensText(empty), '--');
  assert.equal(tokenSplitText(empty), '還沒有 token 紀錄');
  assert.equal(retryText(empty), '沒有重試紀錄');
}

console.log('Brief report passed: provenance rows, cited-only appendix, usage and cost copy.');
