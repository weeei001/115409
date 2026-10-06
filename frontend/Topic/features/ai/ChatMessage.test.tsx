import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseChatSources, type ChatSource } from '../../lib/types/chat';
import { BACKEND_CHAT_DISCLAIMERS, chatAnswerBody, chatCopyText, citationLabels, newsCitationPath, relabelCitations } from '../../lib/utils/chatCitations';
import { AI_CHAT_DISCLAIMER } from '../../lib/disclaimers';
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

// P0-7：後端附加的免責句（自稱「投資建議」）不顯示；每則 AI 回覆底部固定顯示前端的免責
const backendDisclaimer = BACKEND_CHAT_DISCLAIMERS[0];
// 有【引用來源】：後端把它接在引用尾段後面
assert.equal(chatAnswerBody(`answer [S1]\n\n【引用來源】\n- [S1] title\n\n${backendDisclaimer}`), 'answer [S1]');
// 沒有【引用來源】（資料不足的回覆）：直接接在正文後面，要用完整字串剝掉
assert.equal(chatAnswerBody(`目前提供的資料不足以回答此問題。\n\n${backendDisclaimer}`), '目前提供的資料不足以回答此問題。');
assert.equal(chatAnswerBody(backendDisclaimer), '');
// 只剝完整的一段，正文裡提到相近字眼不動
assert.equal(chatAnswerBody('投資建議僅供參考這句話不會被剝掉'), '投資建議僅供參考這句話不會被剝掉');
const withDisclaimer = render(`回覆內容 [S1]\n\n${backendDisclaimer}`);
assert.doesNotMatch(withDisclaimer, /投資建議僅供參考|不保證獲利/);
assert.ok(withDisclaimer.includes(AI_CHAT_DISCLAIMER));
assert.ok(withDisclaimer.lastIndexOf(AI_CHAT_DISCLAIMER) > withDisclaimer.indexOf('回覆內容'));
for (const text of ['沒有引用的回覆', '【綜合摘要】\n結構化回覆']) assert.ok(render(text, []).includes(AI_CHAT_DISCLAIMER), text);
// 後端改字後的版本：放在【資料限制】之後、【引用來源】之前，也要剝掉；舊版仍照樣剝
const revisedDisclaimer = BACKEND_CHAT_DISCLAIMERS[1];
assert.equal(
  chatAnswerBody(`answer [S1]\n\n【資料限制】\n部分資料缺漏。\n\n${revisedDisclaimer}\n\n【引用來源】\n- [S1] title`),
  'answer [S1]\n\n【資料限制】\n部分資料缺漏。',
);
assert.equal(chatAnswerBody(`目前提供的資料不足以回答此問題。\n\n${revisedDisclaimer}`), '目前提供的資料不足以回答此問題。');
assert.doesNotMatch(render(`回覆內容 [S1]\n\n${revisedDisclaimer}\n\n【引用來源】\n- [S1] title`), /以上為資料整理/);
// 模擬帳戶那一輪的版本，同樣剝掉
const paperDisclaimer = BACKEND_CHAT_DISCLAIMERS[2];
assert.match(paperDisclaimer, /模擬帳戶/);
assert.equal(chatAnswerBody(`可考慮投入可用資金的 20%。[S1]\n\n${paperDisclaimer}\n\n【引用來源】\n- [S1] title`), '可考慮投入可用資金的 20%。[S1]');
// 提問、空白回覆不加
assert.ok(!renderToStaticMarkup(<ChatMessage message={{ id: 'q', role: 'user', content: '台積電現在適合買進嗎？', timestamp: '' }} reducedMotion streamActive={false} followUpDisabled={false} />).includes(AI_CHAT_DISCLAIMER));
assert.ok(!renderToStaticMarkup(<ChatMessage message={{ id: 'blank', role: 'assistant', content: '', timestamp: '', status: 'streaming' }} reducedMotion streamActive followUpDisabled={false} />).includes(AI_CHAT_DISCLAIMER));

// P2-033：引用依正文出現順序重新編號，後端的 S1、S2、S5 不再跳號
const gapped: ChatSource[] = [1, 2, 3, 4, 5].map((n) => ({ citation_id: `S${n}`, title: `來源 ${n}`, content: `內容 ${n}`, pub_time: '', stock_id: '2330', category: 'market' }));
const gappedBody = '先看 [S5]，再看 [S1] 與 [S2]，又提到 [S5]。';
const labels = citationLabels(gappedBody, gapped);
assert.deepEqual([...labels.entries()], [['S5', '1'], ['S1', '2'], ['S2', '3'], ['S3', '4'], ['S4', '5']]);
assert.equal(relabelCitations(gappedBody, labels), '先看 [1]，再看 [2] 與 [3]，又提到 [1]。');
// 資料面板多出來的 id 接在後面，不影響正文的編號；不在來源清單的引用不編號
assert.deepEqual([...citationLabels('[S9] [S2]', gapped.slice(0, 2), ['S9']).entries()], [['S2', '1'], ['S1', '2'], ['S9', '3']]);
const gappedMarkup = render(gappedBody, gapped);
const inline = [...gappedMarkup.matchAll(/align-super[^>]*>\[(\d+)\]<\/a>/g)].map((match) => match[1]);
assert.deepEqual(inline, ['1', '2', '3', '1']);
// 引用來源清單依新編號排序；原始資料清單也用同一組號碼
const listed = [...gappedMarkup.matchAll(/aria-label="引用 (\d+)：(來源 \d)，查看原始資料" class="[^"]*flex min-h-11/g)].map((match) => `${match[1]}:${match[2]}`);
assert.deepEqual(listed, ['1:來源 5', '2:來源 1', '3:來源 2']);
assert.doesNotMatch(gappedMarkup, /\[S[1-5]\]/);
// 錨點仍用原始 id
assert.match(gappedMarkup, /id="chat-source-[^"]*-S5"/);

// 複製：畫面上的正文＋引用來源＋固定免責，不含後端尾段與後端免責句
const copied = chatCopyText(`${gappedBody}\n\n【引用來源】\n- [S5] 偽造標題\n\n${backendDisclaimer}`, gapped, AI_CHAT_DISCLAIMER);
assert.equal(copied, `先看 [1]，再看 [2] 與 [3]，又提到 [1]。\n\n引用來源\n[1] 來源 5\n[2] 來源 1\n[3] 來源 2\n\n${AI_CHAT_DISCLAIMER}`);
assert.equal(chatCopyText('沒有引用', [], AI_CHAT_DISCLAIMER), `沒有引用\n\n${AI_CHAT_DISCLAIMER}`);
console.log('Chat citation SSR passed: trusted mappings, repeated citations, unique source IDs, unavailable IDs, safe literal titles, per-message targets, fixed disclaimer, backend disclaimer stripped, sequential citation labels, and copy text.');
