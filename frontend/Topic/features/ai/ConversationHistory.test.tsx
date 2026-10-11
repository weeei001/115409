import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConversationHistory } from './ConversationHistory';
const noop = () => {};
const props = { signedIn: true, ready: true, items: [{ id: 'one', title: '<script>literal</script>', updated_at: '2026-10-02T00:00:00Z' }], selectedId: 'one', search: '', loading: false, error: null, hasMore: true,
  onSearch: noop, onOpen: noop, onNew: noop, onRetry: noop, onMore: noop };
const html = renderToStaticMarkup(<ConversationHistory {...props} />);
assert.match(html, /aria-current="true"/);
assert.match(html, /&lt;script&gt;literal&lt;\/script&gt;/);
assert.match(html, /for="conversation-search"/);
assert.match(html, /type="search"/);
assert.match(html, /載入更多/);
assert.match(renderToStaticMarkup(<ConversationHistory {...props} items={[]} search="missing" />), /找不到符合的對話/);
assert.match(renderToStaticMarkup(<ConversationHistory {...props} error="Connection failed" />), /role="alert"/);
const guest = renderToStaticMarkup(<ConversationHistory {...props} signedIn={false} />);
assert.match(guest, /登入/);
assert.doesNotMatch(guest, /<input|literal/);
// 收合成細條：只留展開與新增對話，沒有搜尋框與清單；展開時標題列有收合鈕；抽屜不收合
const rail = renderToStaticMarkup(<ConversationHistory {...props} collapsed onToggleCollapsed={noop} />);
assert.match(rail, /aria-label="展開歷史對話"/);
assert.match(rail, /aria-expanded="false"/);
assert.match(rail, /aria-label="新增對話"/);
assert.doesNotMatch(rail, /<input|literal|載入更多/);
assert.match(renderToStaticMarkup(<ConversationHistory {...props} onToggleCollapsed={noop} />), /aria-expanded="true"[^>]*aria-label="收合歷史對話"/);
const sheet = renderToStaticMarkup(<ConversationHistory {...props} variant="sheet" collapsed onToggleCollapsed={noop} />);
assert.match(sheet, /for="conversation-search-sheet"/);
assert.doesNotMatch(sheet, /收合歷史對話|展開歷史對話/);
// 刪除鈕：有 onDelete 才出現，在開啟鈕外面（不巢狀），名稱帶對話標題；刪除中全部停用、那一列標 aria-busy
assert.doesNotMatch(html, /刪除對話/);
const deletable = renderToStaticMarkup(<ConversationHistory {...props} onDelete={noop} />);
assert.match(deletable, /aria-label="刪除對話：&lt;script&gt;literal&lt;\/script&gt;"/);
assert.doesNotMatch(deletable, /<button[^>]*data-conversation-open[^>]*>(?:(?!<\/button>).)*刪除對話/);
assert.doesNotMatch(deletable, /aria-busy="true"/);
const deleting = renderToStaticMarkup(<ConversationHistory {...props} onDelete={noop} deletingId="one" />);
assert.match(deleting, /<li[^>]*aria-busy="true"/);
// 刪除中用 aria-disabled（不是 disabled），按下的那顆保住焦點
assert.match(deleting, /aria-disabled="true"[^>]*aria-label="刪除對話：/);
assert.doesNotMatch(deleting, /disabled=""[^>]*aria-label="刪除對話：/);
console.log('Conversation history UI passed: selection, search label, escaped titles, pagination, empty/error/guest states, delete buttons.');
