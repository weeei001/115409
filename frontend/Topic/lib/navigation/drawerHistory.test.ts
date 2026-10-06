import assert from 'node:assert/strict';
import { createDrawerHistory } from './drawerHistory';

type State = { as: string; key: string; __N: true; [key: string]: unknown };

/** 假的瀏覽紀錄：back()／forward() 會先跑「Next」的 popstate（beforePopState），再跑抽屜的監聽 */
function harness(asPath = '/stock/2330') {
  const entries: State[] = [{ as: asPath, key: 'k1', __N: true }];
  let index = 0;
  let bps: (state: State) => boolean = () => true;
  const listeners: Array<() => void> = [];
  const deferred: Array<() => void> = [];
  const nextHandled: State[] = [];
  const pop = () => {
    const state = entries[index];
    // Next 的 onPopState：只有 beforePopState 回 true 才會換頁
    if (bps(state)) nextHandled.push(state);
    listeners.forEach((listener) => listener());
  };
  const drawers = createDrawerHistory({
    getState: () => entries[index],
    pushState: (state) => {
      entries.splice(index + 1);
      entries.push(state as State);
      index += 1;
    },
    back: () => {
      index -= 1;
      pop();
    },
    onPopState: (listener) => listeners.push(listener),
    setBeforePopState: (cb) => { bps = cb as typeof bps; },
    getAsPath: () => asPath,
    defer: (fn) => deferred.push(fn),
  });
  return {
    drawers,
    entries,
    get index() { return index; },
    nextHandled,
    userBack: () => { index -= 1; pop(); },
    userForward: () => { index += 1; pop(); },
    flush: () => { while (deferred.length) deferred.shift()!(); },
    navigate: (as: string) => { asPath = as; },
  };
}

// 打開抽屜：多一筆同網址的紀錄，保留 Next 的 key
{
  const h = harness();
  h.drawers.open(() => {});
  assert.equal(h.entries.length, 2);
  assert.equal(h.entries[1].key, 'k1', 'Marker entry keeps the page key for scroll restoration');
  assert.equal(h.entries[1].as, '/stock/2330');
  assert.ok('__teiDrawer' in h.entries[1]);
}

// 按上一頁：只關抽屜，Next 不換頁（不會捲回頂端）
{
  const h = harness();
  let closed = 0;
  h.drawers.open(() => { closed += 1; });
  h.userBack();
  assert.equal(h.nextHandled.length, 0, 'Next must not handle the pop while a drawer is open');
  assert.equal(closed, 0, 'Close runs after Next has seen the pop');
  h.flush();
  assert.equal(closed, 1);
  assert.equal(h.index, 0, 'Still on the same page entry');
}

// 用介面關閉：自己退一筆，不會再呼叫 onPopClose；after 在退完之後才執行
{
  const h = harness();
  let popClosed = 0;
  const order: string[] = [];
  const entry = h.drawers.open(() => { popClosed += 1; });
  h.drawers.close(entry, () => order.push('after'));
  assert.equal(h.index, 0, 'Marker entry removed');
  assert.equal(h.nextHandled.length, 0);
  assert.deepEqual(order, []);
  h.flush();
  assert.deepEqual(order, ['after']);
  assert.equal(popClosed, 0);
  // 關閉後再按上一頁：已經沒有抽屜，交給 Next 正常處理
  assert.equal(h.drawers.isOpen(entry), false);
}

// 已經按過上一頁的抽屜，再由介面關閉：不再退紀錄，after 直接執行
{
  const h = harness();
  const entry = h.drawers.open(() => {});
  h.userBack();
  h.flush();
  let ran = false;
  h.drawers.close(entry, () => { ran = true; });
  assert.equal(ran, true);
  assert.equal(h.index, 0);
}

// 關閉後按「下一頁」走進舊的標記紀錄、再上一頁：網址沒變，Next 不重新換頁
{
  const h = harness();
  const entry = h.drawers.open(() => {});
  h.drawers.close(entry);
  h.flush();
  h.userForward();
  h.flush();
  h.userBack();
  h.flush();
  assert.equal(h.nextHandled.length, 0, 'Same-URL traversals through a stale marker are ignored by Next');
}

// 抽屜裡的連結換到別頁後（forget），上一頁回到標記紀錄是正常換頁，再上一頁同網址則不重載
{
  const h = harness();
  const entry = h.drawers.open(() => {});
  h.drawers.forget(entry);
  h.entries.push({ as: '/news/abc', key: 'k2', __N: true });
  h.navigate('/news/abc');
  h.userForward();
  h.flush();
  h.userBack();
  assert.equal(h.nextHandled.length, 1, 'Leaving the other page back to the stock page is a normal navigation');
  h.navigate('/stock/2330');
  h.flush();
  h.userBack();
  h.flush();
  assert.equal(h.nextHandled.length, 1, 'Popping the stale marker on the same URL does not reload the page');
}

console.log('Drawer history tests passed.');
