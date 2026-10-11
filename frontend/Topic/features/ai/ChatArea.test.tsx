import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChatMessage } from '../../lib/types/chat';
import { ChatArea } from './ChatArea';

const source = { citation_id: 'S1', title: 'Literal # [title]', content: 'raw evidence', pub_time: '', stock_id: '2330' };
const dashboard = { title: 'Displayed dashboard', blocks: [{ kind: 'table' as const, title: 'Stored table', description: '', source_ids: ['S1'], columns: ['Date'], rows: [['2026-09-30']] }] };
const message = (id: string, content: string, extra = {}): ChatMessage => ({ id, role: 'assistant', content, timestamp: '', ...extra });
const render = (messages: ChatMessage[]) => renderToStaticMarkup(<ChatArea messages={messages} loading={false} streamingMessageId={null} exampleQuestions={[]} onSend={() => undefined} />);
for (const messages of [[], [message('empty', '')], [message('short', 'Short answer')], [message('invalid', 'Short [S99]', { sources: [{ citation_id: 'S99' }] })]]) {
  assert.doesNotMatch(render(messages), /aria-label="回答區塊導覽"/);
}
const long = render([message('long', 'Long answer '.repeat(80))]);
assert.doesNotMatch(render([message('uncited', 'Short answer', { sources: [source] })]), /aria-label="回答區塊導覽"|raw evidence/);
assert.match(long, /aria-label="回答區塊導覽"/);
assert.equal((long.match(/aria-controls=/g) ?? []).length, 1);
// 區塊導覽是錨點：目前所在區塊（預設回答）以 aria-current 標示，只有一個
assert.match(long, /aria-current="location"[^>]*>回答<\/button>/);
assert.equal((long.match(/aria-current=/g) ?? []).length, 1);
const multiTurn = render([message('old', 'Older answer [S1]', { sources: [source], dashboard }), message('latest', 'Latest answer [S1]', { sources: [source] })]);
const controls = [...multiTurn.matchAll(/aria-controls="([^"]+)"/g)].map((match) => match[1]);
assert.equal(controls.length, 3);
for (const id of controls) assert.equal((multiTurn.match(new RegExp(`id="${id}"`, 'g')) ?? []).length, 1);
assert.ok(multiTurn.indexOf(`id="${controls[0]}"`) > multiTurn.indexOf('Older answer'));
assert.ok(multiTurn.indexOf(`id="${controls[0]}"`) < multiTurn.indexOf('Latest answer'));
assert.match(multiTurn, /Displayed dashboard/);
assert.match(multiTurn, /focus:outline-2/);
const withoutLatestSources = render([message('old', 'Older [S1]', { sources: [source] }), message('latest', 'Latest '.repeat(100))]);
assert.equal((withoutLatestSources.match(/aria-controls=/g) ?? []).length, 1);
const dataOnly = render([message('empty', '', { dashboard })]);
assert.equal((dataOnly.match(/aria-controls=/g) ?? []).length, 1);
assert.match(dataOnly, />資料<\/button>/);
// 資料面板的來源編號和所屬回覆的引用同一組號碼：正文先引用 S5 → 回覆與面板都顯示 [1]
const sources5 = ['S1', 'S5'].map((id) => ({ ...source, citation_id: id, title: `來源 ${id}` }));
const labelled = render([message('dash', '先看 [S5] 再看 [S1]', { sources: sources5, dashboard: { title: 'D', blocks: [{ ...dashboard.blocks[0], source_ids: ['S5', 'S1'] }] } })]);
const panel = labelled.slice(labelled.indexOf('aria-label="分析資料面板"'));
assert.match(panel, /資料來源：<\/span><span[^>]*>\[1\]<\/span><span[^>]*>\[2\]<\/span>/);
assert.doesNotMatch(panel, /\[S[15]\]/);
const waiting = renderToStaticMarkup(<ChatArea messages={[{ id: 'q', role: 'user', content: '問題', timestamp: '' }]} loading streamingMessageId={null} exampleQuestions={[]} onSend={() => undefined} />);
assert.match(waiting, /正在查詢資料…/);
assert.doesNotMatch(waiting, /系統資料/);
// 工作台：標題列放對話名稱（當文字，不當 HTML），順序是說明列 → 標題列 → 訊息 → 資料 → 輸入列（手機就是這個順序）
const slotted = renderToStaticMarkup(<ChatArea messages={[message('old', 'Older answer [S1]', { sources: [source], dashboard }), message('latest', 'Latest answer')]}
  loading={false} streamingMessageId={null} exampleQuestions={[]} onSend={() => undefined} title="<b>名稱</b>" status={<p>STATUS-SLOT</p>} composer={<p>COMPOSER-SLOT</p>} />);
assert.match(slotted, /<h2[^>]*><span[^>]*title="&lt;b&gt;名稱&lt;\/b&gt;"[^>]*>&lt;b&gt;名稱&lt;\/b&gt;<\/span><\/h2>/);
const order = ['STATUS-SLOT', 'data-chat-toolbar', 'Latest answer', 'aria-label="分析資料面板"', 'COMPOSER-SLOT'].map((text) => slotted.indexOf(text));
assert.ok(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1])), `slot order ${order}`);
// 分隔線、放大與收起鈕只在掛載後的桌機出現；伺服器輸出（手機版）沒有
assert.doesNotMatch(slotted, /role="separator"|放大資料欄|收起資料欄/);
// 沒有區塊導覽時標題列在手機隱藏（lg 以上仍顯示對話名稱）
assert.match(renderToStaticMarkup(<ChatArea messages={[message('short', 'Short')]} loading={false} streamingMessageId={null} exampleQuestions={[]} onSend={() => undefined} title="T" />),
  /data-chat-toolbar="true"[^>]*class="[^"]*max-lg:hidden/);
console.log('Chat area workspace slots passed: escaped title, status/toolbar/messages/data/composer order, desktop-only splitter controls.');
console.log('Chat area navigation fixtures passed: latest answer/source targets, actual displayed dashboard, short/empty/missing targets, and visible focus.');
