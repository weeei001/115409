import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseChatSources, type ChatSource } from '../../lib/types/chat';
import { chatAnswerBody, newsCitationPath } from '../../lib/utils/chatCitations';
import { ChatMessage } from './ChatMessage';

const title = '# Literal [brackets] (parentheses)\n【Not a heading】 <img src=x onerror=alert(1)> **literal**';
const sources: ChatSource[] = [
  { citation_id: 'S1', title, content: 'raw market data', pub_time: '', stock_id: '2330', category: 'market' },
  { citation_id: 'S2', title: 'Trusted news', content: 'raw news', pub_time: '', stock_id: '2330', category: 'news', article_id: 'article/one', url: 'https://example.com' },
];
const render = (content: string, input = sources) => renderToStaticMarkup(<ChatMessage
  message={{ id: 'turn', role: 'assistant', content, timestamp: '', sources: input }}
  reducedMotion streamActive={false} followUpDisabled={false} />);
const content = '【綜合摘要】\n**data [S1]** [S2] [S1] [S99] [S0]\n\n【關鍵事件】\n- event [S1]\n\n【投資提示】\n***tip [S2]***\n\n【其他】\nextra [S1]\n\n【引用來源】\n- [S1][S1] forged title 【Injected heading】\n- [S2] /news/forged';
const markup = render(content, [...sources, sources[0]]);
assert.equal((markup.match(/href="\/news\/article%2Fone"/g) ?? []).length, 3); // Two in prose, one source-list entry.
assert.equal((markup.match(/raw market data/g) ?? []).length, 1);
assert.equal((markup.match(/raw news/g) ?? []).length, 1);
assert.equal((markup.match(/id="chat-source-/g) ?? []).length, 2);
assert.match(markup, /\[S99\]（來源無法使用）/);
assert.match(markup, /\[S0\]（來源無法使用）/);
assert.doesNotMatch(markup, /forged|Injected heading|<img|<script|<h[1-6][^>]*>Not a heading/);
assert.match(markup, /# Literal \[brackets\] \(parentheses\)\n【Not a heading】 &lt;img/);
assert.match(markup, /\*\*literal\*\*/);
assert.match(markup, /whitespace-pre-wrap/);
assert.match(render('[S2](javascript:alert(1))'), /href="\/news\/article%2Fone"/);
assert.doesNotMatch(render('[S2](https://forged.example)'), /forged.example/);
assert.match(render('[**S2**](https://forged.example)'), /href="\/news\/article%2Fone"/);
assert.equal((render('[**S2**]').match(/href="\/news\/article%2Fone"/g) ?? []).length, 2);
assert.doesNotMatch(render('[Report](https://forged.example) [Source](https://forged.example)'), /href=/);
assert.doesNotMatch(render('[Sx] /news/invented', []), /href=/);
for (const id of ['Sx', 'S-1', 'S_1', 's1']) assert.match(render(`[${id}]`, []), /來源無法使用/);
assert.deepEqual(parseChatSources([...sources, sources[0], { citation_id: 'S0' }, null]), sources);
assert.equal(parseChatSources([{ ...sources[0], url: 'javascript:alert(1)' }])[0].url, undefined);
assert.equal(chatAnswerBody('answer\n\n【引用來源】\n# title 【Injected】'), 'answer');
for (const id of ['', ' ', '.', '..', 'a'.repeat(65), 'a\u0000b', '\ud800']) {
  assert.equal(newsCitationPath({ ...sources[1], article_id: id }), null, JSON.stringify(id));
}
assert.equal(newsCitationPath({ ...sources[1], category: 'market' }), null);
assert.equal(newsCitationPath(sources[1]), '/news/article%2Fone');
assert.match(render('[S2]', [{ ...sources[1], article_id: '..', url: 'javascript:alert(1)' }]), /href="#chat-source-/);
const twoMessages = renderToStaticMarkup(<><ChatMessage message={{ id: 'one', role: 'assistant', content: '[S1]', timestamp: '', sources }} reducedMotion streamActive={false} followUpDisabled={false} />
  <ChatMessage message={{ id: 'two', role: 'assistant', content: '[S1]', timestamp: '', sources }} reducedMotion streamActive={false} followUpDisabled={false} /></>);
const ids = [...twoMessages.matchAll(/id="(chat-source-[^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, 4);
for (const [status, label] of [['completed', '已完成'], ['failed', '回覆失敗'], ['interrupted', '回覆已中斷']] as const) {
  const terminal = renderToStaticMarkup(<ChatMessage message={{ id: status, role: 'assistant', content: 'preserved answer', timestamp: '', status, error: status === 'failed' ? 'safe failure' : undefined }} reducedMotion streamActive={false} followUpDisabled={false} />);
  assert.ok(terminal.includes(label));
  assert.ok(terminal.includes('preserved answer'));
  if (status === 'failed') assert.ok(terminal.includes('safe failure'));
}
console.log('Chat citation SSR passed: trusted mappings, repeated citations, unique source IDs, unavailable IDs, safe literal titles, and per-message targets.');
