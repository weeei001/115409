import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const handlers: Record<string, (event: unknown) => void> = {};
let opened = '';
const origin = 'https://stocks.example';
vm.runInNewContext(readFileSync('public/firebase-messaging-sw.js', 'utf8'), {
  URL, importScripts: () => {}, firebase: { initializeApp: () => {}, messaging: () => {} },
  self: { location: { origin, href: `${origin}/firebase-messaging-sw.js?config=%7B%7D` }, addEventListener: (name: string, handler: (event: unknown) => void) => { handlers[name] = handler; } },
  clients: { openWindow: (url: string) => { opened = url; return Promise.resolve(); } },
});
for (const [url, expected] of [
  ['/stock/2330', `${origin}/stock/2330`],
  ['/favorites#notifications', `${origin}/favorites#notifications`],
  ['https://evil.example', `${origin}/favorites#notifications`],
  ['//evil.example', `${origin}/favorites#notifications`],
  ['javascript:alert(1)', `${origin}/favorites#notifications`],
]) {
  handlers.notificationclick({ notification: { data: { FCM_MSG: { data: { url } } }, close() {} }, stopImmediatePropagation() {}, waitUntil() {} });
  assert.equal(opened, expected);
}
console.log('Push worker tests passed: notification links stay on the application origin.');
