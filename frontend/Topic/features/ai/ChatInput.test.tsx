import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { AI_CHAT_DISCLAIMER } from '../../lib/disclaimers';
import { ChatInput } from './ChatInput';
const noop = () => {};
const waiting = renderToStaticMarkup(<ChatInput onSend={noop} disabled onStop={noop} />);
assert.match(waiting, /停止回覆<\/button>/);
assert.match(waiting, /<textarea[^>]* disabled=""/);
assert.match(waiting, /placeholder="輸入你的問題…"/);
assert.doesNotMatch(waiting, /停止接收|您/);
assert.ok(waiting.includes(AI_CHAT_DISCLAIMER));
const stopped = renderToStaticMarkup(<ChatInput onSend={noop} disabled={false} stopNotice />);
assert.match(stopped, /role="status"[^>]*>已停止顯示這則回覆。</);
// 停止後不再出現開發用語
assert.doesNotMatch(stopped, /後端|<textarea[^>]* disabled=""|停止回覆<\/button>/);
assert.doesNotMatch(renderToStaticMarkup(<ChatInput onSend={noop} disabled={false} />), /已停止顯示|停止回覆<\/button>/);
console.log('Chat stop UI passed: stop-reply control, enabled input after stop, plain stop notice, shared disclaimer.');
