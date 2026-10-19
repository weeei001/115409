import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { Dialog } from 'radix-ui';
import type { ChatMessage } from '../../lib/types/chat';
import { assistantContext, selectionQuestion } from './context';
import { AssistantPanel, fullChatHref } from './AssistantPanel';
import { homeTerminalReached } from './AssistantDock';

// 首頁：觀測台到了小燈才出現（視窗高 914）
assert.equal(homeTerminalReached(1681, 914), false, 'first screen: terminal far below');
assert.equal(homeTerminalReached(300, 914), true, 'terminal in the upper half');
assert.equal(homeTerminalReached(-400, 914), true, 'scrolled past the terminal top');
assert.equal(homeTerminalReached(undefined, 914), false, 'no terminal yet');

// 個股頁：問題寫出代號與名稱，提供「回答只看這檔」
const stock = assistantContext('/stock/[id]', '2330', '台積電');
assert.deepEqual(stock.stock, { code: '2330', label: '2330 台積電' });
assert.equal(stock.viewing, '2330 台積電');
assert.ok(stock.questions.length >= 2 && stock.questions.every((question) => question.includes('2330 台積電')));
assert.deepEqual(assistantContext('/stock/[id]/report', '2454', null).stock, { code: '2454', label: '2454' });
// 網址上的代號不合法就當一般頁面，不送 stock_id
for (const id of ['abc', '23', ['2330'], undefined]) assert.equal(assistantContext('/stock/[id]', id).stock, null);
// 其他頁依頁面給問題，沒有對應的頁面用通用問題；新聞詳情頁的 id 不會被當成股票
assert.equal(assistantContext('/news/[id]', '2330').stock, null);
assert.equal(assistantContext('/news/[id]', 'x').viewing, null, 'no title yet: no "you are reading"');
// 新聞頁提供標題後，問題直接引用這則新聞；標題太長會截斷
const news = assistantContext('/news/[id]', 'x', null, { kind: 'news', title: '  台積電  公布九月營收 ' });
assert.equal(news.viewing, '「台積電 公布九月營收」這則新聞');
assert.ok(news.questions.some((question) => question.includes('「台積電 公布九月營收」')));
const longTitle = assistantContext('/news/[id]', 'x', null, { kind: 'news', title: '長'.repeat(120) });
assert.ok(longTitle.questions[0].includes(`${'長'.repeat(80)}…`) && !longTitle.questions[0].includes('長'.repeat(81)));
// 主題只在新聞頁用：別頁殘留的主題不會出現
assert.equal(assistantContext('/compare', undefined, null, { kind: 'news', title: '舊新聞' }).viewing, null);

// 選取文字：壓掉多餘空白、太長截斷、太短不問
assert.equal(selectionQuestion('  本益比\n'), '用白話解釋「本益比」');
assert.equal(selectionQuestion('K'), null);
assert.equal(selectionQuestion('   '), null);
assert.ok(selectionQuestion('字'.repeat(300))!.endsWith(`${'字'.repeat(200)}…」`));
assert.ok(assistantContext('/order', undefined).questions.some((question) => question.includes('模擬')));
assert.ok(assistantContext('/compare', undefined).questions.some((question) => question.includes('比較')));
assert.deepEqual(assistantContext('/me', undefined).questions, assistantContext('/notifications', undefined).questions);
assert.ok(assistantContext('/me', undefined).questions.includes('這個網站可以幫我做什麼？'));

// 完整對話頁：只有登入且已有對話時帶對話 ID
assert.equal(fullChatHref(true, 'c0ffee00-0000-4000-8000-000000000000'), '/ai?c=c0ffee00-0000-4000-8000-000000000000');
assert.equal(fullChatHref(false, 'local-only'), '/ai');
assert.equal(fullChatHref(true, null), '/ai');

const noop = () => {};
const chat = (messages: ChatMessage[], extra: Partial<Parameters<typeof AssistantPanel>[0]['chat']> = {}) => ({
  messages, loading: false, notice: null, stopNotice: false, streamingMessageId: null, signedIn: false, conversationId: null,
  rate: async () => {}, stop: noop, newConversation: noop, ...extra,
});
const render = (props: Partial<Parameters<typeof AssistantPanel>[0]> = {}) => renderToStaticMarkup(
  <Dialog.Root open>
    <AssistantPanel chat={chat([])} context={stock} mood="idle" stockOnly onStockOnlyChange={noop} onSend={noop} reducedMotion still={false} onStillChange={noop} selectionTip {...props} />
  </Dialog.Root>,
);

// 空白狀態：自我介紹、目前這檔、可以這樣問、保存與否、AI 免責與輸入框
const empty = render();
assert.match(empty, /小燈/);
assert.match(empty, /你正在看 2330 台積電/);
assert.match(empty, /aria-label="可以這樣問"/);
assert.match(empty, /整理 2330 台積電 的走勢、法人與營收重點/);
assert.match(empty, /訪客：對話不會保存/);
assert.match(empty, /AI 回覆僅供研究參考，不是投資建議。/);
assert.match(empty, /id="assistant-input-message"/);
assert.doesNotMatch(empty, /id="chat-input-message"/, 'the panel input never collides with the AI page input');
assert.match(empty, /回答只看 2330 台積電/);
assert.match(empty, /role="checkbox"[^>]*aria-checked="true"/);
assert.match(empty, /aria-label="在 AI 對話頁開啟"[^>]*href="\/ai"|href="\/ai"[^>]*aria-label="在 AI 對話頁開啟"/);
assert.doesNotMatch(empty, /aria-label="開新對話"/, 'nothing to clear before the first question');
// 會自己動的內容要能暫停（WCAG 2.2.2）；選取文字的小技巧只在滑鼠裝置提
assert.match(empty, /aria-label="暫停小燈動作" aria-pressed="false"|aria-pressed="false"[^>]*aria-label="暫停小燈動作"/);
assert.match(render({ still: true }), /aria-pressed="true"/);
assert.match(empty, /選取看不懂的字或句子/);
assert.doesNotMatch(render({ selectionTip: false }), /選取看不懂的字或句子/);

// 「這頁怎麼看」：頁面有導覽時，面板開頭與標題列各有一個入口，標出幾步；沒有導覽就不出現
const withTour = render({ tourSteps: 5, onStartTour: noop });
assert.match(withTour, /帶我看這頁怎麼看/);
assert.match(withTour, /5 步/);
assert.match(withTour, /aria-label="這頁怎麼看（導覽）"/);
assert.doesNotMatch(empty, /帶我看這頁怎麼看|這頁怎麼看（導覽）/);
// 一般頁面沒有「回答只看這檔」，也不寫「你正在看」
assert.doesNotMatch(render({ context: assistantContext('/compare', undefined) }), /回答只看|role="checkbox"|你正在看/);
assert.match(render({ context: news }), /你正在看「台積電 公布九月營收」這則新聞/);

// 有對話：顯示訊息、開新對話；資料面板收在回覆下方的展開列
const dashboard = { title: '2330 價量', blocks: [{ kind: 'table' as const, title: '近 5 日', description: '', source_ids: [], columns: ['日期'], rows: [['2026-10-08']] }] };
const withAnswer = render({
  chat: chat([
    { id: 'q', role: 'user', content: '台積電最近怎麼樣？', timestamp: '' },
    { id: 'a', role: 'assistant', content: '這是回覆。', timestamp: '', status: 'completed', dashboard },
  ], { signedIn: true, conversationId: 'c0ffee00-0000-4000-8000-000000000000' }),
});
assert.match(withAnswer, /台積電最近怎麼樣？/);
assert.match(withAnswer, /這是回覆。/);
assert.match(withAnswer, /aria-label="開新對話"/);
assert.match(withAnswer, /<details[^>]*>[\s\S]*資料面板：2330 價量/);
assert.match(withAnswer, /href="\/ai\?c=c0ffee00-0000-4000-8000-000000000000"/);
assert.doesNotMatch(withAnswer, /aria-label="可以這樣問"/);

// 回覆中：可以停止、推薦問題與追問先停用；錯誤只說一次
const busy = render({ chat: chat([{ id: 'q', role: 'user', content: '問題', timestamp: '' }], { loading: true }) });
assert.match(busy, /停止回覆<\/button>/);
const failed = render({ chat: chat([], { notice: '無法建立對話，請重試。' }) });
assert.equal((failed.match(/無法建立對話，請重試。/g) ?? []).length, 1);
assert.match(failed, /role="alert"/);

console.log('Assistant passed: page-aware and news-aware questions, tour entry points, selection questions, pause control, stock_id scope, full-chat link, empty/answer/busy/error panel states, unique input ids and AI disclaimer.');
