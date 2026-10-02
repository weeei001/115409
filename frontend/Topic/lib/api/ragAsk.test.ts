import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatMessage } from '../../features/ai/ChatMessage';
import { RagStructuredReply } from '../../features/ai/RagStructuredReply';
import { parseSourceItems } from '../utils/parseRagStructuredReply';
import type { RagHistoryMessage } from './ragAsk';
import { parseChatSources, type ChatAction } from '../types/chat';
import { parseChatDashboard, type ChatDashboard } from '../types/chatDashboard';

async function check() {
  const { API_BASE } = await import('../apiBase');
  const { appendCompletedChatTurn, ragAskStream } = await import('./ragAsk');
  assert.equal(API_BASE, process.env.EXPECTED_API_BASE);
  const received: string[] = [];
  let done = 0;
  let expectedDetail = 'plain';
  let expectedQuery = 'test question';
  let expectedHistory: RagHistoryMessage[] = [];
  const safeActions: ChatAction[] = ['/', '/compare', '/order', '/stock/2330', '/stock/0050'].map((path) => ({
    type: 'navigate', label: 'Open page', path,
  }));
  safeActions.push({ type: 'follow_up', label: 'Explain more simply', query: 'Explain 2330 more simply' });
  const unsafeActions = [
    { type: 'follow_up', label: 'Missing query' },
    { type: 'follow_up', label: 'Blank query', query: '   ' },
    { type: 'follow_up', label: 'Too long', query: 'x'.repeat(6001) },
    ...['https://example.com', '//example.com', 'javascript:alert(1)', '/\\example.com',
      '/stock/%32%33%33%30', '/stock/2330/../order', '/stock/2330?next=//example.com',
      '/stock/2330#detail', '/stock/abc', '/stock/1234567', '/api/simulated-orders'].map((path) => ({
      type: 'navigate', label: 'Unsafe page', path,
    })),
    { type: 'trade', label: 'Trade', path: '/order' },
    { type: 'navigate', label: '', path: '/compare' },
    { type: 'navigate', label: 'Missing path' }, null, 'invalid',
  ];
  let responseBody = 'data: {"type":"status","content":"retrieving"}\n\n' +
    'data: {"type":"text","content":"answer"}\n\n' +
    `data: ${JSON.stringify({ type: 'done', answer: 'not a second answer', actions: [...safeActions, ...unsafeActions] })}\n\n`;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, `${process.env.EXPECTED_API_BASE}/api/ask`);
    assert.equal(options?.method, 'POST');
    assert.deepEqual(JSON.parse(String(options?.body)), {
      query: expectedQuery, stock_id: null, answer_detail: expectedDetail,
      history: expectedHistory, stream: true, user_token: null,
    });
    return new Response(responseBody, {
      headers: { 'content-type': 'text/event-stream' },
    });
  };
  const result = await ragAskStream({ query: 'test question' }, {
    onText: (text) => received.push(text), onDone: ({ actions }) => {
      assert.deepEqual(actions, safeActions);
      done++;
    },
  });
  assert.deepEqual(received, ['answer']);
  assert.equal(done, 1);
  assert.equal(result.hadStreamText, true);
  assert.equal(result.completed, true);
  for (const answerDetail of ['plain', 'standard', 'technical'] as const) {
    expectedDetail = answerDetail;
    await ragAskStream({ query: 'test question', answer_detail: answerDetail }, {
      onText: (text) => received.push(text), onDone: () => done++,
    });
  }
  assert.deepEqual(received, ['answer', 'answer', 'answer', 'answer']);
  assert.equal(done, 4);

  const previous = appendCompletedChatTurn([], 'Analyze 2330',
    '2330 summary[S1][S2]\n\n【引用來源】\n- [S1] News https://example.com/old');
  assert.deepEqual(previous, [
    { role: 'user', content: 'Analyze 2330' }, { role: 'assistant', content: '2330 summary' },
  ]);
  assert.equal(appendCompletedChatTurn(previous, 'Follow up', '   '), previous);
  assert.equal(appendCompletedChatTurn(previous, 'Follow up', '【引用來源】\n[S1] News'), previous);
  let history = previous;
  for (let index = 0; index < 4; index++) {
    history = appendCompletedChatTurn(history, `Question ${index}`, `Answer ${index}`);
  }
  assert.equal(history.length, 8);
  assert.equal(history[0].content, 'Question 0');
  assert.equal(previous.length, 2);

  expectedQuery = 'How does it compare with 2454?';
  expectedDetail = 'plain';
  const unboundedHistory = [...previous, ...history.slice(0, -2),
    { role: 'user' as const, content: 'Explain in detail' },
    { role: 'assistant' as const, content: 'x'.repeat(6001) + '[S1]\n【新聞來源】https://example.com/old' },
  ];
  const historyBeforeSend = structuredClone(unboundedHistory);
  expectedHistory = [...history.slice(0, -2),
    { role: 'user', content: 'Explain in detail' }, { role: 'assistant', content: 'x'.repeat(6000) },
  ];
  await ragAskStream({ query: expectedQuery, history: unboundedHistory }, { onText: () => {} });
  assert.deepEqual(unboundedHistory, historyBeforeSend);

  expectedHistory = [];
  for (const payload of [
    `data: ${JSON.stringify({ type: 'done', answer: 'Complete answer', actions: safeActions })}\n\n`,
    JSON.stringify({ answer: 'Complete answer', actions: safeActions }),
  ]) {
    responseBody = payload;
    const text: string[] = [];
    let completions = 0;
    const reply = await ragAskStream({ query: expectedQuery }, {
      onText: (chunk) => text.push(chunk),
      onDone: ({ actions }) => { assert.deepEqual(actions, safeActions); completions++; },
    });
    assert.deepEqual(text, ['Complete answer']);
    assert.equal(completions, 1);
    assert.equal(reply.completed, true);
  }
  responseBody = 'data: {"type":"text","content":"Partial answer"}\n\n';
  const interrupted = await ragAskStream({ query: expectedQuery }, { onText: () => {} });
  assert.equal(interrupted.completed, false);
  responseBody = 'data: {"type":"error","message":"Retrieval failed"}\n\n';
  await assert.rejects(ragAskStream({ query: expectedQuery }, { onText: () => {} }), /Retrieval failed/);

  const mixedSources = '- [S1] Market snapshot\n- [S2] News: https://example.com/news\n' +
    '- [S3] Untrusted source: javascript:alert(1)\n- [S4] Internal news: /news/article-1';
  assert.deepEqual(parseSourceItems(mixedSources), [
    { index: 'S1', title: 'Market snapshot', url: '' },
    { index: 'S2', title: 'News', url: 'https://example.com/news' },
    { index: 'S3', title: 'Untrusted source: javascript:alert(1)', url: '' },
    { index: 'S4', title: 'Internal news', url: '/news/article-1' },
  ]);
  const markup = renderToStaticMarkup(createElement(RagStructuredReply, {
    content: `Readable **answer**[S1][S2]\n\n【關鍵事件】\n*   **營收創新高**：受惠於 AI 需求 [S1]\n\n【引用來源】\n${mixedSources}`,
  }));
  assert.match(markup, /Readable <strong>answer<\/strong>\[S1\]\[S2\]/);
  assert.match(markup, /<strong>營收創新高<\/strong>：受惠於 AI 需求/);
  assert.doesNotMatch(markup, /\*\*營收創新高\*\*/);
  assert.equal((markup.match(/<li(?:\s|>)/g) ?? []).length, 1);
  for (const id of ['S1', 'S2']) assert.ok(markup.includes(`[${id}]`));
  assert.doesNotMatch(markup, /Market snapshot/);
  assert.equal((markup.match(/<a /g) ?? []).length, 0);
  assert.doesNotMatch(markup, /href="javascript:/);

  const defaultSectionMarkup = renderToStaticMarkup(createElement(RagStructuredReply, {
    content: '【重點】\n具體影響如下：\n\n*   **營收創新高**：受惠於 AI 需求 [S1]',
  }));
  assert.match(defaultSectionMarkup, /<ul[^>]*><li[^>]*>[\s\S]*?<strong>營收創新高<\/strong>/);
  assert.doesNotMatch(defaultSectionMarkup, /\*\s+\*\*營收創新高\*\*/);

  const escapedMarkup = renderToStaticMarkup(createElement(RagStructuredReply, {
    content: String.raw`【關鍵事件】
\* \*\*營收創新高\*\*：受惠於 AI 需求`,
  }));
  assert.match(escapedMarkup, /<ul[^>]*><li[^>]*>[\s\S]*?<strong>營收創新高<\/strong>：受惠於 AI 需求/);
  assert.doesNotMatch(escapedMarkup, /\\\*|\*\*營收創新高\*\*/);

  const dashboardSourceMarkup = renderToStaticMarkup(createElement(RagStructuredReply, {
    content: `Readable answer\n\n【引用來源】\n${mixedSources}`,
  }));
  assert.match(dashboardSourceMarkup, /Readable answer/);
  assert.doesNotMatch(dashboardSourceMarkup, /Market snapshot|href=/);

  for (const body of ['並非利空', '沒有證據支持看漲', '不知道偏空或偏多']) {
    const sentimentMarkup = renderToStaticMarkup(createElement(RagStructuredReply, { content: `【市場情緒】\n${body}` }));
    assert.ok(sentimentMarkup.includes(body));
    assert.doesNotMatch(sentimentMarkup, /rounded-full|border-up|border-down/);
  }
  const sourceRecords = [1, 2].map((id) => ({ citation_id: `S${id}`, title: 'Same article', content: `Passage ${id}`,
    pub_time: '2026-09-11', stock_id: '2330', ...(id === 2 ? { category: 'news', article_id: 'trusted/two' } : { category: 'market' }) }));
  assert.deepEqual(parseChatSources([...sourceRecords, null, { citation_id: 'S99' }]), sourceRecords);
  const messageMarkup = (id: string, content: string) => renderToStaticMarkup(createElement(ChatMessage, {
    message: { id, role: 'assistant', content, timestamp: '', sources: sourceRecords,
      dashboard: { title: 'News', blocks: [] } }, reducedMotion: true, streamActive: false, followUpDisabled: false,
  }));
  const earlierTurn = messageMarkup('first', 'First answer[S2]\n【引用來源】\n- [S2] Same article: /news/one');
  const laterTurn = messageMarkup('second', 'Second answer[S1]');
  assert.match(earlierTurn, /Passage 2/);
  assert.match(earlierTurn, /href="\/news\/trusted%2Ftwo"/);
  assert.doesNotMatch(earlierTurn, /href="\/news\/one"/);
  assert.match(laterTurn, /Passage 1/);
  assert.match(earlierTurn, /\[S2\]/);

  responseBody = `data: ${JSON.stringify({ type: 'done', answer: 'Answer[S2]', sources: sourceRecords })}\n\n`;
  await ragAskStream({ query: expectedQuery }, {
    onText: () => {}, onDone: (reply) => assert.deepEqual(reply.sources, sourceRecords),
  });

  const dashboard: ChatDashboard = {
    title: 'Test stock data',
    blocks: [{ kind: 'metrics', title: '2330', description: 'Dated observations', source_ids: ['S1'],
      items: [{ label: 'Close', value: 0, unit: 'TWD', date: '2026-09-11' },
        { label: 'KD', value: null, unit: '', date: null }] }],
  };
  assert.deepEqual(parseChatDashboard(dashboard), dashboard);
  assert.equal(parseChatDashboard({ title: 'Untrusted', blocks: [
    { kind: 'html', html: '<script>alert(1)</script>' },
    { ...dashboard.blocks[0], items: [{ label: 'Close', value: Infinity, unit: '', date: null }] },
    { kind: 'chart', title: 'Bad dimensions', description: '', source_ids: ['S1'],
      dates: ['2026-09-11'], unit: '', series: [{ name: '2330', values: [1, 2] }] },
  ] }), undefined);
  const unsafeNews = parseChatDashboard({ title: 'News', blocks: [{ kind: 'news', title: 'News',
    description: '', source_ids: ['S1'], items: [{ title: '<script>literal text</script>',
      publisher: 'Test', published_at: '', source_id: 'S1', url: 'javascript:alert(1)' }] }] });
  assert.equal(unsafeNews?.blocks[0].kind === 'news' && unsafeNews.blocks[0].items[0].url, '');

  const prepared = `data: ${JSON.stringify({ type: 'dashboard', dashboard, actions: safeActions })}\n\n`;
  responseBody = prepared + 'data: {"type":"text","content":"Explanation"}\n\n' +
    `data: ${JSON.stringify({ type: 'done', answer: 'Explanation', dashboard, actions: safeActions })}\n\n`;
  const order: string[] = [];
  await ragAskStream({ query: expectedQuery }, {
    onDashboard: (result) => { assert.deepEqual(result.dashboard, dashboard); order.push('dashboard'); },
    onText: () => { assert.equal(order[0], 'dashboard'); order.push('text'); },
    onDone: (result) => { assert.deepEqual(result.dashboard, dashboard); order.push('done'); },
  });
  assert.deepEqual(order, ['dashboard', 'text', 'done']);
  responseBody = prepared + 'data: {"type":"error","message":"Model failed"}\n\n';
  let available: ChatDashboard | undefined;
  await assert.rejects(ragAskStream({ query: expectedQuery }, {
    onDashboard: (result) => { available = result.dashboard; }, onText: () => {},
  }), /Model failed/);
  assert.deepEqual(available, dashboard);
  responseBody = prepared;
  let preparedCount = 0;
  const partial = await ragAskStream({ query: expectedQuery }, {
    onDashboard: () => preparedCount++, onText: () => {}, onDone: () => assert.fail('No completion event'),
  });
  assert.equal(preparedCount, 1);
  assert.equal(partial.completed, false);
  responseBody = JSON.stringify({ answer: 'Explanation', dashboard, actions: safeActions });
  await ragAskStream({ query: expectedQuery }, {
    onText: () => {}, onDone: (result) => assert.deepEqual(result.dashboard, dashboard),
  });

  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'fixture-token' } });
  globalThis.fetch = async (url, options) => {
    assert.equal(url, `${process.env.EXPECTED_API_BASE}/api/conversations/conversation-one/ask`);
    assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer fixture-token');
    assert.deepEqual(JSON.parse(String(options?.body)).history, []);
    return new Response('data: {"type":"text","content":"Continued"}\n\ndata: {"type":"done","actions":[]}\n\n', { headers: { 'content-type': 'text/event-stream' } });
  };
  const continued: string[] = [];
  const savedResult = await ragAskStream({ query: 'Continue' }, { onText: (text) => continued.push(text) }, { conversationId: 'conversation-one' });
  assert.equal(savedResult.completed, true);
  assert.deepEqual(continued, ['Continued']);

}

if (process.argv.includes('--child')) {
  check().catch((error) => { console.error(error); process.exitCode = 1; });
} else {
  for (const [nodeEnv, apiBase, expected] of [
    ['development', '', 'http://127.0.0.1:8002'],
    ['production', '', 'http://127.0.0.1:8003'],
    ['development', 'http://127.0.0.1:8012/', 'http://127.0.0.1:8012'],
    ['production', 'https://production.example/backend/', 'https://production.example/backend'],
  ] as const) {
    const child = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), '--child'], {
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: nodeEnv, NEXT_PUBLIC_API_URL: apiBase, EXPECTED_API_BASE: expected },
    });
    assert.equal(child.status, 0, child.stderr || child.stdout);
  }
  console.log('Chat checks passed: routing, answer detail, bounded history, safe actions, and stream completion.');
}
