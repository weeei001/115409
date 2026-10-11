import assert from 'node:assert/strict';
import { calloutPlacement, scrollTargetTop, spotlightBox, SPOT_PAD, type Viewport } from './tourLayout';
import { availableSteps, MIN_TOUR_STEPS, TOURS, tourFor } from './tours';

const desktop: Viewport = { width: 1440, height: 900, header: 56 };
const card = { width: 360, height: 240 };

// 外框：比區塊大一圈，裁在頁首以下、視窗以內；完全看不到時是 null
assert.deepEqual(spotlightBox({ top: 200, left: 100, width: 400, height: 300 }, desktop), { top: 200 - SPOT_PAD, left: 100 - SPOT_PAD, width: 400 + SPOT_PAD * 2, height: 300 + SPOT_PAD * 2 });
assert.deepEqual(spotlightBox({ top: -500, left: 0, width: 1440, height: 2000 }, desktop), { top: 56, left: 0, width: 1440, height: 900 - 56 }, 'a tall section is framed where it is visible');
assert.equal(spotlightBox({ top: 1200, left: 0, width: 100, height: 100 }, desktop), null);
assert.equal(spotlightBox({ top: 0, left: 0, width: 100, height: 40 }, desktop), null, 'hidden behind the sticky header');

// 說明卡：先放下方，放不下放上方，都放不下疊在視窗底部；水平夾在視窗內
const below = calloutPlacement({ top: 100, left: 80, width: 600, height: 300 }, desktop, card, false);
assert.equal(below.side, 'below');
assert.equal(below.top, 100 + 300 + 12);
assert.equal(below.left, 80);
const above = calloutPlacement({ top: 500, left: 80, width: 600, height: 380 }, desktop, card, false);
assert.equal(above.side, 'above');
assert.ok(above.top + card.height <= 500);
// 窄而高的欄：上下都放不下時放旁邊（右邊優先），頂端對齊外框
const beside = calloutPlacement({ top: 73, left: 88, width: 316, height: 827 }, desktop, card, false);
assert.deepEqual(beside, { top: 73, left: 88 + 316 + 12, side: 'right' });
const leftOf = calloutPlacement({ top: 73, left: 1006, width: 336, height: 827 }, desktop, card, false);
assert.equal(leftOf.side, 'left');
assert.equal(leftOf.left, 1006 - 12 - 360);
assert.ok(calloutPlacement({ top: 800, left: 88, width: 316, height: 400 }, desktop, card, false).top + card.height <= desktop.height - 16, 'a side card stays inside the viewport');
const inside = calloutPlacement({ top: 56, left: 0, width: 1440, height: 844 }, desktop, card, false);
assert.equal(inside.side, 'inside');
assert.ok(inside.top + card.height <= desktop.height);
assert.equal(calloutPlacement({ top: 100, left: 1300, width: 140, height: 100 }, desktop, card, false).left, 1440 - 360 - 16, 'never runs off the right edge');
assert.equal(calloutPlacement({ top: 100, left: -20, width: 140, height: 100 }, desktop, card, false).left, 16);
// 區塊不在畫面上（還在捲動、或剛好被移掉）：說明卡放在畫面中間
assert.equal(calloutPlacement(null, desktop, card, false).side, 'inside');
// 手機：說明卡貼在畫面底部，全寬
const phone: Viewport = { width: 375, height: 812, header: 56 };
assert.deepEqual(calloutPlacement({ top: 100, left: 0, width: 375, height: 200 }, phone, { width: 375, height: 260 }, true), { top: 812 - 260, left: 0, side: 'dock' });

// 捲動：放得下就在「頁首以下、說明卡以上」置中，放不下就讓頂端貼著頁首下方
const centered = scrollTargetTop({ top: 1500, left: 0, width: 600, height: 200 }, 1000, desktop);
assert.equal(centered, Math.round(1500 + 1000 - 56 - (900 - 56 - 200) / 2));
const tall = scrollTargetTop({ top: 1500, left: 0, width: 600, height: 1200 }, 1000, desktop);
assert.equal(tall, 1500 + 1000 - 56 - SPOT_PAD - 16);
assert.equal(scrollTargetTop({ top: 10, left: 0, width: 600, height: 100 }, 0, desktop), 0, 'never scrolls above the page');
// 手機的說明卡佔掉底部：可用空間變小，區塊的位置跟著往上
assert.ok(scrollTargetTop({ top: 1500, left: 0, width: 375, height: 200 }, 0, phone, 260) > scrollTargetTop({ top: 1500, left: 0, width: 375, height: 200 }, 0, phone, 0));

// 導覽內容：每頁至少 MIN_TOUR_STEPS 步，目標不重複，文字不空白；沒有導覽的頁面回 null
assert.ok(Object.keys(TOURS).length >= 1);
for (const [path, tour] of Object.entries(TOURS)) {
  assert.equal(tourFor(path), tour);
  assert.ok(tour.steps.length >= MIN_TOUR_STEPS, `${path} has enough steps`);
  assert.equal(new Set(tour.steps.map((step) => step.target)).size, tour.steps.length, `${path} targets are unique`);
  for (const step of tour.steps) {
    assert.ok(step.title.trim() && step.body.trim(), `${path}/${step.target} has copy`);
    assert.ok(step.body.length <= 120, `${path}/${step.target} is short enough for the card (${step.body.length})`);
    // 不給買賣建議、不用「今日／即時」（資料是最近交易日的收盤）
    assert.doesNotMatch(step.title + step.body, /建議買|建議賣|該買|該賣|今日|即時/, `${path}/${step.target}`);
  }
  const ids = Object.values(TOURS).map((other) => other.id);
  assert.equal(new Set(ids).size, ids.length, 'tour ids are unique');
}
assert.equal(tourFor('/ai'), null);
// 畫面上沒有的區塊（沒登入、還沒比較）跳過
const sample = Object.values(TOURS)[0];
const shown = new Set(sample.steps.slice(1).map((step) => step.target));
assert.deepEqual(availableSteps(sample, (target) => shown.has(target)), sample.steps.slice(1));

console.log('Page tour passed: spotlight clipping, callout placement (below/above/right/left/inside/dock), scroll targets, tour copy rules and step availability.');
