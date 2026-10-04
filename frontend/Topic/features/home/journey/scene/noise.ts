/** 場景用的小工具：亂數、Perlin 雜訊、插值（移植自 beacon.html 原型） */

export const TAU = Math.PI * 2;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const sstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** 可重現的亂數（同一個種子每次生出同一座島） */
export function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PERM = new Uint8Array(512);
(() => {
  const p: number[] = [];
  for (let i = 0; i < 256; i++) p[i] = i;
  const r = mulberry32(1337);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
})();

function grad(h: number, x: number, y: number): number {
  switch (h & 7) {
    case 0: return x + y;
    case 1: return -x + y;
    case 2: return x - y;
    case 3: return -x - y;
    case 4: return x;
    case 5: return -x;
    case 6: return y;
    default: return -y;
  }
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

export function noise2(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const X = xi & 255;
  const Y = yi & 255;
  x -= xi;
  y -= yi;
  const u = fade(x);
  const v = fade(y);
  const a = PERM[X] + Y;
  const b = PERM[X + 1] + Y;
  return (
    lerp(
      lerp(grad(PERM[a], x, y), grad(PERM[b], x - 1, y), u),
      lerp(grad(PERM[a + 1], x, y - 1), grad(PERM[b + 1], x - 1, y - 1), u),
      v,
    ) * 0.7
  );
}

export function fbm(x: number, y: number, octaves: number): number {
  let s = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    s += a * noise2(x * f, y * f);
    f *= 2.03;
    a *= 0.5;
  }
  return s;
}

/** 週期為 P 的 Perlin 雜訊（貼圖要能無縫重複） */
export function pnoise2(x: number, y: number, P: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const X0 = ((xi % P) + P) % P;
  const Y0 = ((yi % P) + P) % P;
  const X1 = (X0 + 1) % P;
  const Y1 = (Y0 + 1) % P;
  const u = fade(xf);
  const v = fade(yf);
  const h = (X: number, Y: number) => PERM[PERM[X] + Y];
  return (
    lerp(
      lerp(grad(h(X0, Y0), xf, yf), grad(h(X1, Y0), xf - 1, yf), u),
      lerp(grad(h(X0, Y1), xf, yf - 1), grad(h(X1, Y1), xf - 1, yf - 1), u),
      v,
    ) * 0.7
  );
}
