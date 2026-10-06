import assert from 'node:assert/strict';
import { isHistoryTraversal, restoreWhenReady, ScrollMemory, shouldRestoreScroll, type RestoreEnv, type RestoreResult } from './scrollRestoration';

/** 假的瀏覽器：手動推進 frame 與時間，頁面高度由測試控制 */
function fakeEnv(initialMax: number) {
  let time = 0;
  let max = initialMax;
  let queued: (() => void) | null = null;
  let inputListener: (() => void) | null = null;
  const scrolls: number[] = [];
  const env: RestoreEnv = {
    maxScroll: () => max,
    scrollTo: (y) => scrolls.push(y),
    now: () => time,
    frame: (cb) => { queued = cb; return 1; },
    cancelFrame: () => { queued = null; },
    onUserInput: (cb) => { inputListener = cb; return () => { inputListener = null; }; },
  };
  return {
    env,
    scrolls,
    setMax: (value: number) => { max = value; },
    /** 推進 ms 毫秒，每 16ms 跑一個 frame */
    advance: (ms: number) => {
      const end = time + ms;
      while (time < end && queued) {
        time += 16;
        const cb = queued;
        queued = null;
        cb();
      }
    },
    userScrolls: () => inputListener?.(),
    listening: () => inputListener !== null,
  };
}

// 首頁新聞 5091 → 新聞頁 → 上一頁：骨架只有 800 高，資料到了才夠高；夠高且穩定後才捲（03-F5）
{
  const page = fakeEnv(800);
  const results: RestoreResult[] = [];
  restoreWhenReady(5091, page.env, (r) => results.push(r));
  page.advance(500);
  assert.deepEqual(page.scrolls, [], 'Must not scroll while the page is still too short');
  page.setMax(6000);
  page.advance(100);
  assert.deepEqual(page.scrolls, [], 'Must wait until the height has been stable');
  page.advance(200);
  assert.deepEqual(page.scrolls, [5091]);
  assert.deepEqual(results, ['restored']);
  assert.equal(page.listening(), false, 'Input listeners must be removed after restoring');
}

// 高度還在變（上方內容陸續長出來）：每次變動都重新計時
{
  const page = fakeEnv(6000);
  restoreWhenReady(1000, page.env, () => {});
  page.advance(100);
  page.setMax(6500);
  page.advance(100);
  assert.deepEqual(page.scrolls, [], 'A height change restarts the stable window');
  page.advance(100);
  assert.deepEqual(page.scrolls, [1000]);
}

// 使用者自己捲動：放棄，不再把畫面拉走
{
  const page = fakeEnv(500);
  const results: RestoreResult[] = [];
  restoreWhenReady(3000, page.env, (r) => results.push(r));
  page.advance(200);
  page.userScrolls();
  page.setMax(9000);
  page.advance(1000);
  assert.deepEqual(page.scrolls, []);
  assert.deepEqual(results, ['user']);
}

// 一直不夠高：逾時放棄
{
  const page = fakeEnv(500);
  const results: RestoreResult[] = [];
  restoreWhenReady(3000, page.env, (r) => results.push(r), { timeoutMs: 1000 });
  page.advance(2000);
  assert.deepEqual(page.scrolls, []);
  assert.deepEqual(results, ['timeout']);
}

// 換頁時取消：不捲、不回報
{
  const page = fakeEnv(500);
  const results: RestoreResult[] = [];
  const cancel = restoreWhenReady(3000, page.env, (r) => results.push(r));
  cancel();
  page.setMax(9000);
  page.advance(1000);
  assert.deepEqual(page.scrolls, []);
  assert.deepEqual(results, []);
  assert.equal(page.listening(), false);
}

// 位置以瀏覽紀錄 key 記住；只留最近 50 筆
{
  const memory = new ScrollMemory();
  memory.set('a', 5091.4);
  assert.equal(memory.get('a'), 5091);
  assert.equal(memory.get('missing'), null);
  assert.equal(memory.get(''), null);
  for (let i = 0; i < 60; i += 1) memory.set(`k${i}`, i);
  assert.equal(memory.get('a'), null, 'Oldest entries are dropped');
  assert.equal(memory.get('k59'), 59);
}

// 上一頁／下一頁：routeChangeStart 時 history.state 已經是目的地；push、replace 時還是目前這一頁
assert.equal(isHistoryTraversal('page-a', 'page-b'), true, 'Back/forward');
assert.equal(isHistoryTraversal('page-a', 'page-a'), false, 'Push (not pushed yet) or replace keeps the key');
assert.equal(isHistoryTraversal('', 'page-b'), false, 'Unknown current key: do not guess');
assert.equal(isHistoryTraversal('page-a', ''), false, 'Entry without a Next key (e.g. hash change)');

// 自己管捲動的頁面與帶錨點的網址不還原
assert.equal(shouldRestoreScroll('/'), true);
assert.equal(shouldRestoreScroll('/stock/2330?newsView=1'), true);
assert.equal(shouldRestoreScroll('/ai'), false);
assert.equal(shouldRestoreScroll('/ai?c=12'), false);
assert.equal(shouldRestoreScroll('/news/abc#analysis'), false);

console.log('Scroll restoration tests passed: wait for height, stable window, user input, timeout, cancel, memory, exclusions.');
