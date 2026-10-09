import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatInput } from './ChatInput';
const noop = () => {};
const waiting = renderToStaticMarkup(<ChatInput onSend={noop} disabled onStop={noop} />);
assert.match(waiting, /停止回覆<\/button>/);
assert.match(waiting, /<textarea[^>]* disabled=""/);
assert.match(waiting, /placeholder="輸入你的問題…"/);
assert.doesNotMatch(waiting, /停止接收|您/);
assert.doesNotMatch(waiting, /僅供研究參考|不是投資建議|aria-describedby/);
const longInput = renderToStaticMarkup(<ChatInput onSend={noop} disabled={false} initialValue={'a'.repeat(5500)} />);
assert.match(longInput, /aria-describedby="chat-input-note"/);
assert.match(longInput, /5500.*6000/);
const stopped = renderToStaticMarkup(<ChatInput onSend={noop} disabled={false} stopNotice />);
assert.match(stopped, /role="status"[^>]*>已停止顯示這則回覆。</);
// 停止後不再出現開發用語
assert.doesNotMatch(stopped, /後端|<textarea[^>]* disabled=""|停止回覆<\/button>/);
assert.doesNotMatch(renderToStaticMarkup(<ChatInput onSend={noop} disabled={false} />), /已停止顯示|停止回覆<\/button>/);
console.log('Chat stop UI passed: stop-reply control, enabled input after stop, plain stop notice, no fixed disclaimer.');
