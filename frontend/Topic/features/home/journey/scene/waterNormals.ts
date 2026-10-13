import * as THREE from 'three';
import { TAU, mulberry32 } from './noise';
import { forEachStartupRow, throwIfStartupAborted } from './startup';

/** Build the original directional waves without monopolizing the main thread.
 * No texture is allocated until all cancellable work finishes; the caller owns disposal.
 */
export async function waterNormals(N: number, aniso: number, signal?: AbortSignal): Promise<THREE.CanvasTexture> {
  throwIfStartupAborted(signal);
  const rnd = mulberry32(911);
  const waves: { kx: number; ky: number; a: number; ph: number; sharp: boolean }[] = [];
  const wind = 0.6;
  const push = (mag: number, ang: number, sharp: boolean) => {
    const kx = Math.round(Math.cos(ang) * mag);
    const ky = Math.round(Math.sin(ang) * mag);
    if (!kx && !ky) return;
    const k = Math.hypot(kx, ky);
    waves.push({ kx, ky, a: 1 / Math.pow(k, 1.3), ph: rnd() * TAU, sharp });
  };
  // Directional waves: 2–24 periods, approximately ±35 degrees from the wind.
  for (let i = 0; i < 26; i++) push(2 + Math.pow(rnd(), 1.5) * 22, wind + (rnd() - 0.5) * 1.2, true);
  // Small waves: 16–40 periods, in every direction.
  for (let i = 0; i < 20; i++) push(16 + rnd() * 24, rnd() * TAU, false);
  const gx = new Float32Array(N * N);
  const gy = new Float32Array(N * N);
  const su = new Float32Array(N);
  const cu = new Float32Array(N);
  const sv = new Float32Array(N);
  const cv = new Float32Array(N);
  let ax = 0;
  let ay = 0;
  // Treat all wave rows as one queue so short passes share the same time budget.
  await forEachStartupRow(waves.length * N, (waveRow) => {
    const w = waves[Math.floor(waveRow / N)];
    const j = waveRow % N;
    if (j === 0) {
      // Combine sin/cos of each row and column instead of evaluating every pixel.
      for (let i = 0; i < N; i++) {
        const au = (TAU * w.kx * i) / N + w.ph;
        const av = (TAU * w.ky * i) / N;
        su[i] = Math.sin(au);
        cu[i] = Math.cos(au);
        sv[i] = Math.sin(av);
        cv[i] = Math.cos(av);
      }
      ax = w.a * TAU * w.kx;
      ay = w.a * TAU * w.ky;
    }
    const sj = sv[j];
    const cj = cv[j];
    const row = j * N;
    for (let i = 0; i < N; i++) {
      const s = su[i] * cj + cu[i] * sj;
      const c = cu[i] * cj - su[i] * sj;
      // Sharpened waves: h = a(1 + sin theta)^2 / 4.
      const d = w.sharp ? (1 + s) * c * 0.5 : c;
      gx[row + i] += ax * d;
      gy[row + i] += ay * d;
    }
  }, signal);
  let ss = 0;
  await forEachStartupRow(N, (row) => {
    for (let i = row * N; i < (row + 1) * N; i++) ss += gx[i] * gx[i] + gy[i] * gy[i];
  }, signal);
  const k = 0.3 / Math.sqrt(ss / (N * N));
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const x = c.getContext('2d') as CanvasRenderingContext2D;
  const img = x.createImageData(N, N);
  const d = img.data;
  await forEachStartupRow(N, (row) => {
    for (let i = row * N; i < (row + 1) * N; i++) {
      const nx = -gx[i] * k;
      const ny = -gy[i] * k;
      const L = Math.hypot(nx, ny, 1);
      const q = i * 4;
      d[q] = (nx / L) * 127.5 + 127.5;
      d[q + 1] = (ny / L) * 127.5 + 127.5;
      d[q + 2] = (1 / L) * 127.5 + 127.5;
      d[q + 3] = 255;
    }
  }, signal);
  x.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(c);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  // Stronger anisotropy produces dark patches at medium distance.
  texture.anisotropy = Math.min(2, aniso);
  return texture;
}
