import assert from 'node:assert/strict';
import React from 'react';
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
console.log('Conversation history UI passed: selection, search label, escaped titles, pagination, empty/error/guest states.');
