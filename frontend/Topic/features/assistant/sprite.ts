/**
 * 站內助手「小燈」的像素圖與動畫格（DESIGN.md 第 12 節）。
 *
 * 畫布 26×25 格：上方 4 列留給跳躍與頭頂的字，中間是 20×18 的燈塔，最下面 3 列是會流動的海浪（股海）。
 * 每一格 125ms（--dur-flash）換一張。燈平常亮著；光束照燈質 Fl W 10s 每 10 秒掃一次；
 * 待機時每 20 秒換一個小動作（張望、走兩步、轉燈、揮手、跳一下），太久沒人理會打瞌睡。
 * 思考中照「讀取中」的 Q 急閃，每秒一次；有新回覆時兩道光束一直亮著；出錯就熄燈、往海裡沉一格。
 * 表情只跟著對話狀態走，不跟行情漲跌走（不表達多空立場），也不用紅綠色。
 */

export const SPRITE_WIDTH = 26;
export const SPRITE_HEIGHT = 25;
/** 一格的時間＝--dur-flash */
export const MASCOT_TICK_MS = 125;

/** 燈塔左上角在畫布上的位置（沒有跳、沒有走的時候） */
const BODY_X = 3;
const BODY_Y = 4;
/** 海浪最上面那一列 */
const SEA_TOP = 22;
/** 燈質 Fl W 10s：80 格（10 秒）掃一次光束，左右各 2 格 */
const FLASH_PERIOD = 80;
/** 待機小動作：每 160 格（20 秒）一個，從第 96 格開始，避開光束掃過的時間 */
const ACTION_PERIOD = 160;
const ACTION_START = 96;

/**
 * 燈塔本體（20 欄 × 18 列）：K 外框與條紋、W 塔身、S 塔身暗面、G 燈室玻璃、L 燈。
 * 黑白相間的條紋（像富貴角燈塔），刻意不畫成紅白：紅色在這個網站代表漲。
 */
export const MASCOT_BODY = [
  '.........KK.........',
  '........KKKK........',
  '.......KKKKKK.......',
  '......KKKKKKKK......',
  '.......KGLLGK.......',
  '.......KGLLGK.......',
  '....KKKKKKKKKKKK....',
  '.....KWWWWWWWSK.....',
  '.....KWWWWWWWSK.....',
  '.....KWWWWWWWSK.....',
  '.....KWWWWWWWSK.....',
  '.....KWWWWWWWSK.....',
  '.....KKKKKKKKKK.....',
  '....KKKKKKKKKKKK....',
  '....KWWWWKKWWWSK....',
  '....KWWWWKKWWWSK....',
  '...KKKKKKKKKKKKKK...',
  '.....KK......KK.....',
] as const;

export type MascotMood = 'idle' | 'greet' | 'thinking' | 'done' | 'error';
export type MascotEyes = 'open' | 'blink' | 'happy' | 'up' | 'down' | 'wide';
export type MascotLamp = 'on' | 'dim' | 'off';
export type MascotLook = -1 | 0 | 1;
/** 待機時輪流做的小動作 */
export const IDLE_ACTIONS = ['look', 'patrol', 'spin', 'wave', 'hop'] as const;
export type MascotAction = (typeof IDLE_ACTIONS)[number];

export interface MascotFrame {
  /** 往上跳幾格；負數是往海裡沉 */
  lift: number;
  /** 左右走了幾格 */
  dx: number;
  eyes: MascotEyes;
  /** 眼睛往左（−1）、正中（0）、往右（1）看 */
  look: MascotLook;
  lamp: MascotLamp;
  beamLeft: boolean;
  beamRight: boolean;
  /** 頭頂「…」亮幾點（0–3） */
  dots: number;
  /** 抬起哪一隻腳 */
  foot: 'none' | 'left' | 'right';
  /** 右手：不出現、舉高、放低（揮手時交替） */
  arm: 'none' | 'up' | 'down';
  /** 打瞌睡的 Z 最上面在第幾列（燈塔座標，0 是屋頂那一列、往上飄是負數）；null 是沒有 */
  z: number | null;
  /** 海浪往左流了幾格 */
  sea: number;
}

export interface MascotOptions {
  look?: MascotLook;
  /** 減少動態或使用者按了暫停：每種心情一張靜止的圖 */
  reduced?: boolean;
  /** 太久沒有動靜：待機改成打瞌睡 */
  drowsy?: boolean;
  /** 頁面正在捲動：海浪流得快一點、身體跟著晃 */
  surfing?: boolean;
}

/** 填色：對應 styles/main.css 的 --mascot-* token */
export type MascotPaint = 'line' | 'eye' | 'body' | 'shade' | 'glass' | 'lamp' | 'lampDim' | 'lampOff' | 'sea' | 'water';

export const MASCOT_PAINT_VAR: Record<MascotPaint, string> = {
  line: 'var(--mascot-line)',
  eye: 'var(--mascot-eye)',
  body: 'var(--mascot-body)',
  shade: 'var(--mascot-shade)',
  glass: 'var(--mascot-glass)',
  lamp: 'var(--mascot-lamp)',
  lampDim: 'var(--mascot-lamp-dim)',
  lampOff: 'var(--mascot-lamp-off)',
  sea: 'var(--mascot-sea)',
  water: 'var(--mascot-water)',
};

/** 由下往上畫：後畫的蓋在前面 */
export const MASCOT_PAINT_ORDER: MascotPaint[] = ['water', 'sea', 'body', 'shade', 'glass', 'line', 'lampOff', 'lampDim', 'lamp', 'eye'];

const HOP = [0, 2, 3, 4, 3, 2, 0, 0, 1, 1, 0];
const GREET_TICKS = 16;
const DONE_HOP = [0, 1, 2, 1, 0];
const ACTION_TICKS: Record<MascotAction, number> = { look: 24, patrol: 36, spin: 16, wave: 16, hop: HOP.length };

/** 不規則的眨眼：兩個互質的週期疊在一起，每次閉眼 2 格（250ms） */
export function isBlinking(tick: number): boolean {
  return tick % 43 < 2 || tick % 67 < 2;
}

/** 這一格在做哪個待機小動作、做到第幾格；沒有在做就是 null */
export function idleAction(tick: number): { action: MascotAction; step: number } | null {
  const step = (tick % ACTION_PERIOD) - ACTION_START;
  const action = IDLE_ACTIONS[Math.floor(tick / ACTION_PERIOD) % IDLE_ACTIONS.length];
  return step >= 0 && step < ACTION_TICKS[action] ? { action, step } : null;
}

const LAMP_PAINT: Record<MascotLamp, MascotPaint> = { on: 'lamp', dim: 'lampDim', off: 'lampOff' };

const BASE: MascotFrame = {
  lift: 0, dx: 0, eyes: 'open', look: 0, lamp: 'on', beamLeft: false, beamRight: false, dots: 0, foot: 'none', arm: 'none', z: null, sea: 0,
};

/** 靜止版：每種心情一張圖，靠表情與燈色就看得出狀態 */
const STILL: Record<MascotMood, MascotFrame> = {
  idle: BASE,
  greet: { ...BASE, eyes: 'happy', arm: 'up' },
  thinking: { ...BASE, eyes: 'up', look: 1, dots: 3 },
  done: { ...BASE, beamLeft: true, beamRight: true },
  error: { ...BASE, lift: -1, eyes: 'down', lamp: 'off' },
};

/** 走兩步：往左 3 格、停一下、走回來；走的時候兩腳輪流抬 */
function patrol(step: number): Pick<MascotFrame, 'dx' | 'foot'> {
  const walking = (from: number) => ((step - from) % 6 < 3 ? 'left' : 'right');
  if (step < 9) return { dx: -Math.floor(step / 3), foot: walking(0) };
  if (step < 18) return { dx: -3, foot: 'none' };
  if (step < 27) return { dx: -3 + Math.floor((step - 18) / 3), foot: walking(18) };
  return { dx: 0, foot: 'none' };
}

function idleFrame(tick: number, look: MascotLook, drowsy: boolean, surfing: boolean): MascotFrame {
  const sea = Math.floor(tick / (surfing ? 1 : drowsy ? 4 : 2));
  if (drowsy) {
    // 打瞌睡：閉眼、燈調暗、呼吸變慢，頭頂的 Z 往上飄
    return { ...BASE, lift: Math.floor(tick / 20) % 2, eyes: 'blink', lamp: 'dim', z: -Math.floor((tick % 16) / 4), sea };
  }
  const cycle = tick % FLASH_PERIOD;
  const frame: MascotFrame = {
    ...BASE,
    // 每 1.25 秒（--dur-eclipse）上下一格，像在呼吸；捲動時晃快一點
    lift: Math.floor(tick / (surfing ? 4 : 10)) % 2,
    eyes: isBlinking(tick) ? 'blink' : 'open',
    look,
    // 燈室在轉：光束先往左掃、再往右掃
    beamLeft: cycle < 2,
    beamRight: cycle >= 2 && cycle < 4,
    sea,
  };
  const current = surfing ? null : idleAction(tick);
  if (!current) return frame;
  const { action, step } = current;
  switch (action) {
    case 'look':
      return { ...frame, eyes: 'open', look: step < 8 ? -1 : step < 16 ? 1 : 0 };
    case 'patrol':
      return { ...frame, lift: 0, ...patrol(step) };
    case 'spin':
      return { ...frame, beamLeft: step % 4 < 2, beamRight: step % 4 >= 2 };
    case 'wave':
      return { ...frame, eyes: 'happy', arm: step % 4 < 2 ? 'up' : 'down' };
    case 'hop':
      return { ...frame, lift: HOP[step], eyes: 'happy' };
  }
}

/**
 * 第 tick 格的畫面。since 是換成這個心情時的 tick（打招呼、回答完成的跳躍從那時開始算）；
 * 待機的呼吸、光束與小動作看全域的 tick，畫面上幾隻小燈會同步。
 */
export function mascotFrame(mood: MascotMood, tick: number, since = tick, options: MascotOptions = {}): MascotFrame {
  const { look = 0, reduced = false, drowsy = false, surfing = false } = options;
  if (reduced) return STILL[mood];
  const elapsed = Math.max(0, tick - since);
  const idle = idleFrame(tick, look, drowsy && mood === 'idle', surfing);
  switch (mood) {
    case 'idle':
      return idle;
    case 'greet':
      if (elapsed >= GREET_TICKS) return idle;
      // 被叫到：嚇一跳（眼睛睜大）再跳起來揮手，光束全開
      return {
        ...idle, dx: 0, foot: 'none', z: null, look: 0, lamp: 'on',
        lift: HOP[elapsed] ?? 0,
        eyes: elapsed < 2 ? 'wide' : 'happy',
        arm: elapsed < 2 ? 'none' : elapsed % 4 < 2 ? 'up' : 'down',
        beamLeft: elapsed < 8, beamRight: elapsed < 8,
      };
    case 'thinking':
      return {
        ...BASE,
        eyes: 'up',
        look: 1,
        // Q 急閃：每秒一次（亮 500ms、暗 500ms），和「讀取中」的燈質記號同一個節奏
        lamp: elapsed % 8 < 4 ? 'on' : 'dim',
        dots: Math.floor(elapsed / 3) % 4,
        foot: elapsed % 4 < 2 ? 'left' : 'none',
        sea: idle.sea,
      };
    case 'done':
      // 有新回覆：兩道光束一直亮著（像燈塔在叫你），直到回到待機
      return {
        ...idle, dx: 0, foot: 'none', arm: 'none', z: null, lamp: 'on',
        lift: elapsed < DONE_HOP.length ? DONE_HOP[elapsed] : Math.floor(tick / 10) % 2,
        eyes: elapsed < 8 ? 'happy' : isBlinking(tick) ? 'blink' : 'open',
        beamLeft: true,
        beamRight: true,
      };
    case 'error':
      return { ...BASE, lift: -1, eyes: isBlinking(tick) ? 'blink' : 'down', lamp: 'off', sea: idle.sea };
  }
}

function eyePixels(eyes: MascotEyes, look: MascotLook): Array<[number, number]> {
  if (eyes === 'happy') return [[6, 10], [7, 9], [8, 10], [11, 10], [12, 9], [13, 10]];
  if (eyes === 'blink') return [[6, 10], [7, 10], [8, 10], [11, 10], [12, 10], [13, 10]];
  if (eyes === 'wide') return [[7, 8], [7, 9], [7, 10], [12, 8], [12, 9], [12, 10]];
  const top = eyes === 'up' ? 8 : eyes === 'down' ? 10 : 9;
  return [[7 + look, top], [7 + look, top + 1], [12 + look, top], [12 + look, top + 1]];
}

/** 左側光束（往外張開的楔形）；右側左右鏡射 */
const BEAM_LEFT: Array<[number, number]> = [
  [0, 3], [1, 3], [2, 3],
  [1, 4], [2, 4], [3, 4], [4, 4], [5, 4], [6, 4],
  [1, 5], [2, 5], [3, 5], [4, 5], [5, 5], [6, 5],
  [0, 6], [1, 6], [2, 6],
];
/** 「…」三個點，在燈塔右上方 */
const DOTS: Array<[number, number]> = [[14, 1], [16, 1], [18, 1]];
/** 右手：從塔身右側伸出去 */
const ARM: Record<'up' | 'down', Array<[number, number]>> = {
  up: [[15, 9], [16, 8], [17, 7]],
  down: [[15, 9], [16, 9], [17, 8]],
};
/** 4×4 的 Z（3×3 畫不出斜線，看起來會像 I） */
const Z: Array<[number, number]> = [[0, 0], [1, 0], [2, 0], [3, 0], [2, 1], [1, 2], [0, 3], [1, 3], [2, 3], [3, 3]];

/** 海浪的波形：週期 8 格，每一欄的浪頂在第幾列（從 SEA_TOP 算） */
const WAVE = [2, 1, 0, 0, 0, 1, 2, 2];

/**
 * 這一格每個格子的填色，座標已經加上走路、跳躍的位移，裁在畫布內。key 是 "x,y"。
 */
export function mascotPixels(frame: MascotFrame): Map<string, MascotPaint> {
  const placed = new Map<string, MascotPaint>();
  const put = (x: number, y: number, paint: MascotPaint) => {
    if (x >= 0 && x < SPRITE_WIDTH && y >= 0 && y < SPRITE_HEIGHT) placed.set(`${x},${y}`, paint);
  };
  // 海：浪頂一條線，底下是海水
  for (let x = 0; x < SPRITE_WIDTH; x += 1) {
    const crest = SEA_TOP + WAVE[(((x + frame.sea) % WAVE.length) + WAVE.length) % WAVE.length];
    put(x, crest, 'sea');
    for (let y = crest + 1; y < SPRITE_HEIGHT; y += 1) put(x, y, 'water');
  }

  const left = BODY_X + frame.dx;
  const top = BODY_Y - frame.lift;
  const body = (x: number, y: number, paint: MascotPaint) => put(left + x, top + y, paint);
  const lamp = LAMP_PAINT[frame.lamp];
  MASCOT_BODY.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const paint = ({ K: 'line', W: 'body', S: 'shade', G: 'glass', L: lamp } as const)[row[x] as 'K' | 'W' | 'S' | 'G' | 'L'];
      if (!paint) continue;
      if (y === 17 && ((frame.foot === 'left' && x < 10) || (frame.foot === 'right' && x >= 10))) continue;
      body(x, y, paint);
    }
  });
  for (const [x, y] of eyePixels(frame.eyes, frame.look)) body(x, y, 'eye');
  if (frame.arm !== 'none') for (const [x, y] of ARM[frame.arm]) body(x, y, 'line');
  if (frame.beamLeft) for (const [x, y] of BEAM_LEFT) body(x, y, 'lamp');
  if (frame.beamRight) for (const [x, y] of BEAM_LEFT) body(MASCOT_BODY[0].length - 1 - x, y, 'lamp');
  for (const [x, y] of DOTS.slice(0, frame.dots)) body(x, y, 'line');
  if (frame.z !== null) for (const [x, y] of Z) body(16 + x, frame.z + y, 'line');
  return placed;
}

/** 每種填色一條 path：同一列連續的格子併成一個長方形 */
export function mascotPaths(frame: MascotFrame): Partial<Record<MascotPaint, string>> {
  const rows = new Map<MascotPaint, Map<number, number[]>>();
  for (const [key, paint] of mascotPixels(frame)) {
    const [x, y] = key.split(',').map(Number);
    const byRow = rows.get(paint) ?? new Map<number, number[]>();
    byRow.set(y, [...(byRow.get(y) ?? []), x]);
    rows.set(paint, byRow);
  }
  const paths: Partial<Record<MascotPaint, string>> = {};
  for (const [paint, byRow] of rows) {
    let d = '';
    for (const [y, xs] of [...byRow].sort((a, b) => a[0] - b[0])) {
      xs.sort((a, b) => a - b);
      let start = xs[0];
      let end = start;
      for (const x of [...xs.slice(1), Number.NaN]) {
        if (x === end + 1) {
          end = x;
          continue;
        }
        d += `M${start} ${y}h${end - start + 1}v1h${-(end - start + 1)}z`;
        start = x;
        end = x;
      }
    }
    paths[paint] = d;
  }
  return paths;
}
