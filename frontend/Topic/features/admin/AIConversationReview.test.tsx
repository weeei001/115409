import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import apiClient, { ApiRequestError } from '@/lib/api/client';
import { INITIAL_ADMIN_CHAT_FILTERS, type AdminChatDetail, type AdminChatList, type AdminChatSummary } from '@/lib/api/adminChat';
import { renderedElements, renderedText } from '@/lib/testing/markup';
import { AIConversationDetail, AIConversationDetailState, AIConversationList, AIConversationReview } from './AIConversationReview';
import { useAIConversationReview } from './useAIConversationReview';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
const noop = () => undefined;
const attack = '<script>unsafe()</script><img src=x onerror="unsafe()">';
const summary: AdminChatSummary = {
  id: 'c327bda8-8c63-469a-9f42-77a09a914ee7', created_at: '2026-10-08T10:01:02Z',
  user_id: 4, user_email: 'investor@example.test', conversation_id: 'c891d01b-e413-4891-87a9-e209f40a1b2a',
  turn_id: '0b74bd7b-4d9b-4d62-914c-8437e486e9dc', outcome: 'fallback', reason: 'numbers', reasons: ['numbers', 'length'],
  query_preview: '請參考我的持股，討論下一步投資安排', model: 'fixture-model', duration_ms: 31415, attempt_count: 2,
  source_count: 1, publication_completed: true,
};
const record: AdminChatDetail = {
  ...summary, schema_version: 1, query: `${summary.query_preview}\n${attack}`, query_truncated: false, query_original_chars: 99,
  final_answer: '這次分析未能完成核對。以下是可核對資料的安全摘要。', final_answer_truncated: false, final_answer_original_chars: 35,
  attempts: [
    { number: 1, stage: 'initial', text: `未通過原稿 ${attack}`, text_truncated: false, original_chars: 99, finish_reason: 'stop', truncated: false,
      validation: 'rejected', reason: 'numbers', hint: '請重新核對期間与單位', claim: '股數不吻合', detail: '數字不符合本段來源',
      diagnostics_truncated: false, duration_ms: 10000, tokens: { input: 1200, output: 400, thinking: null }, max_tokens: 4096 },
    { number: 2, stage: 'repair', text: '修復稿僅保留這一段', text_truncated: true, original_chars: 90000, finish_reason: 'length', truncated: true,
      validation: 'rejected', reason: 'length', hint: null, claim: null, detail: '回答未正常結束', duration_ms: 21000,
      diagnostics_truncated: true, tokens: { input: 1250, output: 2048, thinking: 1700 }, max_tokens: 2048 },
  ],
  sources: [{ citation_id: 'S1', title: `來源 ${attack}`, source: 'paper', source_name: '模擬投資', category: 'portfolio', pub_time: '2026-10-09',
    url: 'javascript:unsafe()', stock_id: '2330', stock_ids: ['2330'], content: `可用資金50000元。${attack}`, content_truncated: true,
    original_chars: 90000, snapshot_truncated: true, source_state: { detail: attack } }],
  sources_truncated: true, tokens: { input: 2450, output: 2448, thinking: null }, request_timeout_seconds: 60, repair_max_tokens: 2048,
  requires_portfolio: true, answer_detail: 'plain', error_type: null,
};
const second: AdminChatSummary = { ...summary, id: '29d2cb9b-033f-4678-b5ee-4bc050cd6c6d', query_preview: '另一筆問題', outcome: 'passed', reasons: [], reason: null };
const listData: AdminChatList = { items: [summary, second], total: 41, retention_days: 14 };

const list = renderToStaticMarkup(<AIConversationList data={listData} loading={false} error={null} selectedId={null} onSelect={noop} onRetry={noop} onShowAll={noop} />);
assert.match(renderedText(list), /安全回覆/);
assert.match(renderedText(list), /2026\/10\/8 18:01:02/);
assert.match(renderedText(list), /數值未通過 numbers/);
assert.match(renderedText(list), /2 輪生成 · 1 筆來源/);
assert.equal(renderedElements(list, 'button').filter((node) => node.attribs['aria-haspopup'] === 'dialog').length, 2);

const detailMarkup = renderToStaticMarkup(<AIConversationDetail record={record} />);
const detailText = renderedText(detailMarkup);
for (const expected of [record.query, record.final_answer, record.attempts[0].text, record.attempts[1].text, record.sources[0].content,
  '來源欄位與歸屬資料', '模型截斷標記：是', '輸出上限 2,048 tokens', '思考 —', '給修復流程的提示', '股數不吻合']) {
  assert.ok(detailText.includes(expected), `Missing debugging evidence: ${expected}`);
}
assert.equal(renderedElements(detailMarkup, 'script').length, 0);
assert.equal(renderedElements(detailMarkup, 'img').length, 0);
assert.equal(renderedElements(detailMarkup, 'a').length, 0, 'Untrusted source URLs are shown as text, never executable links.');
assert.match(detailText, /AI 服務已交出完整結果。對話是否保存、瀏覽器是否完整接收，仍需另行核對/);
assert.match(detailText, /除錯紀錄已裁切.*不是完整原文/);
assert.match(detailText, /部分來源或欄位未完整保存/);
assert.match(detailText, /檢核訊息已裁切/);
assert.match(detailText, /已回報 Token 合計/);
assert.match(detailText, /引用編號存在，不代表来源|引用編號存在，不代表來源/);

const recovered = renderToStaticMarkup(<AIConversationDetail record={{
  ...record, outcome: 'repaired',
  attempts: record.attempts.map((attempt) => ({ ...attempt, issue: attempt.number === 1 ? 'unparsed' : 'conclusion_unsupported' })),
  recovery: { method: 'validated_partial', draft_stage: 'initial', validation: 'passed', removed: [
    { paragraph: 0, reason: 'unsupported_conclusion', result: 'narrowed' },
    { reason: 'partial_recovery', result: 'retained', units: 2 },
  ] },
}} />);
assert.match(renderedText(recovered), /句型解析失敗（尚未確認對錯）/);
assert.match(renderedText(recovered), /2 輪稿件未通過完整檢核/);
assert.match(renderedText(recovered), /保留內容經本機重新核對通過/);
assert.match(renderedText(recovered), /結論缺乏依據 · 已收斂/);
assert.match(renderedText(recovered), /已保留（2 個內容單位）/);
assert.doesNotMatch(detailText, /保留內容經本機重新核對通過/);

const direct = renderToStaticMarkup(<AIConversationDetail record={{
  ...record, schema_version: 2, outcome: 'direct', reason: null, reasons: [], recovery: null, repair_max_tokens: null,
  attempts: [{ ...record.attempts[0], validation: 'not_checked', reason: null, hint: null, claim: null, detail: null }],
}} />);
assert.match(renderedText(direct), /本輪直接回覆，未執行回答內容檢核/);
assert.match(renderedText(direct), /未執行檢核/);
assert.doesNotMatch(renderedText(direct), /尚未檢核|尚未完成檢核|不是提供給使用者的有效分析/);
assert.doesNotMatch(renderedText(direct), /修復輸出上限|給修復流程的提示/);
assert.match(detailText, /修復輸出上限/);

const loading = renderToStaticMarkup(<AIConversationList data={listData} loading error={null} selectedId={null} onSelect={noop} onRetry={noop} onShowAll={noop} />);
assert.match(loading, /aria-busy="true"/);
assert.ok(!renderedText(loading).includes(summary.query_preview), 'Old rows are hidden while a new filter or page loads.');
const failed = renderToStaticMarkup(<AIConversationList data={listData} loading={false} error="檢核資料表尚未初始化" selectedId={null} onSelect={noop} onRetry={noop} onShowAll={noop} />);
assert.match(failed, /role="alert"/);
assert.match(renderedText(failed), /資料表尚未初始化/);
assert.ok(!renderedText(failed).includes(summary.query_preview));
const empty = renderToStaticMarkup(<AIConversationList data={{ ...listData, items: [], total: 0 }} loading={false} error={null} selectedId={null} onSelect={noop} onRetry={noop} onShowAll={noop} />);
assert.match(renderedText(empty), /功能上線後開始保存.*過去被擋下的原稿無法回補/);
assert.doesNotMatch(renderedText(empty), /全部通過|所有回答正確/);
const detailLoading = renderToStaticMarkup(<AIConversationDetailState record={record} loading error={null} onRetry={noop} />);
assert.ok(!renderedText(detailLoading).includes(record.final_answer), 'The previously selected response must not show under a new selection.');
const interrupted = renderToStaticMarkup(<AIConversationDetail record={{ ...record, outcome: 'interrupted', publication_completed: false, final_answer: '', attempts: [] }} />);
assert.match(renderedText(interrupted), /尚未確認 AI 服務交出完整結果/);
assert.match(renderedText(interrupted), /本輪沒有保存最後回覆/);
const shell = renderToStaticMarkup(<AIConversationReview onAccessError={() => false} />);
assert.match(shell, /label for="ai-review-search"/);
assert.match(renderedText(shell), /問題、使用者或對話 ID/);
assert.equal(renderedElements(shell, 'form').length, 1);

interface HeldRequest {
  config: InternalAxiosRequestConfig;
  resolve: (response: AxiosResponse) => void;
  reject: (error: unknown) => void;
}
const held: HeldRequest[] = [];
let state: ReturnType<typeof useAIConversationReview>;
const current = () => state;
const accessErrors: unknown[] = [];
function Harness() {
  state = useAIConversationReview((error) => {
    if (error instanceof ApiRequestError && [401, 403].includes(error.status ?? 0)) { accessErrors.push(error); return true; }
    return false;
  });
  return null;
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const last = () => held.at(-1)!;
const answer = (request: HeldRequest, data: unknown) => request.resolve({ data, status: 200, statusText: 'OK', headers: {}, config: request.config });

async function main() {
  const originalAdapter = apiClient.defaults.adapter;
  let renderer: ReactTestRenderer | undefined;
  apiClient.defaults.adapter = (config) => new Promise((resolve, reject) => held.push({ config, resolve, reject }));
  try {
    await act(async () => { renderer = create(<Harness />); await flush(); });
    assert.deepEqual(last().config.params, { days: 14, limit: 20, offset: 0, outcome: 'attention' });
    await act(async () => { answer(last(), listData); await flush(); });
    assert.equal(state.list?.total, 41);

    await act(async () => { state.select(summary.id); await flush(); });
    const firstDetail = last();
    assert.equal(state.detail, null);
    assert.equal(state.detailLoading, true);
    await act(async () => { state.select(second.id); await flush(); });
    const secondDetail = last();
    assert.equal(firstDetail.config.signal?.aborted, true);
    await act(async () => { answer(secondDetail, { ...record, ...second }); answer(firstDetail, record); await flush(); });
    assert.equal(current().detail?.id, second.id, 'A late detail for another turn never overwrites the current turn.');

    await act(async () => { state.applyFilters({ ...INITIAL_ADMIN_CHAT_FILTERS, outcome: '', q: 'first' }); await flush(); });
    const firstFilter = last();
    assert.equal(state.selectedId, null);
    assert.equal(state.detail, null);
    assert.equal(state.list, null);
    await act(async () => { state.applyFilters({ ...INITIAL_ADMIN_CHAT_FILTERS, outcome: '', q: 'second' }); await flush(); });
    const secondFilter = last();
    assert.equal(firstFilter.config.signal?.aborted, true);
    await act(async () => { answer(secondFilter, { ...listData, items: [second] }); answer(firstFilter, listData); await flush(); });
    assert.deepEqual(current().list?.items.map((item) => item.id), [second.id]);

    await act(async () => { state.changePage(20); await flush(); });
    assert.equal(last().config.params.offset, 20);
    assert.equal(last().config.params.q, 'second');
    assert.equal(state.list, null);
    await act(async () => { answer(last(), listData); await flush(); });
    await act(async () => { state.select(summary.id); await flush(); });
    const refreshDetail = last();
    await act(async () => { state.refresh(); await flush(); });
    assert.equal(refreshDetail.config.signal?.aborted, true);
    assert.equal(state.selectedId, null);
    assert.equal(state.detail, null);
    await act(async () => { answer(refreshDetail, record); last().reject(new ApiRequestError('檢核資料表尚未初始化', 503)); await flush(); });
    assert.match(state.listError ?? '', /資料表尚未初始化/);
    assert.equal(state.listLoading, false);
    assert.equal(state.detail, null);

    await act(async () => { state.refresh(); await flush(); });
    await act(async () => { last().reject(new ApiRequestError('沒有後台權限', 403)); await flush(); });
    assert.equal(accessErrors.length, 1, 'A revoked administrator is handed back to the existing access gate.');

    await act(async () => { state.refresh(); await flush(); });
    const unmountedList = last();
    await act(async () => { state.select(summary.id); await flush(); });
    const unmountedDetail = last();
    await act(async () => { renderer!.unmount(); renderer = undefined; });
    assert.equal(unmountedList.config.signal?.aborted, true);
    assert.equal(unmountedDetail.config.signal?.aborted, true);
    await act(async () => { answer(unmountedList, listData); answer(unmountedDetail, record); await flush(); });

    // A token boundary is checked again when each response arrives, before the parent gate re-renders.
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    let token = 'first-account';
    try {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => token } });
      await act(async () => { renderer = create(<Harness />); await flush(); });
      const oldAccountList = last();
      await act(async () => { state.select(summary.id); await flush(); });
      const oldAccountDetail = last();
      token = 'second-account';
      await act(async () => { answer(oldAccountList, listData); answer(oldAccountDetail, record); await flush(); });
      assert.equal(state.list, null);
      assert.equal(state.detail, null);
      await act(async () => { renderer!.unmount(); renderer = undefined; });
    } finally {
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
      else Reflect.deleteProperty(globalThis, 'window');
      if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  } finally {
    if (renderer) await act(async () => renderer!.unmount());
    apiClient.defaults.adapter = originalAdapter;
  }
  console.log('AI conversation review checks passed: bounded evidence rendering, escaped drafts, failure/empty states, pagination, stale-request cancellation, and access revocation.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
