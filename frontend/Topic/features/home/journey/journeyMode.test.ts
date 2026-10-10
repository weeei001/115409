import assert from 'node:assert/strict';
import { decideJourneyMode, isLowPower, type JourneyEnv } from './journeyMode';
import {
  CAPTION_FADE,
  CAPTION_HIDE_BELOW,
  CHAPTERS,
  EASE_SWELL,
  HANDOFF_END,
  HANDOFF_START,
  HANDOFF_TOP_NARROW,
  HANDOFF_TOP_WIDE,
  RAIL_FADE,
  HOUR_END,
  HOUR_START,
  RAIL,
  TERMINAL_RULE_PX,
  bezelWidth,
  captionOpacity,
  chapterIndex,
  cubicBezier,
  easeSwell,
  exitRect,
  handoffBezelIn,
  handoffCameraT,
  handoffCaption,
  handoffDeskOut,
  handoffEndIn,
  handoffFlatten,
  handoffLayout,
  handoffLift,
  handoffRoom,
  handoffValue,
  handoffWarmth,
  journeyProgress,
  lerpRect,
  measureTerminalColumns,
  railFade,
  scrollYForProgress,
  shiftHour,
  terminalColumnRects,
  type Rect,
} from './journeyMath';
import { closeRange, dayChange, groupWatch } from './scene/screens';
import { LOOKS, lookWeights } from './scene/theme';
import { boardFigures, changeText, countsText, monitorFigures, quoteCharacteristic } from './boardFormat';
import { fmtNum, signedText } from '@/lib/utils/format';

const desktop: JourneyEnv = {
  reducedMotion: false,
  hardwareConcurrency: 12,
  deviceMemory: 8,
  saveData: false,
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  capacitor: false,
};

// ── 模式判斷 ──
assert.deepEqual(decideJourneyMode(desktop), { mode: 'scene', reason: null });
assert.deepEqual(decideJourneyMode(desktop, true), { mode: 'scene', reason: null });
assert.deepEqual(decideJourneyMode(desktop, false), { mode: 'poster', reason: 'no-webgl' });
assert.deepEqual(decideJourneyMode({ ...desktop, reducedMotion: true }), { mode: 'poster', reason: 'reduced-motion' });
// 減少動態優先於其他原因
assert.equal(decideJourneyMode({ ...desktop, reducedMotion: true, hardwareConcurrency: 2 }, false).reason, 'reduced-motion');
assert.equal(decideJourneyMode({ ...desktop, hardwareConcurrency: 4 }).reason, 'low-power');
assert.equal(decideJourneyMode({ ...desktop, hardwareConcurrency: 4 }, false).reason, 'low-power');

// 低功耗的各種訊號
assert.equal(isLowPower(desktop), false);
assert.equal(isLowPower({ ...desktop, hardwareConcurrency: 4 }), true);
assert.equal(isLowPower({ ...desktop, hardwareConcurrency: 6 }), false);
assert.equal(isLowPower({ ...desktop, deviceMemory: 4 }), true);
assert.equal(isLowPower({ ...desktop, deviceMemory: 2 }), true);
assert.equal(isLowPower({ ...desktop, saveData: true }), true);
assert.equal(isLowPower({ ...desktop, capacitor: true }), true);
assert.equal(
  isLowPower({ ...desktop, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0 Mobile Safari/537.36' }),
  true,
);
// 一般 Android Chrome 不是 WebView
assert.equal(
  isLowPower({ ...desktop, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36' }),
  false,
);
// 瀏覽器沒提供的值不算低功耗（Safari、Firefox 沒有 deviceMemory）
assert.equal(isLowPower({ reducedMotion: false }), false);
assert.equal(isLowPower({ reducedMotion: false, hardwareConcurrency: 0, deviceMemory: 0 }), false);

// ── 捲動進度：可捲距離是軌道高度 − 視窗高度 ──
// 桌機 440vh、視窗 900：軌道 3960，可捲 3060
assert.equal(journeyProgress(0, 0, 3960, 900), 0);
assert.equal(journeyProgress(1530, 0, 3960, 900), 0.5);
assert.equal(journeyProgress(3060, 0, 3960, 900), 1);
assert.equal(journeyProgress(5000, 0, 3960, 900), 1);
assert.equal(journeyProgress(-200, 0, 3960, 900), 0);
// 軌道不在頁面最上方
assert.equal(journeyProgress(100, 100, 3960, 900), 0);
assert.equal(journeyProgress(100 + 765, 100, 3960, 900), 0.25);
// 手機 210svh、視窗 812：可捲 893.2
assert.ok(Math.abs(journeyProgress(446.6, 0, 1705.2, 812) - 0.5) < 1e-9);
// 軌道不比視窗高：沒有可捲距離
assert.equal(journeyProgress(0, 0, 800, 900), 1);
assert.equal(journeyProgress(-1, 0, 800, 900), 0);
// 反算 scrollY
assert.equal(scrollYForProgress(0.5, 0, 3960, 900), 1530);
assert.equal(scrollYForProgress(1.4, 100, 3960, 900), 3160);
assert.equal(scrollYForProgress(0.62, 0, 800, 900), 0);

// ── 章節（五段文案、四站 rail） ──
assert.equal(CHAPTERS.length, 5);
assert.equal(RAIL.length, 4);
assert.equal(chapterIndex(0), 0);
assert.equal(chapterIndex(0.15), 0);
assert.equal(chapterIndex(0.219), 0);
assert.equal(chapterIndex(0.22), 1);
assert.equal(chapterIndex(0.3), 1);
assert.equal(chapterIndex(0.45), 2, '靠近亮著的窗');
assert.equal(chapterIndex(0.55), 2, '0.55 是窗，不是桌前');
assert.equal(chapterIndex(0.7), 3, '0.7 是桌前');
assert.equal(chapterIndex(0.85), 4);
assert.equal(chapterIndex(0.92), 4);
assert.equal(chapterIndex(1), 4);
assert.equal(chapterIndex(-1), 0);
assert.equal(chapterIndex(2), 4);
// 章節首尾相接、涵蓋 0–1
assert.equal(CHAPTERS[0].start, 0);
assert.equal(CHAPTERS[CHAPTERS.length - 1].end, 1);
for (let i = 1; i < CHAPTERS.length; i++) assert.equal(CHAPTERS[i].start, CHAPTERS[i - 1].end);
// rail：窗與桌前都亮「窗前」，交接亮「觀測台」；首頁只用「觀測台」一個詞，不再有「觀測室」（P2-080）
assert.deepEqual(RAIL.map((r) => r.label), ['海面', '燈塔', '窗前', '觀測台']);
assert.deepEqual(CHAPTERS.map((c) => c.rail), [0, 1, 2, 2, 3]);
// 進度對應亮第幾顆 rail 按鈕（BeaconJourney 也是取 CHAPTERS[章節].rail）
const railIndex = (p: number) => CHAPTERS[chapterIndex(p)].rail;
assert.deepEqual([0, 0.3, 0.55, 0.7, 0.92].map(railIndex), [0, 1, 2, 2, 3]);
// rail 的目標進度落在對應的章節裡
RAIL.forEach((r, i) => {
  if (r.target != null) assert.equal(railIndex(r.target), i, `${r.label} 的目標 ${r.target} 不在自己的章節`);
});
assert.equal(RAIL[RAIL.length - 1].target, null, '最後一站直接跳觀測台');
assert.equal(chapterIndex(RAIL[1].target!), 1, '「從頭看起」停在燈塔（第一段介紹）');

// ── 文案透明度 ──
const BOUNDS = CHAPTERS.slice(1).map((c) => c.start);
const half = CAPTION_FADE / 2;
assert.equal(captionOpacity(0, 0), 1, '首屏文字一開始就完整顯示');
assert.equal(captionOpacity(4, 1), 1, '最後一段不淡出');
assert.equal(captionOpacity(9, 0.5), 0);
// 檢查構圖用的位置都不在交叉淡化裡：該段完整顯示，其他段完全隱藏
for (const p of [0, 0.15, 0.3, 0.45, 0.55, 0.7, 0.85, 0.92, 1]) {
  const ops = CHAPTERS.map((_, i) => captionOpacity(i, p));
  assert.equal(ops[chapterIndex(p)], 1, `p=${p} 目前的段落不是完整顯示`);
  assert.equal(ops.filter((o) => o > 0).length, 1, `p=${p} 同時看得到 ${ops.filter((o) => o > 0).length} 段`);
}
// 每段在自己區間裡（扣掉邊界前後 fade/2）都是 1，不會在章節中間半透明
CHAPTERS.forEach((c, i) => {
  const a = i === 0 ? c.start : c.start + half;
  const b = i === CHAPTERS.length - 1 ? c.end : c.end - half;
  for (let p = a; p <= b + 1e-9; p += 0.0025) assert.equal(captionOpacity(i, p), 1, `第 ${i} 段在 p=${p.toFixed(4)} 不是完整顯示`);
});
// 交叉淡化：任何進度兩段相加為 1（不會出現兩段都淡掉、畫面沒有文案的空檔），最多兩段同時可見，而且只在邊界附近
for (let p = 0; p <= 1.0001; p += 0.0025) {
  const ops = CHAPTERS.map((_, i) => captionOpacity(i, p));
  const sum = ops.reduce((s, o) => s + o, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `p=${p.toFixed(4)} 透明度總和 ${sum}`);
  const visible = ops.filter((o) => o >= CAPTION_HIDE_BELOW).length;
  assert.ok(visible >= 1 && visible <= 2, `p=${p.toFixed(4)} 有 ${visible} 段可見`);
  if (visible === 2) assert.ok(BOUNDS.some((b) => Math.abs(p - b) <= half + 1e-9), `p=${p.toFixed(4)} 不在邊界卻有兩段可見`);
}
// 邊界正中間各佔一半
for (const b of BOUNDS) {
  const i = chapterIndex(b);
  assert.ok(Math.abs(captionOpacity(i, b) - 0.5) < 1e-9);
  assert.ok(Math.abs(captionOpacity(i - 1, b) - 0.5) < 1e-9);
}

// ── 交接螢幕的數字：收盤旁只放單日漲跌（最後兩筆），不再有區間漲跌那一行 ──
{
  const closes = [2370, 2400, 2480, 2510];
  const d = dayChange(closes);
  assert.ok(d);
  assert.equal(d.change, 30);
  assert.equal(signedText(d.change, 2), '+30.00');
  assert.equal(signedText(d.percent!, 2), '+1.21', '百分比相對前一筆收盤');
  assert.equal(signedText(-12.5, 2), '−12.50', '負號用 U+2212');
  assert.equal(signedText(0, 2), '0.00');
  assert.equal(signedText(1234.5, 2), '+1234.50', '不加千分位');
  assert.equal(dayChange([2510]), null);
  // 螢幕與海報看板的漲跌字串是同一個函式（跟觀測台的報價區、大盤列同一個寫法）
  assert.equal(changeText(d.change, 2510 - d.change), '+30.00（+1.21%）');
  assert.equal(changeText(-210, 21210), '−210.00（−0.99%）');
  assert.equal(changeText(null, 1), null);
  // 報價區的燈質列：代號 · 產業 · 收盤 日期（沒有產業就略過，不留空的分隔）
  assert.equal(quoteCharacteristic('2330', '半導體業', '2026-10-01'), '2330 · 半導體業 · 收盤 2026-10-01');
  assert.equal(quoteCharacteristic('2330', null, '2026-10-01'), '2330 · 收盤 2026-10-01');
}

// ── 交接：三塊螢幕排成觀測台的三欄（300px | 1fr | 320px，容器 1320、lg:px-10、外框與欄間各 1px） ──
{
  const w = handoffLayout(1440, 843);
  assert.equal(w.single, false);
  assert.equal(w.top, HANDOFF_TOP_WIDE);
  assert.equal(w.bottom, 843);
  assert.deepEqual(w.left, [101, 401]);
  assert.deepEqual(w.center, [402, 1018]);
  assert.deepEqual(w.right, [1019, 1339]);
  // 三欄之間剛好 1px，外框也是 1px
  assert.equal(w.center[0] - w.left![1], 1);
  assert.equal(w.right![0] - w.center[1], 1);
  // 寬度沒到容器上限時，左右各留 40px
  const n = handoffLayout(1280, 663);
  assert.deepEqual(n.left, [41, 341]);
  assert.deepEqual(n.right, [919, 1239]);
  assert.equal(n.center[1] - n.center[0], 1280 - 80 - 624);
  // 超寬：容器置中
  const x = handoffLayout(1920, 1000);
  assert.equal(x.left![0], (1920 - 1320) / 2 + 41);
  assert.equal(x.right![1], (1920 - 1320) / 2 + 1320 - 41);
  // 1024 是寬版的起點（跟觀測台的 lg 一樣）
  assert.equal(handoffLayout(1024, 700).single, false);
  assert.equal(handoffLayout(1023, 700).single, true);
  // 窄螢幕：只留中間的報價（觀測台手機版也是報價在最前面），左右各 16px（sm 以上 24px）
  const m = handoffLayout(375, 756);
  assert.equal(m.single, true);
  assert.equal(m.left, null);
  assert.equal(m.right, null);
  assert.deepEqual(m.center, [17, 358]);
  assert.equal(m.top, HANDOFF_TOP_NARROW);
  assert.deepEqual(handoffLayout(768, 1000).center, [25, 743]);
  assert.ok(handoffLayout(360, 300).top <= 300 * 0.45, '矮的畫面上緣不會壓到一半以下');
  // 沒有量到觀測台時，右欄升起整欄（rightBottom = 舞台底）
  assert.equal(w.rightBottom, 843);
  assert.equal(m.rightBottom, 756);
}
// ── 交接：量到的觀測台（標題列、說明列、手機搜尋列都算進去）優先 ──
{
  const rect = (left: number, right: number, top: number, bottom = top + 700) => ({ left, right, top, bottom });
  // 寬螢幕：三欄並排；觀測台區塊上緣在 900（舞台剛好捲完時），網格上緣多了一行說明（178）
  const wide = measureTerminalColumns(900, [rect(101, 401, 1078), rect(402, 1018, 1078), rect(1019, 1339, 1078)], 156);
  assert.deepEqual(wide, { top: 178, left: [101, 401], center: [402, 1018], right: [1019, 1339], rightPanel: 156 });
  const L = handoffLayout(1440, 843, wide);
  assert.equal(L.single, false);
  assert.equal(L.top, 178, '終點三欄的上緣跟觀測台網格一樣低');
  assert.deepEqual(L.center, [402, 1018]);
  assert.equal(L.rightBottom, 178 + 156, '右欄只升起加權指數那一格');
  assert.equal(L.bottom, 843);
  // 手機：三欄疊成一欄（報價在 order-1，DOM 順序不變），只取報價那一欄
  const narrow = measureTerminalColumns(-120, [rect(16, 359, 900), rect(16, 359, 170), rect(16, 359, 1500)], 140);
  assert.deepEqual(narrow, { top: 290, left: null, center: [16, 359], right: null, rightPanel: null });
  const N = handoffLayout(375, 756, narrow);
  assert.equal(N.single, true);
  assert.equal(N.top, 290);
  assert.deepEqual(N.center, [16, 359]);
  assert.equal(N.rightBottom, 756);
  // 量不到（欄寬為 0：觀測台整格隱藏）或網格太低時退回固定版面
  assert.equal(measureTerminalColumns(0, [rect(0, 0, 0), rect(0, 0, 0), rect(0, 0, 0)], null), null);
  assert.equal(measureTerminalColumns(0, [rect(0, 300, 0)], null), null);
  assert.equal(handoffLayout(1440, 843, { ...wide!, top: 800 }).top, HANDOFF_TOP_WIDE, '網格比舞台低太多：用固定版面');
  assert.equal(handoffLayout(1440, 843, null).top, HANDOFF_TOP_WIDE);
  // 右欄第一格量不到（還在讀取）時，右欄升起整欄
  assert.equal(handoffLayout(1440, 843, { ...wide!, rightPanel: null }).rightBottom, 843);
}
// ── 螢幕的收盤線：縱軸依收盤的最低、最高自動縮放（手機的螢幕不會是一條平線） ──
{
  const r = closeRange([2370, 2400, 2480, 2510]);
  assert.ok(r.lo < 2370 && r.lo > 2370 - 20, `下緣只留一點空間：${r.lo}`);
  assert.ok(r.hi > 2510 && r.hi < 2510 + 20, `上緣只留一點空間：${r.hi}`);
  // 不從 0 起算：140 點的區間佔滿九成的高度
  assert.ok(140 / (r.hi - r.lo) > 0.85);
  const flat = closeRange([2510, 2510, 2510]);
  assert.ok(flat.hi > 2510 && flat.lo < 2510 && flat.hi - flat.lo > 0, '全部一樣也有範圍');
}
// ── 終點左欄：觀測清單依產業分組（跟觀測台的 Watchlist 同一個排序） ──
{
  const g = groupWatch([
    { symbol: '2330', name: '台積電', industry: '半導體業' },
    { symbol: '1101', name: '台泥', industry: '水泥工業' },
    { symbol: '2454', name: '聯發科', industry: '半導體業' },
    { symbol: '9999', name: '測試', industry: null },
  ]);
  assert.deepEqual(
    g.map((x) => [x.name, x.rows.map((r) => r.symbol)]),
    [
      ['未分類', ['9999']],
      ['水泥工業', ['1101']],
      ['半導體業', ['2330', '2454']],
    ].sort((a, b) => (a[0] as string).localeCompare(b[0] as string, 'zh-Hant')),
  );
}
// ── 交接的值 h（--handoff）：最後 8%（0.92 → 1），--ease-swell，所有部分由同一個 h 帶動 ──
{
  assert.equal(HANDOFF_START, 0.92);
  assert.equal(HANDOFF_END, 1);
  assert.ok(HANDOFF_START > CHAPTERS[4].start, '交接在最後一章裡');
  assert.equal((HANDOFF_END - HANDOFF_START).toFixed(2), '0.08', '捲動的最後 8%');
  // --ease-swell 的控制點跟 styles/main.css 一樣
  assert.deepEqual([...EASE_SWELL], [0.37, 0, 0.63, 1]);
  assert.equal(easeSwell(0), 0);
  assert.equal(easeSwell(1), 1);
  assert.ok(Math.abs(easeSwell(0.5) - 0.5) < 1e-9, '對稱的曲線，正中間是 0.5');
  // 用參數式獨立取樣曲線上的點 (x(s), y(s))：給 x 求出來的 y 要相符
  const B = (a: number, b: number, s: number) => 3 * (1 - s) ** 2 * s * a + 3 * (1 - s) * s * s * b + s ** 3;
  for (let s = 0.01; s < 1; s += 0.01) {
    const x = B(EASE_SWELL[0], EASE_SWELL[2], s);
    const y = B(EASE_SWELL[1], EASE_SWELL[3], s);
    assert.ok(Math.abs(easeSwell(x) - y) < 1e-7, `ease-swell(${x.toFixed(4)}) 應為 ${y.toFixed(6)}，實際 ${easeSwell(x)}`);
  }
  // 其他控制點也對（linear、CSS 的 ease）
  assert.ok(Math.abs(cubicBezier(0, 0, 1, 1, 0.3) - 0.3) < 1e-9);
  assert.ok(Math.abs(cubicBezier(0.25, 0.1, 0.25, 1, 0.5) - 0.8024033877399112) < 1e-6);

  assert.equal(handoffValue(0), 0);
  assert.equal(handoffValue(0.7), 0);
  assert.equal(handoffValue(0.9), 0);
  assert.equal(handoffValue(HANDOFF_START), 0, '0.92 還是三台螢幕在桌上');
  assert.equal(handoffValue(1), 1);
  assert.equal(handoffValue(1.3), 1);
  assert.ok(Math.abs(handoffValue(0.96) - 0.5) < 1e-9, '區間正中間是一半');
  const [h094, h098] = [handoffValue(0.94), handoffValue(0.98)];
  assert.ok(h094 > 0.08 && h094 < 0.2, `0.94 剛開始：${h094}`);
  assert.ok(h098 > 0.8 && h098 < 0.92, `0.98 快到了：${h098}`);
  assert.ok(Math.abs(h094 + h098 - 1) < 1e-9, '前後對稱');
  // 單調、連續（相鄰取樣差距小），兩端平緩（起步與收尾的斜率比中段小很多）
  let prevH = 0;
  for (let p = 0.9; p <= 1.00001; p += 0.0005) {
    const v = handoffValue(p);
    assert.ok(v >= prevH - 1e-12, `p=${p.toFixed(4)} h 倒退`);
    assert.ok(v - prevH < 0.02, `p=${p.toFixed(4)} h 跳了 ${v - prevH}`);
    prevH = v;
  }
  const slope = (p: number) => (handoffValue(p + 1e-4) - handoffValue(p)) / 1e-4;
  assert.ok(slope(0.9201) < slope(0.96) * 0.1 && slope(0.9998) < slope(0.96) * 0.1, '兩端平緩');
  // 鏡頭沿著同一條曲線推近；交接以前照原本的進度
  assert.equal(handoffCameraT(0.5), 0.5);
  assert.equal(handoffCameraT(0.92), 0.92);
  assert.equal(handoffCameraT(1), 1);
  assert.ok(Math.abs(handoffCameraT(0.96) - 0.96) < 1e-9);
  assert.ok(handoffCameraT(0.94) < 0.94 && handoffCameraT(0.98) > 0.98, '鏡頭也是慢慢起步、慢慢停下');
  // 各部分：h = 0 時都還沒開始，h = 1 時全部到位；中間都在 0–1 之間、跟著 h 單調變化
  const parts = (h: number) => [
    handoffLift(h),
    handoffFlatten(h),
    handoffDeskOut(h),
    handoffEndIn(h),
    handoffRoom(h),
    handoffWarmth(h),
    handoffCaption(h),
    handoffBezelIn(h),
  ];
  const falling = new Set([5, 6]);
  assert.deepEqual(parts(0), [0, 0, 0, 0, 0, 1, 1, 0]);
  assert.deepEqual(parts(1), [1, 1, 1, 1, 1, 0, 0, 1]);
  let last = parts(0);
  for (let h = 0; h <= 1.00001; h += 0.01) {
    const v = parts(h);
    v.forEach((x, i) => {
      assert.ok(x >= -1e-12 && x <= 1 + 1e-12);
      assert.ok(falling.has(i) ? x <= last[i] + 1e-12 : x >= last[i] - 1e-12, `h=${h.toFixed(2)} 第 ${i} 項倒退`);
    });
    last = v;
  }
  // 升起比 h 先走（鏡頭還在推近時畫面已大致到位），但兩端都精確：0 → 0、1 → 1
  for (let h = 0.01; h < 1; h += 0.01) assert.ok(handoffLift(h) > h);
  // 兩組字不會同時清楚：桌上的字淡到一成以下以後，觀測台的字才超過一成
  for (let h = 0; h <= 1.00001; h += 0.005) assert.ok(1 - handoffDeskOut(h) < 0.1 || handoffEndIn(h) < 0.1, `h=${h.toFixed(3)} 兩組字疊在一起`);
  // 「進入觀測台」在終點前就不見（終點只剩三塊畫面）；0.92 還完整顯示
  assert.equal(handoffCaption(handoffValue(0.92)), 1);
  assert.ok(handoffCaption(handoffValue(0.97)) < CAPTION_HIDE_BELOW, '0.97 已經淡掉');
  assert.equal(handoffCaption(handoffValue(1)), 0);
  // rail：交接前完整顯示，交接前段淡出（右欄升到 rail 的高度以前），終點完全不見
  assert.equal(railFade(0.92), 1);
  assert.equal(railFade(1), 0);
  assert.ok(RAIL_FADE[0] > 0 && RAIL_FADE[1] < 0.8);
  for (const p of [0, 0.3, 0.55, 0.7, 0.85, 0.9]) assert.equal(railFade(p), 1, `p=${p} rail 要看得到`);
}

// ── 交接：矩形內插、邊框寬度、欄位對應。h = 1 時三塊畫面的矩形剛好是量到的觀測台三欄 ──
{
  const rect = (left: number, right: number, top: number, bottom = top + 700) => ({ left, right, top, bottom });
  // 寬螢幕（1440×900，舞台 844）：觀測台區塊上緣在 900，網格上緣在 1045（觀測台內 145），右欄第一格 156 高
  const measured = measureTerminalColumns(900, [rect(101, 401, 1045), rect(402, 1018, 1045), rect(1019, 1339, 1045)], 156);
  const L = handoffLayout(1440, 844, measured);
  const cols = terminalColumnRects(L);
  assert.deepEqual(cols.left, { left: 101, right: 401, top: 145, bottom: 844 });
  assert.deepEqual(cols.center, { left: 402, right: 1018, top: 145, bottom: 844 });
  assert.deepEqual(cols.right, { left: 1019, right: 1339, top: 145, bottom: 145 + 156 }, '右欄只升起加權指數那一格');
  // 欄位對應：左螢幕 → 觀測清單、中間 → 報價、右螢幕 → 加權指數；跟量到的欄位一模一樣
  assert.deepEqual([cols.left!.left, cols.left!.right], measured!.left);
  assert.deepEqual([cols.center.left, cols.center.right], measured!.center);
  assert.deepEqual([cols.right!.left, cols.right!.right], measured!.right);
  assert.equal(cols.center.top, measured!.top);

  // 0.92 時三塊畫面在螢幕上的外接矩形（帶小數，跟實際投影一樣不是整數）
  const monitors: Record<'left' | 'center' | 'right', Rect> = {
    left: { left: 331.37, right: 579.812, top: 459.207, bottom: 634.66 },
    center: { left: 583.09, right: 857.3301, top: 461.5, bottom: 616.0049 },
    right: { left: 860.188, right: 1108.63, top: 459.207, bottom: 634.66 },
  };
  for (const k of ['left', 'center', 'right'] as const) {
    const col = cols[k]!;
    assert.deepEqual(lerpRect(monitors[k], col, 1), col, `${k}：h = 1 剛好是觀測台那一欄（沒有浮點誤差）`);
    assert.deepEqual(lerpRect(monitors[k], col, 0), monitors[k], `${k}：h = 0 剛好在螢幕上`);
    assert.deepEqual(lerpRect(monitors[k], col, handoffLift(handoffValue(1))), col, `${k}：進度 1 的矩形就是欄位`);
    assert.deepEqual(lerpRect(monitors[k], col, handoffLift(handoffValue(0.92))), monitors[k]);
    // 中間每一格都在兩者之間，四個邊單調移動
    let prev = monitors[k];
    for (let p = 0.92; p <= 1.00001; p += 0.002) {
      const r = lerpRect(monitors[k], col, handoffLift(handoffValue(p)));
      (['left', 'right', 'top', 'bottom'] as const).forEach((e) => {
        const lo = Math.min(monitors[k][e], col[e]) - 1e-9;
        const hi = Math.max(monitors[k][e], col[e]) + 1e-9;
        assert.ok(r[e] >= lo && r[e] <= hi, `${k}.${e} 跑出範圍`);
        const dir = Math.sign(col[e] - monitors[k][e]);
        assert.ok((r[e] - prev[e]) * dir >= -1e-9, `${k}.${e} 倒退`);
      });
      assert.ok(r.right - r.left > 0 && r.bottom - r.top > 0);
      prev = r;
    }
  }
  // 相鄰兩塊在交接中不會疊在一起（三欄之間的 1px 分隔線一路保持）
  for (let p = 0.92; p <= 1.00001; p += 0.002) {
    const h = handoffLift(handoffValue(p));
    const l = lerpRect(monitors.left, cols.left!, h);
    const c = lerpRect(monitors.center, cols.center, h);
    const r = lerpRect(monitors.right, cols.right!, h);
    assert.ok(c.left - l.right >= TERMINAL_RULE_PX - 1e-9 && r.left - c.right >= TERMINAL_RULE_PX - 1e-9, `p=${p.toFixed(3)} 畫面疊在一起`);
  }
  // 任意的浮點數也一樣：t = 1 精確等於終點、t = 0 精確等於起點
  const rnd = (() => {
    let s = 7;
    return () => ((s = (s * 16807) % 2147483647) / 2147483647) * 1500 - 100;
  })();
  for (let i = 0; i < 200; i++) {
    const a = { left: rnd(), right: rnd(), top: rnd(), bottom: rnd() };
    const b = { left: rnd() + 0.1, right: rnd() + 0.2, top: rnd() + 0.3, bottom: rnd() + 0.7 };
    assert.deepEqual(lerpRect(a, b, 1), b);
    assert.deepEqual(lerpRect(a, b, 0), a);
    assert.deepEqual(lerpRect(a, b, 1.5), b, '超過 1 夾在 1');
  }

  // 邊框：從機身邊框的寬度收成觀測台的 1px 分隔線（h = 1 剛好 1px）
  assert.equal(TERMINAL_RULE_PX, 1);
  assert.equal(bezelWidth(4.37, 0), 4.37);
  assert.equal(bezelWidth(4.37, 1), 1);
  assert.equal(bezelWidth(4.37, handoffLift(handoffValue(1))), 1);
  assert.ok(Math.abs(bezelWidth(5, 0.5) - 3) < 1e-12);
  let pb = Infinity;
  for (let p = 0.92; p <= 1.00001; p += 0.002) {
    const b = bezelWidth(6.2, handoffLift(handoffValue(p)));
    assert.ok(b <= pb + 1e-12 && b >= 1 - 1e-12, `p=${p.toFixed(3)} 邊框 ${b}`);
    pb = b;
  }
  // 終點的邊框（欄位外擴 1px）剛好是觀測台網格的外框與欄間的 1px 線：中欄左邊框的那一條就是左欄右邊框的那一條
  assert.equal(cols.center.left - TERMINAL_RULE_PX, cols.left!.right);
  assert.equal(cols.right!.left - TERMINAL_RULE_PX, cols.center.right);

  // 手機（375×812，舞台 756）：只有報價那一欄，左右各 16px 的外框；中間螢幕的邊框（1px）就是報價面板的外框
  const narrow = measureTerminalColumns(56, [rect(17, 358, 1500), rect(17, 358, 267), rect(17, 358, 2300)], 140);
  const N = handoffLayout(375, 756, narrow);
  const nc = terminalColumnRects(N);
  assert.equal(nc.left, null);
  assert.equal(nc.right, null);
  assert.deepEqual(nc.center, { left: 17, right: 358, top: 211, bottom: 756 });
  assert.deepEqual(lerpRect({ left: 41.3, right: 333.9, top: 222.4, bottom: 386.2 }, nc.center, 1), nc.center);
  assert.equal(nc.center.left - bezelWidth(4.1, 1), 16, '外框在 16px 的邊距上');
  assert.equal(nc.center.right + bezelWidth(4.1, 1), 375 - 16);
  // 左右兩塊：同樣大小，整塊（含邊框與 margin）移到畫面外；內插一路往外走
  const sideL = { left: -60.5, right: 22.25, top: 230, bottom: 380 };
  const sideR = { left: 352.75, right: 435.5, top: 230, bottom: 380 };
  const eL = exitRect(sideL, -1, 375, 16);
  const eR = exitRect(sideR, 1, 375, 16);
  assert.equal(eL.right, -16);
  assert.equal(eR.left, 375 + 16);
  assert.equal(eL.right - eL.left, sideL.right - sideL.left, '大小不變');
  assert.equal(eR.bottom - eR.top, sideR.bottom - sideR.top);
  assert.deepEqual(lerpRect(sideL, eL, 1), eL);
  assert.ok(lerpRect(sideL, eL, handoffLift(handoffValue(1))).right < 0 && lerpRect(sideR, eR, handoffLift(handoffValue(1))).left > 375, '終點完全在畫面外');
}

// ── 旅程裡的時刻：夜班餘暉 → 入夜，晨班日出前 → 日出；時間只往前走 ──
assert.equal(shiftHour(0), 0);
assert.equal(shiftHour(HOUR_START), 0);
assert.ok(shiftHour(0.15) < 0.05, '海面那一章還是首屏的天色');
assert.equal(shiftHour(HOUR_END), 1);
assert.equal(shiftHour(0.7), 1, '室內固定在觀測室的時刻');
assert.equal(shiftHour(1), 1);
{
  const h03 = shiftHour(0.3);
  assert.ok(h03 > 0.2 && h03 < 0.4, `燈塔那一章只走了三成左右，實際 ${h03}`);
  let prev = -1;
  for (let p = 0; p <= 1.0001; p += 0.005) {
    const h = shiftHour(p);
    assert.ok(h >= prev - 1e-12, `p=${p.toFixed(3)} 時間倒退`);
    prev = h;
  }
}
{
  // 權重：四組相加為 1，兩端是單一一組
  for (const [d, h] of [
    [0, 0],
    [1, 1],
    [0.3, 0.7],
    [0.5, 0.5],
  ]) {
    const w = lookWeights(d, h);
    assert.ok(Math.abs(w.reduce((s, v) => s + v, 0) - 1) < 1e-12);
  }
  assert.deepEqual(lookWeights(0, 0), [1, 0, 0, 0]);
  assert.deepEqual(lookWeights(1, 1), [0, 0, 0, 1]);
  const sun = (dawn: number, p: number) => {
    const w = lookWeights(dawn, shiftHour(p));
    return LOOKS.reduce((s, l, i) => s + l.sunElevation * w[i], 0);
  };
  // 晨班：首屏與燈塔（0.3）太陽都還在海平面下（文案「天亮前」），走到窗前（0.55）才出海面
  assert.ok(sun(1, 0) < 0 && sun(1, 0.3) < 0, `晨班 0.3 的太陽 ${sun(1, 0.3)}`);
  assert.ok(sun(1, 0.55) > 0, '晨班到窗前已經日出');
  assert.ok(sun(1, 0) < sun(1, 0.3) && sun(1, 0.3) < sun(1, 0.55), '晨班越走越亮');
  // 夜班：一路都在海平面下，越走越低（越暗）
  assert.ok(sun(0, 0) < 0 && sun(0, 0) > sun(0, 0.3) && sun(0, 0.3) > sun(0, 0.55), '夜班越走越暗');
}

// ── 海報版面的看板：跟觀測台同一組格式（fmtNum／fmtPrice／signedText，負號 U+2212） ──
{
  const up = boardFigures({ close: 48475.74, change: 122.25, date: '2026-10-02' });
  assert.ok(up);
  assert.equal(up.close, fmtNum(48475.74));
  assert.equal(up.change, '+122.25（+0.25%）', '百分比相對前一筆收盤（close − change）');
  assert.equal(up.tone, 'up');
  assert.equal(up.date, '2026-10-02');
  const down = boardFigures({ close: 21000, change: -210, date: '2026-10-02' });
  assert.equal(down?.change, '−210.00（−0.99%）');
  assert.equal(down?.tone, 'down');
  const flat = boardFigures({ close: 21000, change: 0, date: '2026-10-02' });
  assert.equal(flat?.change, '0.00（0.00%）');
  assert.equal(flat?.tone, 'neutral', '平盤是中性色');
  const noChange = boardFigures({ close: 21000, change: null, date: '2026-10-02' });
  assert.equal(noChange?.change, null);
  assert.equal(noChange?.tone, 'neutral');
  assert.equal(boardFigures(null), null);

  const m = monitorFigures({ symbol: '2330', name: '台積電', closes: [2370, 2400, 2480, 2510], date: '2026-10-01' });
  assert.ok(m);
  assert.equal(m.close, '2510.00');
  assert.equal(m.change, '+30.00（+1.21%）', '單日漲跌：最後兩筆收盤');
  assert.equal(m.tone, 'up');
  assert.deepEqual(m.closes, [2370, 2400, 2480, 2510]);
  assert.equal(monitorFigures({ symbol: '2330', name: '台積電', closes: [2510, 2480], date: '2026-10-01' })?.tone, 'down');
  assert.equal(monitorFigures({ symbol: '2330', name: '台積電', closes: [2510, 2510], date: '2026-10-01' })?.change, '0.00（0.00%）');
  assert.equal(monitorFigures({ symbol: '2330', name: '台積電', closes: [2510], date: '2026-10-01' }), null, '只有一筆收盤不算漲跌');
  assert.equal(monitorFigures(null), null);

  assert.equal(countsText(40, 20), '40 檔 · 20 個產業');
  assert.equal(countsText(1234, 20), '1,234 檔 · 20 個產業');
  assert.equal(countsText(null, 20), null);
  assert.equal(countsText(40, null), null);
}

console.log('Journey mode, progress, chapter, time-of-day, hand-off layout, hand-off interpolation and board checks passed.');
