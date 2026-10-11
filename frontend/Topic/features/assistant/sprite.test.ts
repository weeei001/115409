import assert from 'node:assert/strict';
import {
  IDLE_ACTIONS, MASCOT_BODY, SPRITE_HEIGHT, SPRITE_WIDTH, idleAction, isBlinking, mascotFrame, mascotPaths, mascotPixels,
  type MascotFrame, type MascotMood, type MascotPaint,
} from './sprite';

const MOODS: MascotMood[] = ['idle', 'greet', 'thinking', 'done', 'error'];
const bodyPaints = new Set<MascotPaint>(['line', 'eye', 'body', 'shade', 'glass', 'lamp', 'lampDim', 'lampOff']);
/** 燈塔（不含海）畫了幾格 */
const towerSize = (frame: MascotFrame) => [...mascotPixels(frame).values()].filter((paint) => bodyPaints.has(paint)).length;
const paintAt = (frame: MascotFrame, paint: MascotPaint) => [...mascotPixels(frame)].filter(([, p]) => p === paint).map(([key]) => key.split(',').map(Number));

// 本體 18 列 × 20 欄，只用約定的字元；輪廓左右對稱（暗面 S 只是上色，不影響輪廓）
assert.equal(MASCOT_BODY.length, 18);
for (const row of MASCOT_BODY) {
  assert.equal(row.length, 20);
  assert.match(row, /^[.KWSGL]+$/);
  const mask = [...row].map((ch) => (ch === '.' ? 0 : 1)).join('');
  assert.equal(mask, [...mask].reverse().join(''), `outline is symmetric: ${row}`);
}

// 每一格的燈塔都完整畫在畫布裡：跳最高、走到最左、沉下去、打瞌睡的 Z 都不會被裁掉
const variants = [{}, { drowsy: true }, { surfing: true }];
for (const mood of MOODS) {
  for (let tick = 0; tick < 800; tick += 1) {
    for (const options of variants) {
      const frame = mascotFrame(mood, tick, 0, options);
      const unclipped = towerSize({ ...frame, lift: 0, dx: 0 });
      assert.equal(towerSize(frame), unclipped, `${mood}@${tick} ${JSON.stringify(options)} keeps the tower inside the ${SPRITE_WIDTH}x${SPRITE_HEIGHT} canvas`);
    }
  }
}

// 海：每一欄都有浪頂，浪會往左流；捲動時流得比較快、打瞌睡時比較慢
const crest = (frame: MascotFrame) => paintAt(frame, 'sea').sort((a, b) => a[0] - b[0]).map(([, y]) => y).join('');
assert.equal(paintAt(mascotFrame('idle', 0), 'sea').length, SPRITE_WIDTH);
assert.notEqual(crest(mascotFrame('idle', 0)), crest(mascotFrame('idle', 2)));
const seaSpeed = (options: object) => mascotFrame('idle', 40, 0, options).sea - mascotFrame('idle', 0, 0, options).sea;
assert.ok(seaSpeed({ surfing: true }) > seaSpeed({}) && seaSpeed({}) > seaSpeed({ drowsy: true }));

// 待機：燈一直亮著；光束照 Fl W 10s，80 格（10 秒）掃一次，先左後右
const idle = (tick: number) => mascotFrame('idle', tick);
assert.ok(Array.from({ length: 160 }, (_, tick) => idle(tick)).every((frame) => frame.lamp === 'on'));
assert.deepEqual([0, 1, 2, 3, 4, 79, 80].map((tick) => [idle(tick).beamLeft, idle(tick).beamRight]),
  [[true, false], [true, false], [false, true], [false, true], [false, false], [false, false], [true, false]]);

// 待機小動作：每 20 秒一個，五種輪流，不和光束掃過的時間重疊
const seen = new Set<string>();
for (let tick = 0; tick < 160 * IDLE_ACTIONS.length; tick += 1) {
  const current = idleAction(tick);
  if (current) {
    seen.add(current.action);
    assert.ok(tick % 80 >= 4, 'an idle action never starts during the beam sweep');
  }
}
assert.deepEqual([...seen].sort(), [...IDLE_ACTIONS].sort());
const during = (action: string) => Array.from({ length: 160 * IDLE_ACTIONS.length }, (_, tick) => tick).filter((tick) => idleAction(tick)?.action === action).map(idle);
assert.ok(during('patrol').some((frame) => frame.dx === -3) && during('patrol').some((frame) => frame.foot !== 'none'), 'patrol walks with alternating feet');
assert.ok(during('patrol').at(-1)!.dx === 0, 'patrol walks back home');
assert.ok(during('wave').some((frame) => frame.arm === 'up') && during('wave').some((frame) => frame.arm === 'down'));
assert.ok(during('look').some((frame) => frame.look === -1) && during('look').some((frame) => frame.look === 1));
assert.ok(during('hop').some((frame) => frame.lift >= 3));
assert.ok(during('spin').filter((frame) => frame.beamLeft).length >= 4 && during('spin').filter((frame) => frame.beamRight).length >= 4);
// 捲動時不做小動作，只跟著浪晃
assert.ok(Array.from({ length: 800 }, (_, tick) => mascotFrame('idle', tick, 0, { surfing: true })).every((frame) => frame.dx === 0 && frame.arm === 'none'));

// 打瞌睡：閉眼、燈調暗、沒有光束，頭頂的 Z 往上飄；只有待機會打瞌睡
const sleeping = Array.from({ length: 32 }, (_, tick) => mascotFrame('idle', tick, 0, { drowsy: true }));
assert.ok(sleeping.every((frame) => frame.eyes === 'blink' && frame.lamp === 'dim' && !frame.beamLeft && !frame.beamRight && frame.z !== null));
assert.ok(new Set(sleeping.map((frame) => frame.z)).size >= 3, 'the Z floats up');
assert.equal(mascotFrame('thinking', 5, 0, { drowsy: true }).z, null);

// 思考中：Q 急閃，每秒（8 格）亮一次；眼睛往上看、頭頂的點會增加
const thinking = Array.from({ length: 16 }, (_, tick) => mascotFrame('thinking', tick, 0));
assert.deepEqual(thinking.map((frame) => frame.lamp === 'on'), [...Array(4).fill(true), ...Array(4).fill(false), ...Array(4).fill(true), ...Array(4).fill(false)]);
assert.ok(thinking.every((frame) => frame.eyes === 'up' && !frame.beamLeft && !frame.beamRight));
assert.ok(thinking.some((frame) => frame.dots === 3));

// 打招呼：先嚇一跳（睜大眼），再跳起來揮手、光束全開，播完回到待機
const greet = Array.from({ length: 20 }, (_, tick) => mascotFrame('greet', 100 + tick, 100));
assert.equal(greet[0].eyes, 'wide');
assert.ok(greet.slice(2, 8).every((frame) => frame.eyes === 'happy' && frame.beamLeft && frame.beamRight && frame.arm !== 'none'));
assert.ok(Math.max(...greet.map((frame) => frame.lift)) >= 3);
assert.deepEqual(greet[19], mascotFrame('idle', 119));

// 有新回覆：兩道光束一直亮著，和待機（每 10 秒掃一下）分得出來
assert.ok(Array.from({ length: 800 }, (_, tick) => mascotFrame('done', tick, 0)).every((frame) => frame.lamp === 'on' && frame.beamLeft && frame.beamRight && frame.dx === 0));

// 出錯：熄燈、沒有光束、往海裡沉一格
for (let tick = 0; tick < 100; tick += 1) {
  const frame = mascotFrame('error', tick, 0);
  assert.equal(frame.lamp, 'off');
  assert.equal(frame.beamLeft || frame.beamRight, false);
  assert.equal(frame.lift, -1);
}

// 靜止版（減少動態或按了暫停）：每種心情一張圖，跟 tick、游標、捲動、瞌睡都無關
for (const mood of MOODS) {
  const still = mascotFrame(mood, 0, 0, { reduced: true, look: -1 });
  for (const tick of [1, 7, 33, 80, 401]) assert.deepEqual(mascotFrame(mood, tick, 0, { reduced: true, look: 1, drowsy: true, surfing: true }), still);
  assert.equal(still.sea, 0);
}
const stills = MOODS.map((mood) => JSON.stringify(mascotFrame(mood, 0, 0, { reduced: true })));
assert.equal(new Set(stills).size, MOODS.length, 'every mood has its own still picture');

// 眨眼不規則、但不會一直閉著
const blinks = Array.from({ length: 400 }, (_, tick) => isBlinking(tick)).filter(Boolean).length;
assert.ok(blinks > 10 && blinks < 60, `blinks ${blinks} times in 50 seconds`);

// 眼睛跟著看：左右各移一格
const eyeColumns = (frame: MascotFrame) => paintAt(frame, 'eye').map(([x]) => x).sort((a, b) => a - b);
const center = mascotFrame('idle', 6, 6, { look: 0 });
assert.deepEqual(eyeColumns({ ...center, look: -1 }), eyeColumns(center).map((x) => x - 1));
assert.deepEqual(eyeColumns({ ...center, look: 1 }), eyeColumns(center).map((x) => x + 1));

// path：同一列連續的格子併成一段，畫出來的格數不變
const paths = mascotPaths(center);
const area = Object.values(paths).reduce((sum, d) => sum + [...d!.matchAll(/h(\d+)v1/g)].reduce((total, match) => total + Number(match[1]), 0), 0);
assert.equal(area, mascotPixels(center).size);
assert.ok(paths.lamp && !paths.lampDim && !paths.lampOff, 'the idle lamp is lit');
assert.ok(paths.sea && paths.water, 'the tower stands on the sea');
assert.ok(mascotPaths(mascotFrame('thinking', 4, 0)).lampDim, 'the thinking flash dims the lamp between flashes');
assert.ok(mascotPaths(mascotFrame('error', 0, 0)).lampOff && !mascotPaths(mascotFrame('error', 0, 0)).lamp, 'an error puts the lamp out');

console.log('Mascot sprite passed: symmetric outline, canvas bounds, flowing sea, Fl W 10s beam sweep, five idle actions, dozing, Q thinking flash, greet/done/error moods, still pictures, eye tracking and merged paths.');
