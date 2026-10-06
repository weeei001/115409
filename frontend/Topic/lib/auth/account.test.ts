import assert from 'node:assert/strict';
import { authAccountChange, authAccountSnapshot, subscribeAuthAccount } from './account';
import { clearAuth, setAuth, updateStoredUser } from './storage';

const values = new Map<string, string>();
const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
const events = new EventTarget();
Object.defineProperty(globalThis, 'window', { value: events, configurable: true });
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
const user = (id: number) => ({ id, email: `fixture-${id}@example.com`, display_name: 'Fixture' });

let notified = 0;
const unsubscribe = subscribeAuthAccount(() => { notified += 1; });

setAuth('session-one', user(1));
const shown = authAccountSnapshot();
assert.ok(shown, 'Logged-in snapshot must be non-empty');

// 同一個人只改顯示名稱：快照不變，畫面不用重來
updateStoredUser({ ...user(1), display_name: 'Updated' });
assert.equal(authAccountChange(shown, authAccountSnapshot()), 'same');

// 同一個人重新登入（token 換了）：仍是同一個身分
storage.setItem('topictest_access_token', 'session-one-renewed');
assert.equal(authAccountChange(shown, authAccountSnapshot()), 'same');

// 另一個分頁換成別的使用者：只會收到 storage 事件
const before = notified;
storage.setItem('topictest_access_token', 'session-two');
storage.setItem('topictest_user', JSON.stringify(user(2)));
events.dispatchEvent(new Event('storage'));
assert.equal(notified, before + 1, 'Cross-tab storage events must notify subscribers');
assert.equal(authAccountChange(shown, authAccountSnapshot()), 'switch');

// 另一個分頁登出：localStorage 已清空，本分頁只收到 storage 事件（02-F1 的情境）
storage.removeItem('topictest_access_token');
storage.removeItem('topictest_user');
events.dispatchEvent(new Event('storage'));
assert.equal(authAccountSnapshot(), '');
assert.equal(authAccountChange(shown, authAccountSnapshot()), 'logout');

// 本分頁登出
setAuth('session-three', user(3));
const third = authAccountSnapshot();
clearAuth();
assert.equal(authAccountChange(third, authAccountSnapshot()), 'logout');

// 畫面還沒顯示任何身分：不用處理
assert.equal(authAccountChange('', ''), 'same');
assert.equal(authAccountChange('', third), 'same');

const count = notified;
unsubscribe();
events.dispatchEvent(new Event('storage'));
assert.equal(notified, count, 'Unsubscribe must remove the storage listener');

console.log('Auth account tests passed: profile update, renewed token, cross-tab switch, cross-tab logout, local logout, cleanup.');
