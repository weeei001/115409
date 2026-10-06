import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { UseStockTextBriefResult } from '../../lib/hooks/useStockTextBrief';
import type { Brief, EvidenceItem, TextBriefResponse } from '../../lib/types/textBrief';
import { buildEvidenceIndex } from '../../lib/brief/textBriefEvidence';
import { AI_RESEARCH_ONLY } from '../../lib/disclaimers';
import { AIBriefSummaryCard } from './AIBriefSummaryCard';
import { StockTextBriefPanel } from './StockTextBriefPanel';
import { EvidenceTagList } from './BriefAtoms';
import { EvidenceDetail } from './EvidenceDetail';
import { restoreFocus } from './EvidencePanel';
import { resolveEvidenceItem } from '../../lib/brief/textBriefEvidence';

const text = (html: string) => html.replace(/<[^>]+>/g, '');

const CATALOG: EvidenceItem[] = [
  { id: 'fd_06', field: 'per', date: '2026-09-03', value: 28.98 },
  { id: 'ch_01', field: 'foreign_net_10d_lots', date: '2026-09-03', value: -1200 },
];

const claim = (id: string, body: string) => ({ id, claim_type: 'observation', text: body, evidence_ids: ['fd_06'] });

/** 2330 的情況：負面因素 3 項、情境風險 0 項（被檢查刪掉或 AI 沒列） */
const BRIEF = {
  overall_stance: 'neutral',
  confidence: 'low',
  headline: '整理中',
  positive_factors: [claim('pos_01', 'EPS 年增'), claim('pos_02', '營收創高')],
  negative_factors: [claim('neg_01', '本益比約 28.98 倍'), claim('neg_02', '外資雙向進出'), claim('neg_03', '量能不足')],
  source_divergences: [],
  risks: [],
} as unknown as Brief;

function briefResult(data: Partial<TextBriefResponse>): UseStockTextBriefResult {
  return {
    loading: false,
    error: null,
    data: { as_of_date: '2026-09-03', evidence_catalog: CATALOG, ...data } as TextBriefResponse,
    seconds: 0,
    run: async () => {},
    reset: () => {},
  } as unknown as UseStockTextBriefResult;
}

/* ── P0-4：摘要寫「負面 n」，面向分級改叫情境風險，空的時候不說沒有風險 ── */
{
  const html = renderToStaticMarkup(
    React.createElement(AIBriefSummaryCard, { symbol: '2330', brief: briefResult({ brief: BRIEF }), onOpenDetail: () => {} })
  );
  const plain = text(html);

  // 摘要用實際總數（負面 3），不是截斷後的 2
  assert.ok(plain.includes('正面 2・負面 3・分歧 0・分級 5'), plain);
  // 每一段不斷行，375 寬不會把數字和名稱拆開
  assert.ok(html.includes('<span class="whitespace-nowrap">負面 3</span>'));
  assert.ok(!/風險 \d+ 項/.test(plain), '摘要不能再把負面因素叫「風險 n 項」');
  assert.ok(plain.includes('負面因素'));
  assert.ok(plain.includes('另有 1 項，見完整分析。'));

  // 面向分級：情境風險，沒有資料時不能寫成「沒有列出風險」
  assert.ok(plain.includes('情境風險'));
  assert.ok(plain.includes('本次未列出或未通過檢查（不代表沒有風險）'));
  assert.ok(!plain.includes('沒有列出風險項目'));

  // 評價：有本益比、沒有百分位時要講缺的是百分位，不提內部的「證據目錄」
  assert.ok(plain.includes('缺少近一年百分位，無法分級'));
  assert.ok(!plain.includes('證據目錄'));

  assert.ok(plain.includes(AI_RESEARCH_ONLY));
}

/* ── 完整分析：預設免責、檢查說明、分號後不多半形空格 ── */
{
  const stale = briefResult({ brief: BRIEF, price_as_of_date: '2026-09-03', news_cutoff_date: '2026-09-03' });
  const plain = text(
    renderToStaticMarkup(
      React.createElement(StockTextBriefPanel, { symbol: '2330', brief: stale, latestTradeDate: '2026-09-10' })
    )
  );
  assert.ok(plain.includes(`AI 依公開資料整理，${AI_RESEARCH_ONLY}投資前請自行評估風險。`));
  assert.ok(!plain.includes('不代表保證獲利'));
  assert.ok(plain.includes('系統只檢查格式、引用和部分數字，沒有驗證推論是否正確。'));
  assert.ok(!plain.includes('語義'));
  assert.ok(!/；\s/.test(plain), `全形分號後不能接半形空格：${plain}`);
  assert.ok(!plain.includes('證據目錄'));
}

/* ── 來源標籤不把內部 id 給使用者看 ── */
{
  const index = buildEvidenceIndex(CATALOG, '2026-09-03');
  const html = renderToStaticMarkup(
    React.createElement(EvidenceTagList, { ids: ['fd_06', 'zz_99'], index })
  );
  assert.ok(!html.includes('fd_06'));
  assert.ok(!html.includes('zz_99'));
  assert.ok(!html.includes('原始代號'));
  assert.ok(html.includes('在證據來源裡找不到這筆資料'));
}

/* ── 財測展望：「非實際財報」，不用「數據」 ── */
{
  const item = resolveEvidenceItem({ id: 'nw_01', field: 'news', value: '法說會展望', kind: 'guidance' } as EvidenceItem);
  const html = renderToStaticMarkup(React.createElement(EvidenceDetail, { item, usedBy: [] }));
  assert.ok(html.includes('公司展望，非實際財報'));
  assert.ok(!html.includes('數據'));
}

/* ── 手機證據詳情關閉後焦點回到論點按鈕；按鈕不在了就回到 AI 抽屜的關閉鈕 ── */
{
  const focused: string[] = [];
  const el = (name: string, connected = true) =>
    ({ isConnected: connected, focus: () => focused.push(name) }) as unknown as HTMLElement;
  const dialog = (connected = true) =>
    ({
      isConnected: connected,
      querySelector: (selector: string) => (selector === '[data-slot="sheet-close"]' ? el('drawer-close') : null),
    }) as unknown as HTMLElement;

  restoreFocus(el('claim'), dialog());
  assert.deepEqual(focused, ['claim']);

  focused.length = 0;
  restoreFocus(el('claim', false), dialog());
  assert.deepEqual(focused, ['drawer-close']);

  focused.length = 0;
  restoreFocus(null, dialog(false));
  assert.deepEqual(focused, []);
}

/* ── P2-018：立場寫出判定方式、不是評級；信心低時不上色、標明僅供參考 ── */
{
  const render = (brief: Brief) => renderToStaticMarkup(
    React.createElement(AIBriefSummaryCard, { symbol: '2330', brief: briefResult({ brief }), onOpenDetail: () => {} })
  );
  const low = render(BRIEF);
  assert.ok(text(low).includes('立場：現有資料支持盤整，不是資料不足。'), text(low));
  assert.ok(text(low).includes('不是評級，也不是買賣建議'));
  assert.ok(text(low).includes('分析信心 低，方向判讀僅供參考'));
  const high = render({ ...BRIEF, overall_stance: 'mildly_bullish', confidence: 'high' } as Brief);
  assert.ok(text(high).includes('立場：證據偏向上漲一側，但仍有具體限制。'));
  assert.ok(!text(high).includes('僅供參考，') && !text(high).includes('方向判讀僅供參考'));
  // 信心低的立場標籤用較小字級；信心高照常
  assert.ok(low.includes('text-[13px]') && /class="[^"]*text-sm[^"]*"[^>]*>(?:<svg[\s\S]*?<\/svg>)?溫和偏多/.test(high));
}

console.log('AI brief summary card / panel copy tests passed');
