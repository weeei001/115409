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
console.log('Chat area navigation fixtures passed: latest answer/source targets, actual displayed dashboard, short/empty/missing targets, and visible focus.');
