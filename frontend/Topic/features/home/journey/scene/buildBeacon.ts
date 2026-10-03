/**
 * 燈塔場景（移植自 beacon.html 原型的 start3D，three 0.186）。
 * 命令式建好室外（ext）與觀測室（int）兩個 Scene，BeaconScene 在 useFrame 裡呼叫 render()。
 *
 * 與原型的差異：
 * - 色彩管理：輸出 sRGB、色彩貼圖標 SRGBColorSpace、頂點色先轉線性；光源強度改成物理單位（重新調過）。
 * - 拿掉所有假資料：行情模擬、VIX／情緒／成交值錶頭、跑馬燈報價、五檔、成交明細、熱力圖、開機連線字樣。
 *   牆上看板改成靜態的最近儲存收盤；錶頭板換成一張海圖；日誌只寫跟燈塔有關的中性文字。
 * - 夜班／晨班共用同一個場景，用 dawn（0–1）內插天色、光線與燈的強度。
 */
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TAU, clamp, fbm, lerp, mulberry32, noise2, pnoise2, sstep } from './noise';
import { createKeyframes, evalCamera, layoutKeyframes, portraitCloseCamera, rectInView, type EndCamera } from './cameraPath';
import { LOOKS, NIGHT_EARLY as NIGHT, lookWeights, type SceneLook } from './theme';
import {
  MONO,
  SCREEN_SCALE,
  SERIF,
  createScreenCanvases,
  drawScreens,
  makeCanvas,
  readTokens,
  resizeScreenCanvases,
  type FaceKey,
  type ScreenData,
  type ScreenSizes,
} from './screens';
import { addSurfaceDetail, plasterDetail, roomAoUniforms, stoneDetail, woodDetail, type DetailOptions } from './surface';
import {
  bezelWidth,
  exitRect,
  handoffBezelIn,
  handoffCameraT,
  handoffDeskOut,
  handoffEndIn,
  handoffFlatten,
  handoffLayout,
  handoffLift,
  handoffRoom,
  handoffValue,
  handoffWarmth,
  lerpRect,
  shiftHour,
  terminalColumnRects,
  type MeasuredTerminal,
  type Rect,
} from '../journeyMath';

export interface BeaconOptions {
  /** 手機或低階：水面反射、陰影貼圖、島嶼網格都降解析度 */
  low: boolean;
}

export interface FrameInput {
  /** 秒 */
  time: number;
  dt: number;
  /** 平滑後的捲動進度 0–1 */
  p: number;
  /** 滑鼠視差（-1…1，已平滑）；不支援 hover 的裝置傳 0 */
  mx: number;
  my: number;
  /** 首屏的鏡頭微晃 */
  sway: boolean;
}

export interface BeaconWorld {
  render(input: FrameInput): void;
  /** 依 CSS 尺寸與目前的 pixel ratio 調整 render target、構圖與交接終點的三欄 */
  resize(width: number, height: number): void;
  /** 重畫螢幕（資料或主題變了）；同時讀一次頁面的底色、面板色與分隔線色 */
  setScreens(data: ScreenData, isDark: boolean): void;
  /** 頁面上量到的觀測台三欄（交接終點對齊用）；量不到時是 null（用固定的版面） */
  setHandoff(measured: MeasuredTerminal | null): void;
  /** 套用晨夜混合（0 夜、1 晨） */
  applyLook(dawn: number): void;
  /** 混合停下來後重算環境光貼圖與陰影（不要每格做） */
  settleLook(): void;
  /** 驗證用：三塊畫面（與邊框）目前實際畫在舞台上的矩形（用畫面網格的 matrixWorld 投影，不是內插的數學） */
  probe(): FaceProbe;
  dispose(): void;
}

export interface FaceProbe {
  stage: { w: number; h: number };
  /** 這一格用的交接值 h */
  h: number;
  /** 房間溶成底色的程度 */
  room: number;
  faces: Record<FaceKey, { face: Rect; bezel: Rect; bezelPx: number; deskOpacity: number; ruleOpacity: number } | null>;
}

type Disposable = { dispose(): void };
type Uniforms = Record<string, THREE.IUniform>;

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
/** 海面法線貼圖的縮放（Water 的 size）：越小浪越大 */
const WATER_SIZE = 1.0;
/** 直射光的最低仰角：太陽沉到海平面下時，塔身還是由那一側的天光勾邊 */
const MIN_LIGHT_ELEVATION = 3.5;
/** 室內燈的基準強度（燭光），再乘上各組參數的倍率 */
const BANK_LAMP = 6;
const LAMP_POOL = 1.6;
const PENDANT = 9;
const SCREEN_GLOW = 1.5;
/** 室外環境光貼圖：捲動中最快每 0.25 秒重建一次；時刻差超過這個值才重建 */
const ENV_REBUILD_MS = 250;
const ENV_REBUILD_STEP = 0.04;
/** 往燈塔走時遠景霧氣加濃的倍數（首屏是 1） */
const HAZE_GAIN = 5;
/** 晨光光柱的亮度 */
const SHAFT_GAIN = 1.9;
/** 交接終點：三塊畫面停在鏡頭前多遠（公尺） */
const FACE_END = 0.42;
/** 螢幕機身邊框的寬度（公尺：機身比畫面每邊多 0.011） */
const BEZEL_M = 0.011;
/** 窄螢幕的左右兩塊移出畫面時，離畫面邊緣再多留幾 px（邊框也要整個出去） */
const EXIT_MARGIN = 12;
/**
 * 直式手機交接開始（0.92）時取景的半寬（公尺，量在螢幕的深度）：中間螢幕的寬度約是畫面的八成，左右留一點牆；
 * 交接時再往前推，推到中間螢幕的寬度剛好是報價面板那一欄為止
 */
const PORTRAIT_CLOSE_HALF_W = 0.44;
/** 機身邊框的顏色（sRGB，夜班、晨班）：離開機身的那一圈邊框一開始用這個顏色，疊在機身上看不出來 */
const BEZEL_NIGHT = [0.035, 0.038, 0.045] as const;
const BEZEL_DAWN = [0.16, 0.165, 0.175] as const;
/** 夜班從窗外看進觀測室時，室內畫面多亮幾成；窗口溢出的暖光（燭光） */
const PORTAL_NIGHT_GAIN = 0.7;
const WIN_SPILL = 1.4;
/** 晨班的地板、桌面（胡桃木）的亮度倍率 */
const DAWN_FLOOR = 0.62;
const DAWN_DESK = 0.7;

export function createBeacon(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, { low }: BeaconOptions): BeaconWorld {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;

  const disposables = new Set<Disposable>();
  const keep = <T extends Disposable>(o: T): T => {
    disposables.add(o);
    return o;
  };
  const ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const HEADLAND_LAYER = 1;
  camera.layers.enable(HEADLAND_LAYER);
  const ext = new THREE.Scene();
  const int = new THREE.Scene();
  const std = (o: THREE.MeshStandardMaterialParameters) => keep(new THREE.MeshStandardMaterial(o));
  /** canvas 貼圖：色彩貼圖標 sRGB，凹凸貼圖是資料，不轉色彩空間 */
  const tex = (c: HTMLCanvasElement, rep?: [number, number], color = true) => {
    const t = keep(new THREE.CanvasTexture(c));
    t.anisotropy = ANISO;
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    if (rep) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(rep[0], rep[1]);
    }
    return t;
  };
  const ctx2d = (c: HTMLCanvasElement) => c.getContext('2d') as CanvasRenderingContext2D;
  // 近距離的細節（灰泥、木紋、石材）：三向投影，不吃模型的 UV
  const DET = low ? 256 : 512;
  const plasterDet = keep(plasterDetail(DET, ANISO));
  const woodDet = keep(woodDetail(DET, ANISO));
  const stoneDet = keep(stoneDetail(DET, ANISO));
  const detail = (m: THREE.MeshStandardMaterial, o: Omit<DetailOptions, 'map'> & { map?: THREE.Texture }) => addSurfaceDetail(m, { map: plasterDet, ...o });
  /** 頁面上量到的觀測台三欄（BeaconJourney 量好傳進來；沒有就用固定的版面） */
  let measured: MeasuredTerminal | null = null;
  /**
   * 螢幕 canvas 的尺寸（canvas = CSS px × SCREEN_SCALE；resize 時重算）：
   * 終點畫面是交接終點那一欄的大小（右欄只有升起的那一格面板）；桌上畫面同寬、16:9。
   */
  function sizesFor(width: number, height: number): ScreenSizes {
    const L = handoffLayout(width, height, measured);
    const colH = Math.max(160, L.bottom - L.top);
    const widthOf = (span: [number, number] | null, fallbackW: number) => clamp(span ? span[1] - span[0] : fallbackW, 200, 1000);
    const dim = (w: number, h: number): [number, number] => [Math.round(w * SCREEN_SCALE), Math.round(clamp(h, 120, 1000) * SCREEN_SCALE)];
    const desk = (w: number): [number, number] => [Math.round(w * SCREEN_SCALE), Math.round(((w * 9) / 16) * SCREEN_SCALE)];
    const cw = widthOf(L.center, 616);
    const lw = widthOf(L.left, 300);
    const rw = widthOf(L.right, 320);
    return {
      end: { center: dim(cw, colH), left: dim(lw, colH), right: dim(rw, Math.max(120, L.rightBottom - L.top)) },
      desk: { center: desk(cw), left: desk(lw), right: desk(rw) },
    };
  }
  const screenSizes = sizesFor(1440, 843);
  const linColor = new THREE.Color();
  /** 原型的頂點色是 sRGB 數值，three 0.186 當成線性，所以先轉換 */
  const toLinear = (r: number, g: number, b: number) => linColor.setRGB(clamp(r, 0, 1), clamp(g, 0, 1), clamp(b, 0, 1), THREE.SRGBColorSpace);

  /* ---------- 程序貼圖 ---------- */
  function noiseCanvas(size: number, base: number, oct: number, seed: number) {
    const c = makeCanvas(size, size);
    const x = ctx2d(c);
    const img = x.createImageData(size, size);
    const d = img.data;
    for (let j = 0; j < size; j++)
      for (let i = 0; i < size; i++) {
        let s = 0;
        let a = 0.5;
        let P = base;
        for (let o = 0; o < oct; o++) {
          s += a * pnoise2((i / size) * P + seed, (j / size) * P + seed * 0.61, P);
          a *= 0.5;
          P *= 2;
        }
        const v = clamp(128 + s * 190, 0, 255);
        const k = (j * size + i) * 4;
        d[k] = d[k + 1] = d[k + 2] = v;
        d[k + 3] = 255;
      }
    x.putImageData(img, 0, 0);
    return c;
  }
  const NZ = noiseCanvas(256, 4, 5, 3);
  const NZF = noiseCanvas(256, 16, 3, 9);
  function overlayNoise(
    x: CanvasRenderingContext2D,
    W: number,
    H: number,
    n: HTMLCanvasElement,
    alpha: number,
    sx: number,
    sy: number,
    mode: GlobalCompositeOperation = 'overlay',
  ) {
    x.save();
    x.globalCompositeOperation = mode;
    x.globalAlpha = alpha;
    x.scale(sx, sy);
    const pat = x.createPattern(n, 'repeat');
    if (pat) {
      x.fillStyle = pat;
      x.fillRect(0, 0, W / sx, H / sy);
    }
    x.restore();
  }
  /**
   * 海面的法線貼圖：一組有方向的浪（風從同一側來，波峰比波谷尖）加上四面八方的細碎小浪。
   * 波數都是整數，貼圖才能無縫重複；法線用解析的導數算（不是相鄰像素相減，所以高頻的浪也不會糊）。
   * 原本的等向 Perlin 在中距離會被各向同性的 mipmap 抹平成一條條反光，看起來像拉長的污漬而不是水。
   */
  function waterNormals(N: number) {
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
    // 主浪：2–24 個週期、偏離風向 ±35°
    for (let i = 0; i < 26; i++) push(2 + Math.pow(rnd(), 1.5) * 22, wind + (rnd() - 0.5) * 1.2, true);
    // 碎浪：16–40 個週期、任意方向
    for (let i = 0; i < 20; i++) push(16 + rnd() * 24, rnd() * TAU, false);
    const gx = new Float32Array(N * N);
    const gy = new Float32Array(N * N);
    const su = new Float32Array(N);
    const cu = new Float32Array(N);
    const sv = new Float32Array(N);
    const cv = new Float32Array(N);
    for (const w of waves) {
      // sin(θu + θv) = sin θu cos θv + cos θu sin θv：先算一列一行，再逐點組合
      for (let i = 0; i < N; i++) {
        const au = (TAU * w.kx * i) / N + w.ph;
        const av = (TAU * w.ky * i) / N;
        su[i] = Math.sin(au);
        cu[i] = Math.cos(au);
        sv[i] = Math.sin(av);
        cv[i] = Math.cos(av);
      }
      const ax = w.a * TAU * w.kx;
      const ay = w.a * TAU * w.ky;
      for (let j = 0; j < N; j++) {
        const sj = sv[j];
        const cj = cv[j];
        const row = j * N;
        for (let i = 0; i < N; i++) {
          const s = su[i] * cj + cu[i] * sj;
          const c = cu[i] * cj - su[i] * sj;
          // 尖峰的浪：h = a(1 + sin θ)² / 4，導數 a(1 + sin θ)cos θ / 2
          const d = w.sharp ? (1 + s) * c * 0.5 : c;
          gx[row + i] += ax * d;
          gy[row + i] += ay * d;
        }
      }
    }
    // 依斜率的均方根決定強度：平均坡度約 0.3
    let ss = 0;
    for (let i = 0; i < N * N; i++) ss += gx[i] * gx[i] + gy[i] * gy[i];
    const k = 0.3 / Math.sqrt(ss / (N * N));
    const c = makeCanvas(N, N);
    const x = ctx2d(c);
    const img = x.createImageData(N, N);
    const d = img.data;
    for (let i = 0; i < N * N; i++) {
      const nx = -gx[i] * k;
      const ny = -gy[i] * k;
      const L = Math.hypot(nx, ny, 1);
      const q = i * 4;
      d[q] = (nx / L) * 127.5 + 127.5;
      d[q + 1] = (ny / L) * 127.5 + 127.5;
      d[q + 2] = (1 / L) * 127.5 + 127.5;
      d[q + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    const t = keep(new THREE.CanvasTexture(c));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    // 掠射角看海面時，沒有各向異性過濾的 mipmap 會把浪抹平成一條條反光；開到 8 以上中距離反而碎成一格格的暗斑
    t.anisotropy = Math.min(2, renderer.capabilities.getMaxAnisotropy());
    return t;
  }
  function glowTex() {
    const c = makeCanvas(128, 128);
    const x = ctx2d(c);
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.15, 'rgba(255,255,255,0.6)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.14)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    return tex(c);
  }
  const R = mulberry32(77);

  /* ---------- 幾何常數 ---------- */
  const TOWER = { y0: 6.0, y1: 33.0, rb: 5.0, rt: 3.35 };
  const towerR = (y: number) => {
    const s = clamp((y - TOWER.y0) / (TOWER.y1 - TOWER.y0), 0, 1);
    return TOWER.rt + (TOWER.rb - TOWER.rt) * Math.pow(1 - s, 1.6);
  };
  const FL = 29.4;
  const CE = 32.8;
  const RR = 3.0;
  const WIN = { y: 31.1, w: 1.0, h: 1.7, bot: 31.1 - 0.85, top: 31.1 + 0.85 };
  const PORTAL_Z = towerR(WIN.y) + 0.035;
  const LAMP_Y = 35.55;
  const HOUSE = { x: -10.5, z: 4.6, rot: -0.32 };
  const ISLETS = [
    { x: 33, z: -15, r: 5.5, h: 4.2 },
    { x: -29, z: 21, r: 3.4, h: 2.2 },
    { x: 15, z: 34, r: 2.8, h: 1.6 },
    { x: -7, z: -36, r: 3.0, h: 2.8 },
  ];
  const DOOR_A = Math.atan2(HOUSE.x, HOUSE.z);
  function islandH(x: number, z: number) {
    const r = Math.hypot(x, z);
    const w = fbm(x * 0.021 + 11.3, z * 0.021 - 4.1, 3);
    const Rr = 25 * (1 + 0.55 * w);
    const d = r / Rr;
    const top = 6.0 + 1.1 * fbm(x * 0.06 + 3.3, z * 0.06 + 9.1, 3) * sstep(7, 15, r);
    let h: number;
    if (d < 0.6) h = top;
    else if (d < 1.0) {
      const s = (d - 0.6) / 0.4;
      h = top * Math.pow(1 - s, 0.75);
    } else h = -7 * sstep(1.0, 1.55, d);
    const cl = sstep(0.45, 0.75, d) * (1 - sstep(1.0, 1.25, d));
    const rn = 1 - Math.abs(noise2(x * 0.13 + 7.7, z * 0.13 - 2.2));
    h += cl * (rn * rn * 2.6 - 0.9) + cl * 0.9 * fbm(x * 0.35, z * 0.35, 3);
    h = lerp(6.0, h, sstep(4.8, 7.8, Math.hypot(x - HOUSE.x, z - HOUSE.z)));
    h = lerp(6.0, h, sstep(6.5, 9.5, r));
    for (const I of ISLETS) {
      const q = Math.hypot(x - I.x, z - I.z) / I.r;
      if (q < 1.7) {
        const n = 0.75 + 0.5 * noise2(x * 0.4 + I.x, z * 0.4);
        h = Math.max(h, I.h * (1 - q * q) * n - (q > 1 ? (q - 1) * 6 : 0));
      }
    }
    return h;
  }

  /* ---------- 天空、太陽、海 ---------- */
  const SUN = V3();
  const setSun = (look: Pick<SceneLook, 'sunElevation' | 'sunAzimuth'>) =>
    SUN.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - look.sunElevation), THREE.MathUtils.degToRad(look.sunAzimuth));
  setSun(NIGHT);
  const sky = new Sky();
  sky.scale.setScalar(10000);
  const su = sky.material.uniforms as Uniforms;
  su.turbidity.value = NIGHT.turbidity;
  su.rayleigh.value = NIGHT.rayleigh;
  su.mieCoefficient.value = NIGHT.mie;
  su.mieDirectionalG.value = NIGHT.mieG;
  su.sunPosition.value.copy(SUN);
  // three 0.186 的 Sky 自帶雲；這裡用原型自己的雲層，所以關掉
  if (su.cloudCoverage) su.cloudCoverage.value = 0;
  // 暮光：太陽沉到海平面下時，Preetham 天空背日側會整片發黑；在 tone mapping 前補上地平線的藍、天頂的深藍與金星帶。
  // 寫進天空本身，所以環境光貼圖、水面倒影、岬角取樣的地平線色都會一起帶到
  const twilight: Uniforms = {
    uGlowLow: { value: new THREE.Vector3(...NIGHT.skyGlowLow) },
    uGlowHigh: { value: new THREE.Vector3(...NIGHT.skyGlowHigh) },
    uBelt: { value: new THREE.Vector3(...NIGHT.skyBelt) },
  };
  sky.material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, twilight);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform vec3 uGlowLow;\nuniform vec3 uGlowHigh;\nuniform vec3 uBelt;\nvoid main() {')
      .replace(
        'vec3 texColor = ( Lin + L0 ) * 0.04',
        `float twY = max( direction.y, 0.0 );
			float twAnti = 0.5 - 0.5 * dot( normalize( direction.xz + 1e-5 ), normalize( vSunDirection.xz + 1e-5 ) );
			vec3 twilight = mix( uGlowLow, uGlowHigh, smoothstep( 0.0, 0.45, twY ) ) + uBelt * twAnti * exp( -pow( ( twY - 0.07 ) / 0.06, 2.0 ) );
			vec3 texColor = twilight + ( Lin + L0 ) * 0.04`,
      );
  };
  ext.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let extEnv: THREE.WebGLRenderTarget | null = null;
  function rebuildSkyEnv() {
    const envScene = new THREE.Scene();
    envScene.add(sky);
    const rt = pmrem.fromScene(envScene);
    ext.add(sky);
    extEnv?.dispose();
    extEnv = rt;
    ext.environment = rt.texture;
  }
  const roomEnv = new RoomEnvironment();
  const intEnv = pmrem.fromScene(roomEnv, 0.04);
  roomEnv.dispose();
  int.environment = intEnv.texture;
  const fog = new THREE.FogExp2(NIGHT.fog, NIGHT.fogDensity);
  ext.fog = fog;

  const sunLight = new THREE.DirectionalLight(NIGHT.sunColor, NIGHT.sunIntensity);
  sunLight.target.position.set(0, 8, 0);
  sunLight.castShadow = true;
  Object.assign(sunLight.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48, near: 1, far: 420 });
  sunLight.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
  sunLight.shadow.bias = -0.0006;
  sunLight.shadow.normalBias = 0.05;
  ext.add(sunLight, sunLight.target);
  const hemi = new THREE.HemisphereLight(NIGHT.hemiSky, NIGHT.hemiGround, NIGHT.hemiIntensity);
  ext.add(hemi);
  // 天光補光：從鏡頭左前方、背對太陽的那一側打一道冷光，白色塔身才有由亮到暗的圓柱體積（太陽在塔後方，只勾出右側的輪廓）
  const fill = new THREE.DirectionalLight(NIGHT.fillColor, NIGHT.fillIntensity);
  fill.position.set(-96, 52, 30);
  fill.target.position.set(0, 18, 0);
  ext.add(fill, fill.target);

  // 倒影的解析度：桌機 1024（512 時中距離的倒影會糊成一片），手機 512
  const water = new Water(new THREE.PlaneGeometry(40000, 40000), {
    textureWidth: low ? 512 : 1024,
    textureHeight: low ? 512 : 1024,
    waterNormals: waterNormals(low ? 256 : 512),
    sunDirection: SUN.clone(),
    sunColor: NIGHT.waterSun,
    waterColor: NIGHT.waterColor,
    distortionScale: 3.2,
    fog: false,
  });
  water.rotation.x = -Math.PI / 2;
  // 菲涅耳項用的法線隨距離變平：中距離的浪面仍然扭曲倒影（看得出水在動），
  // 但不會因為每一小片浪的朝向而在「整片倒影」和「深色海水」之間跳來跳去，碎成一格格的暗斑
  // 另外兩件事：
  // - 近處（俯看窗下、首屏前景）加兩層細浪，依畫面上一個像素涵蓋多少海面淡入淡出：法線貼圖一格約 0.2 公尺，
  //   鏡頭靠近時原本只看得到放大的一格格斑塊；遠處則把浪的斜率收小，不會被 mipmap 抹成拉長的條紋。
  // - 遠景的霧氣：顏色是岬角取樣的地平線天色（跟天空接得起來），濃度跟著旅程往前加，首屏不變。
  const waterHaze: Uniforms = { uHazeColor: { value: new THREE.Color(0, 0, 0) }, uHazeDensity: { value: 0 }, uCalm: { value: 0 } };
  water.material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, waterHaze);
    shader.fragmentShader = shader.fragmentShader
      .replace('uniform vec3 waterColor;', 'uniform vec3 waterColor;\nuniform vec3 uHazeColor;\nuniform float uHazeDensity;\nuniform float uCalm;')
      .replace(
        'vec4 noise = getNoise( worldPosition.xz * size );',
        `vec2 wuv = worldPosition.xz * size;
					vec4 noise = getNoise( wuv );
					float wfp = length( fwidth( wuv ) );
					float fineK = 1.0 - smoothstep( 0.03, 0.2, wfp );
					vec2 fine = texture2D( normalSampler, wuv / 13.0 + vec2( time / 9.0, time / 13.0 ) ).xy + texture2D( normalSampler, wuv / 5.3 - vec2( time / 7.0, - time / 8.3 ) ).xy - 1.0;
					noise.xy += fine * 0.85 * fineK;
					noise.xy *= 1.0 - mix( 0.5 * smoothstep( 0.35, 4.0, wfp ), 0.4 + 0.45 * smoothstep( 0.07, 1.1, wfp ), uCalm );`,
      )
      .replace(
        'vec2 distortion = surfaceNormal.xz * ( 0.001 + 1.0 / distance ) * distortionScale;',
        'vec2 distortion = surfaceNormal.xz * ( 0.001 + 1.0 / distance ) * distortionScale * mix( 1.0, mix( 0.3, 0.2, uCalm ), smoothstep( mix( 0.12, 0.05, uCalm ), mix( 1.2, 0.6, uCalm ), wfp ) );',
      )
      .replace(
        'float theta = max( dot( eyeDirection, surfaceNormal ), 0.0 );',
        'vec3 fresnelNormal = normalize( mix( surfaceNormal, vec3( 0.0, 1.0, 0.0 ), smoothstep( 40.0, 360.0, distance ) * 0.7 ) );\n\t\t\t\t\tfloat theta = max( dot( eyeDirection, fresnelNormal ), 0.0 );',
      )
      .replace(
        'vec3 outgoingLight = albedo;',
        'vec3 outgoingLight = albedo;\n\t\t\t\t\tfloat hz = 1.0 - exp( - pow( uHazeDensity * distance, 2.0 ) );\n\t\t\t\t\toutgoingLight = mix( outgoingLight, uHazeColor, clamp( hz, 0.0, 0.8 ) );',
      );
  };
  const wu = water.material.uniforms as Uniforms;
  wu.size.value = WATER_SIZE;
  ext.add(water);

  // 雲層
  const cloudMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uSun: { value: SUN.clone() },
      uCam: { value: V3() },
      uLit: { value: new THREE.Vector3(...NIGHT.cloudLit) },
      uShade: { value: new THREE.Vector3(...NIGHT.cloudShade) },
      uHor: { value: new THREE.Vector3(...NIGHT.cloudHorizon) },
      uSunC: { value: new THREE.Vector3(...NIGHT.cloudSun) },
    },
    vertexShader: /* glsl */ `varying vec3 vW;void main(){vec4 w=modelMatrix*vec4(position,1.0);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
    fragmentShader: /* glsl */ `uniform float uTime;uniform vec3 uSun;uniform vec3 uCam;uniform vec3 uLit;uniform vec3 uShade;uniform vec3 uHor;uniform vec3 uSunC;varying vec3 vW;
      float h(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
      float n(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.0-2.0*f);return mix(mix(h(i),h(i+vec2(1,0)),u.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),u.x),u.y);}
      float fb(vec2 p){float s=0.0,a=0.5;mat2 m=mat2(1.6,1.2,-1.2,1.6);for(int i=0;i<5;i++){s+=a*n(p);p=m*p;a*=0.5;}return s;}
      void main(){
        vec2 q=vW.xz*vec2(0.00032,0.00085)+vec2(uTime*0.0035,uTime*0.001);
        float d0=fb(q+0.55*fb(q*1.8+3.1));
        float dens=smoothstep(0.50,0.80,d0);
        vec2 sq=q+normalize(uSun.xz)*0.05;
        float d1=fb(sq+0.55*fb(sq*1.8+3.1));
        float sh=clamp((d1-d0)*4.0+0.45,0.0,1.0);
        vec3 V=normalize(vW-uCam);
        float fw=pow(max(dot(V,normalize(uSun)),0.0),5.0);
        float hor=1.0-smoothstep(0.02,0.35,V.y);
        vec3 col=mix(uLit,uShade,sh*0.9);
        col=mix(col,uHor,hor*0.5)+uSunC*fw*(1.0-dens*0.5);
        float dist=length(vW.xz-uCam.xz);
        float a=dens*(1.0-smoothstep(9000.0,24000.0,dist))*0.92;
        gl_FragColor=vec4(col,a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const cu = cloudMat.uniforms as Uniforms;
  const clouds = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), cloudMat);
  clouds.rotation.x = Math.PI / 2;
  clouds.position.y = 1500;
  ext.add(clouds);

  // 遠方岬角：兩三層山脊，越遠、越低（海霧）越接近背後的天色（空氣透視）。
  // 顏色不是寫死的：建場景時從天空本身取樣地平線的顏色（夜班、晨班各一次），山的暗部也從同一個顏色推，
  // 所以在兩個班都像是融在天光裡，不會是一塊平塗的紫色多邊形。
  const HEADLANDS = [
    { az: 212, dist: 4200, len: 5600, peak: 230, seed: 1.7, layer: 0.15, sx: 1, sy: 1 },
    { az: 224, dist: 6800, len: 9000, peak: 420, seed: 5.3, layer: 0.62, sx: 1, sy: 1 },
    { az: 252, dist: 5200, len: 5600, peak: 230, seed: 9.1, layer: 0.35, sx: 0.8, sy: 0.6 },
  ];
  const headlandUniforms: Uniforms = {
    uSky: { value: new THREE.Color(0.08, 0.06, 0.06) },
  };
  const headlandMat = new THREE.ShaderMaterial({
    uniforms: headlandUniforms,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `attribute float aLayer;attribute float aPeak;varying float vLayer;varying float vH;varying vec2 vP;
      void main(){vLayer=aLayer;vH=clamp(position.y/aPeak,0.0,1.0);vP=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    // uSky 是地平線天色（線性、未經 tone mapping）；山色＝天色壓暗並偏冷，再依遠近與高度混回天色
    fragmentShader: /* glsl */ `uniform vec3 uSky;varying float vLayer;varying float vH;varying vec2 vP;
      float h1(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
      float vn(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.0-2.0*f);return mix(mix(h1(i),h1(i+vec2(1,0)),u.x),mix(h1(i+vec2(0,1)),h1(i+vec2(1,1)),u.x),u.y);}
      void main(){
        vec3 land=uSky*vec3(0.30,0.34,0.42);
        float gully=vn(vec2(vP.x*0.012,vP.y*0.004))*0.6+vn(vec2(vP.x*0.05,vP.y*0.02))*0.4;
        float haze=mix(0.4,0.76,vLayer)+0.3*pow(1.0-vH,3.0);
        haze=clamp(haze+(gully-0.5)*0.12*vH,0.0,1.0);
        gl_FragColor=vec4(mix(land,uSky,haze),1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  (() => {
    const N = 420;
    for (const H of HEADLANDS) {
      const pos: number[] = [];
      const layer: number[] = [];
      const peak: number[] = [];
      const idx: number[] = [];
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const x = (t - 0.5) * H.len;
        // 兩端緩緩沒入海裡（不是拉成一條細長的楔形）；中段是起伏的山脊加上細碎的稜線
        const env = sstep(0.0, 0.3, t) * (1 - sstep(0.62, 1.0, t));
        const body = 0.62 + 0.5 * fbm(t * 2.6 + H.seed, H.seed * 0.7, 3);
        const ridge = 0.16 * (1 - Math.abs(noise2(t * 11 + H.seed, 3.7)));
        const crag = 0.1 * fbm(t * 60 + H.seed * 3, 1.3, 5) + 0.05 * Math.abs(noise2(t * 140 + H.seed, 0.4));
        const y = H.peak * env * (body + ridge + crag) - 18;
        pos.push(x, -40, 0, x, y, 0);
        layer.push(H.layer, H.layer);
        peak.push(H.peak, H.peak);
        if (i < N) {
          const a = i * 2;
          idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('aLayer', new THREE.Float32BufferAttribute(layer, 1));
      g.setAttribute('aPeak', new THREE.Float32BufferAttribute(peak, 1));
      g.setIndex(idx);
      const m = new THREE.Mesh(g, headlandMat);
      const az = THREE.MathUtils.degToRad(H.az);
      m.position.set(Math.sin(az) * H.dist, 0, Math.cos(az) * H.dist);
      m.rotation.y = az;
      m.scale.set(H.sx, H.sy, 1);
      // 放在第 1 層：主鏡頭看得到，水面的鏡像鏡頭（只看第 0 層）不畫它——遠山在起伏的海面上不留一塊硬邊的倒影
      m.layers.set(HEADLAND_LAYER);
      ext.add(m);
    }
  })();
  // 地平線天色取樣：從岬角的方向看天空，畫進一張小 render target 再讀回來（線性 HDR 值，跟 tone mapping 前的天空一致）
  // 四組天色（夜班早／晚、晨班早／晚）各取一次，之後依權重內插
  const horizonSky = [
    new THREE.Color(0.08, 0.06, 0.06),
    new THREE.Color(0.03, 0.03, 0.05),
    new THREE.Color(0.3, 0.32, 0.4),
    new THREE.Color(0.5, 0.55, 0.62),
  ];
  function sampleHorizon(out: THREE.Color) {
    const size = 4;
    const rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.HalfFloatType });
    const cam = new THREE.PerspectiveCamera(3, 1, 1, 20000);
    const scene = new THREE.Scene();
    scene.add(sky);
    try {
      const az = THREE.MathUtils.degToRad(214);
      cam.position.set(0, 10, 0);
      cam.lookAt(Math.sin(az) * 1000, 10 + Math.tan(THREE.MathUtils.degToRad(1.2)) * 1000, Math.cos(az) * 1000);
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
      const buf = new Uint16Array(size * size * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf);
      let r = 0;
      let gg = 0;
      let b = 0;
      for (let i = 0; i < size * size; i++) {
        r += THREE.DataUtils.fromHalfFloat(buf[i * 4]);
        gg += THREE.DataUtils.fromHalfFloat(buf[i * 4 + 1]);
        b += THREE.DataUtils.fromHalfFloat(buf[i * 4 + 2]);
      }
      const n = size * size;
      if (Number.isFinite(r + gg + b) && r + gg + b > 0) out.setRGB(r / n, gg / n, b / n);
    } catch {
      // 讀不回來（例如不支援半精度浮點的讀取）：保留預設值
    } finally {
      renderer.setRenderTarget(null);
      ext.add(sky);
      rt.dispose();
    }
  }
  const glowT = glowTex();
  const ship = new THREE.Group();
  const shipLights = new THREE.SpriteMaterial({
    map: glowT,
    color: 0xfff1d0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    toneMapped: false,
  });
  const SHIP_AZ = THREE.MathUtils.degToRad(141);
  const shipBase = V3(Math.sin(SHIP_AZ) * 1500, 0, Math.cos(SHIP_AZ) * 1500);
  (() => {
    const dk = std({ color: 0x191c20, roughness: 0.85 });
    const hull = new THREE.Mesh(new THREE.BoxGeometry(92, 7, 14), dk);
    hull.position.y = 2.5;
    ship.add(hull);
    const cols = [0x5b3a31, 0x2f4a58, 0x6b5a3b, 0x3e4a3a];
    for (let i = 0; i < 8; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(8, 5 + R() * 3, 12), std({ color: cols[i % 4], roughness: 0.9 }));
      b.position.set(-22 + i * 8.6, 8, 0);
      ship.add(b);
    }
    const br = new THREE.Mesh(new THREE.BoxGeometry(12, 13, 14), dk);
    br.position.set(38, 12, 0);
    ship.add(br);
    const fn = new THREE.Mesh(new THREE.BoxGeometry(4, 7, 4), dk);
    fn.position.set(41, 22, 0);
    ship.add(fn);
    (
      [
        [38, 26, 0, 6],
        [-44, 11, 0, 4],
        [20, 11, 0, 3.2],
      ] as const
    ).forEach(([x, y, z, sz]) => {
      const s = new THREE.Sprite(shipLights);
      s.position.set(x, y, z);
      s.scale.setScalar(sz);
      ship.add(s);
    });
    ship.position.copy(shipBase);
    ship.rotation.y = SHIP_AZ + Math.PI / 2 + 0.25;
    ext.add(ship);
  })();
  const shipDir = V3(1, 0, 0);

  /* ---------- 島 ---------- */
  const rockBump = tex(NZF, [34, 34], false);
  const foamUniforms: Uniforms = { uH: { value: null }, uTime: { value: 0 } };
  (() => {
    const size = 130;
    const seg = low ? 170 : 250;
    const g = new THREE.PlaneGeometry(size, size, seg, seg);
    g.rotateX(-Math.PI / 2);
    const P = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < P.count; i++) P.setY(i, islandH(P.getX(i), P.getZ(i)));
    g.computeVertexNormals();
    const N = g.attributes.normal as THREE.BufferAttribute;
    const cols = new Float32Array(P.count * 3);
    const dA = V3(Math.sin(DOOR_A) * towerR(6.5), 0, Math.cos(DOOR_A) * towerR(6.5));
    const hFront = V3(
      HOUSE.x + Math.sin(HOUSE.rot) * 2.6 - 0.7 * Math.cos(HOUSE.rot),
      0,
      HOUSE.z + Math.cos(HOUSE.rot) * 2.6 + 0.7 * Math.sin(HOUSE.rot),
    );
    const seg2 = (x: number, z: number) => {
      const ax = hFront.x - dA.x;
      const az = hFront.z - dA.z;
      const t = clamp(((x - dA.x) * ax + (z - dA.z) * az) / (ax * ax + az * az), 0, 1);
      return Math.hypot(x - dA.x - ax * t, z - dA.z - az * t);
    };
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i);
      const y = P.getY(i);
      const z = P.getZ(i);
      const ny = N.getY(i);
      const n1 = noise2(x * 0.08, z * 0.08);
      const n2 = noise2(x * 0.5 + 5, z * 0.5 - 3);
      const n3 = noise2(x * 1.7, z * 1.7);
      let r = lerp(0.4, 0.25, n1 * 0.5 + 0.5) + n3 * 0.03;
      let gg = lerp(0.37, 0.235, n1 * 0.5 + 0.5) + n3 * 0.03;
      let b = lerp(0.33, 0.215, n1 * 0.5 + 0.5) + n3 * 0.025;
      const wet = 1 - sstep(-0.3, 1.2, y);
      r = lerp(r, 0.075, wet * 0.88);
      gg = lerp(gg, 0.078, wet * 0.88);
      b = lerp(b, 0.07, wet * 0.88);
      const alg = sstep(-0.4, 0.2, y) * (1 - sstep(0.2, 0.8, y));
      r = lerp(r, 0.13, alg * 0.6);
      gg = lerp(gg, 0.14, alg * 0.6);
      b = lerp(b, 0.08, alg * 0.6);
      const gt = sstep(0.8, 0.93, ny) * sstep(2.2, 3.6, y);
      const dry = sstep(-0.35, 0.55, n1 + n2 * 0.35);
      const gr = lerp(0.2, 0.4, dry) + n3 * 0.03;
      const gG = lerp(0.27, 0.37, dry) + n3 * 0.03;
      const gB = lerp(0.1, 0.19, dry);
      r = lerp(r, gr, gt);
      gg = lerp(gg, gG, gt);
      b = lerp(b, gB, gt);
      const pth = 1 - sstep(0.5, 1.1, seg2(x, z) + n3 * 0.2);
      r = lerp(r, 0.44, pth * gt);
      gg = lerp(gg, 0.38, pth * gt);
      b = lerp(b, 0.29, pth * gt);
      const ao = 0.82 + 0.18 * sstep(-0.6, 0.6, n2);
      const c = toLinear(r * ao, gg * ao, b * ao);
      cols[i * 3] = c.r;
      cols[i * 3 + 1] = c.g;
      cols[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const m = new THREE.Mesh(
      g,
      std({ vertexColors: true, roughness: 0.94, metalness: 0, bumpMap: rockBump, bumpScale: 1.0, envMapIntensity: 0.55 }),
    );
    m.receiveShadow = true;
    m.castShadow = true;
    ext.add(m);
    // 浪花遮罩（依島的高度）
    const FN = 256;
    const fd = new Uint8Array(FN * FN * 4);
    for (let j = 0; j < FN; j++)
      for (let i = 0; i < FN; i++) {
        const x = (i / (FN - 1) - 0.5) * size;
        const z = (j / (FN - 1) - 0.5) * size;
        const h = clamp(islandH(x, z), -10, 10);
        const v = Math.round(((h + 10) / 20) * 255);
        const k = (j * FN + i) * 4;
        fd[k] = fd[k + 1] = fd[k + 2] = v;
        fd[k + 3] = 255;
      }
    const ft = keep(new THREE.DataTexture(fd, FN, FN, THREE.RGBAFormat));
    ft.magFilter = ft.minFilter = THREE.LinearFilter;
    ft.needsUpdate = true;
    foamUniforms.uH.value = ft;
    const foamMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      uniforms: foamUniforms,
      vertexShader: /* glsl */ `varying vec2 vUv;varying vec3 vW;void main(){vUv=uv;vec4 w=modelMatrix*vec4(position,1.0);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
      fragmentShader: /* glsl */ `uniform sampler2D uH;uniform float uTime;varying vec2 vUv;varying vec3 vW;
        float h1(vec2 p){p=fract(p*vec2(233.34,851.73));p+=dot(p,p+23.45);return fract(p.x*p.y);}
        float vn(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.0-2.0*f);return mix(mix(h1(i),h1(i+vec2(1,0)),u.x),mix(h1(i+vec2(0,1)),h1(i+vec2(1,1)),u.x),u.y);}
        void main(){
          float h=texture2D(uH,vec2(vUv.x,1.0-vUv.y)).r*20.0-10.0;
          if(h>0.3)discard;
          float shore=1.0-smoothstep(0.0,1.8,-h);
          float nn=vn(vW.xz*0.9+vec2(uTime*0.25,uTime*0.18))*0.6+vn(vW.xz*2.6-uTime*0.35)*0.4;
          float band=0.5+0.5*sin(uTime*1.1+h*3.2+nn*2.0);
          float a=smoothstep(0.42,0.78,nn*shore+band*0.3*shore)*shore;
          gl_FragColor=vec4(vec3(0.57,0.54,0.57),a*0.8);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const foam = new THREE.Mesh(new THREE.PlaneGeometry(size, size, 1, 1), foamMat);
    foam.rotation.x = -Math.PI / 2;
    foam.position.y = 0.04;
    ext.add(foam);
    // 礁石
    const rockMat = std({ color: 0x5d5852, roughness: 0.9, bumpMap: rockBump, bumpScale: 1.4, envMapIntensity: 0.5 });
    const bases: THREE.BufferGeometry[] = [];
    for (let v = 0; v < 4; v++) {
      const bg = new THREE.IcosahedronGeometry(1, 3);
      const bp = bg.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < bp.count; i++) {
        const x = bp.getX(i);
        const y = bp.getY(i);
        const z = bp.getZ(i);
        const f = 1 + 0.28 * noise2(x * 1.6 + v * 9, z * 1.6 + y) + 0.12 * noise2(x * 4 + v, y * 4);
        bp.setXYZ(i, x * f, y * f * 0.7, z * f);
      }
      bg.computeVertexNormals();
      bases.push(bg);
    }
    const dummy = new THREE.Object3D();
    bases.forEach((bg) => {
      const list: [number, number, number][] = [];
      let tries = 0;
      while (list.length < 26 && tries < 4000) {
        tries++;
        const a = R() * TAU;
        const r = 12 + R() * 26;
        const x = Math.sin(a) * r;
        const z = Math.cos(a) * r;
        const h = islandH(x, z);
        if (h > -0.9 && h < 1.7) list.push([x, h, z]);
      }
      const im = new THREE.InstancedMesh(bg, rockMat, list.length);
      list.forEach(([x, h, z], i) => {
        const sc = 0.5 + Math.pow(R(), 2) * 2.2;
        dummy.position.set(x, h - sc * 0.25, z);
        dummy.rotation.set(R() * 0.5, R() * TAU, R() * 0.5);
        dummy.scale.set(sc * (0.8 + R() * 0.6), sc, sc * (0.8 + R() * 0.6));
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      });
      im.castShadow = true;
      im.receiveShadow = true;
      ext.add(im);
    });
    // 乾砌石牆：每塊石頭是壓扁、帶雜訊的多面體（上下面較平，像疊起來的石塊），兩層錯縫
    const stoneMat = std({ color: 0x847e75, roughness: 0.95, bumpMap: rockBump, bumpScale: 1.2, envMapIntensity: 0.5 });
    const stoneGeos: THREE.BufferGeometry[] = [];
    for (let v = 0; v < 3; v++) {
      const sg = new THREE.IcosahedronGeometry(1, 2);
      const sp = sg.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < sp.count; i++) {
        const x = sp.getX(i);
        const y = sp.getY(i);
        const z = sp.getZ(i);
        const f = 1 + 0.16 * noise2(x * 2.1 + v * 7, z * 2.1 + y * 1.3) + 0.06 * noise2(x * 5 + v, y * 5);
        // 上下壓平：疊砌的石塊有承重面
        const yy = clamp(y * f, -0.78, 0.82);
        sp.setXYZ(i, x * f * 0.62, yy * 0.36, z * f * 0.27);
      }
      sg.computeVertexNormals();
      stoneGeos.push(sg);
    }
    const courses: [number, number, number, number, number][][] = [[], [], []];
    for (let row = 0; row < 2; row++) {
      const n = row === 0 ? 96 : 104;
      for (let i = 0; i < n; i++) {
        const a = ((i + row * 0.5) / n) * TAU;
        const x = Math.sin(a) * 16.5;
        const z = Math.cos(a) * 16.5;
        if (Math.hypot(x - HOUSE.x, z - HOUSE.z) < 6.5) continue;
        const h = islandH(x, z);
        if (h > 4.6 && !(row === 1 && R() < 0.18)) courses[Math.floor(R() * 3)].push([x, h, z, a, row]);
      }
    }
    courses.forEach((list, v) => {
      const wim = new THREE.InstancedMesh(stoneGeos[v], stoneMat, list.length);
      list.forEach(([x, h, z, a, row], i) => {
        dummy.position.set(x, h + (row === 0 ? 0.22 : 0.62), z);
        dummy.rotation.set((R() - 0.5) * 0.12, a + Math.PI / 2 + (R() - 0.5) * 0.18, (R() - 0.5) * 0.12);
        const sc = row === 0 ? 1 : 0.82;
        dummy.scale.set(sc * (0.9 + R() * 0.3), sc * (0.85 + R() * 0.35), sc * (0.9 + R() * 0.25));
        dummy.updateMatrix();
        wim.setMatrixAt(i, dummy.matrix);
      });
      wim.castShadow = wim.receiveShadow = true;
      ext.add(wim);
    });
  })();

  /* ---------- 燈塔 ---------- */
  const TWIN = [
    { a: 0.55, y: 10.2, lit: false },
    { a: 2.25, y: 14.8, lit: true },
    { a: 3.9, y: 19.3, lit: false },
    { a: 5.75, y: 23.6, lit: true },
    { a: 1.3, y: 27.4, lit: false },
  ];
  const lathePhi = Math.PI;
  const uOf = (a: number) => ((((a - lathePhi) / TAU) % 1) + 1) % 1;
  const YB = 5.2;
  const YT = TOWER.y1;
  const vOf = (y: number) => (y - YB) / (YT - YB);
  function towerTextures() {
    const W = 1024;
    const H = 2048;
    const c = makeCanvas(W, H);
    const x = ctx2d(c);
    x.fillStyle = '#e6e1d7';
    x.fillRect(0, 0, W, H);
    overlayNoise(x, W, H, NZ, 0.38, 2, 3);
    overlayNoise(x, W, H, NZF, 0.18, 1, 1);
    const courses = 48;
    for (let i = 0; i < courses; i++) {
      const y = (i * H) / courses;
      x.fillStyle = 'rgba(85,76,66,0.06)';
      x.fillRect(0, y, W, 2);
      let xx = R() * 50;
      while (xx < W) {
        x.fillStyle = 'rgba(85,76,66,0.03)';
        x.fillRect(xx, y, 2, H / courses);
        xx += 38 + R() * 46;
      }
    }
    let g = x.createLinearGradient(0, 0, 0, H * 0.12);
    g.addColorStop(0, 'rgba(48,44,40,0.38)');
    g.addColorStop(1, 'rgba(48,44,40,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, W, H * 0.12);
    g = x.createLinearGradient(0, H, 0, H * 0.8);
    g.addColorStop(0, 'rgba(64,70,46,0.6)');
    g.addColorStop(1, 'rgba(64,70,46,0)');
    x.fillStyle = g;
    x.fillRect(0, H * 0.8, W, H * 0.2);
    // 雨痕：邊緣柔化（近看觀測室的窗時，塔身一公尺有好幾百像素，硬邊的細條會變成一排條碼）
    const soft = 'filter' in x;
    if (soft) x.filter = 'blur(2px)';
    for (let i = 0; i < 300; i++) {
      const sx = R() * W;
      const sy = R() < 0.5 ? R() * H * 0.12 : R() * H;
      const len = 30 + R() * R() * 760;
      const w = 2 + R() * 5;
      const a = 0.018 + R() * 0.05;
      g = x.createLinearGradient(0, sy, 0, sy + len);
      g.addColorStop(0, `rgba(72,64,54,${a})`);
      g.addColorStop(1, 'rgba(72,64,54,0)');
      x.fillStyle = g;
      x.fillRect(sx, sy, w, len);
    }
    const streak = (u: number, y: number) => {
      const cx = u * W;
      const cy = (1 - vOf(y)) * H;
      for (let k = 0; k < 7; k++) {
        const sx = cx + (R() - 0.5) * 26;
        const len = 60 + R() * 260;
        g = x.createLinearGradient(0, cy, 0, cy + len);
        g.addColorStop(0, 'rgba(118,78,48,0.12)');
        g.addColorStop(1, 'rgba(118,78,48,0)');
        x.fillStyle = g;
        x.fillRect(sx, cy, 2 + R() * 4, len);
      }
    };
    TWIN.forEach((w) => streak(uOf(w.a), w.y - 0.45));
    [0, 2.1, -2.1].forEach((a) => streak(uOf(a), WIN.bot - 0.05));
    streak(uOf(DOOR_A), 8.6);
    if (soft) x.filter = 'none';
    const b = makeCanvas(512, 1024);
    const bx = ctx2d(b);
    bx.fillStyle = '#808080';
    bx.fillRect(0, 0, 512, 1024);
    for (let i = 0; i < courses; i++) {
      const y = (i * 1024) / courses;
      bx.fillStyle = 'rgba(0,0,0,0.32)';
      bx.fillRect(0, y, 512, 1.5);
      let xx = R() * 25;
      bx.fillStyle = 'rgba(0,0,0,0.14)';
      while (xx < 512) {
        bx.fillRect(xx, y, 1.5, 1024 / courses);
        xx += 19 + R() * 23;
      }
    }
    overlayNoise(bx, 512, 1024, NZF, 0.35, 1, 1);
    return { map: tex(c), bump: tex(b, undefined, false) };
  }
  const TT = towerTextures();
  const tower = new THREE.Group();
  ext.add(tower);
  const pts: THREE.Vector2[] = [new THREE.Vector2(TOWER.rb + 0.08, YB)];
  for (let y = YB + 0.5; y <= YT + 1e-6; y += 0.5) pts.push(new THREE.Vector2(towerR(y), y));
  // 塔身：粉刷過的石砌（遠看是原本的貼圖與砌縫，近看有抹灰的起伏、砂粒與小凹洞）。
  // 凹凸只留一半：近看窗那一章時，強的凹凸會讓整面牆像一片雜訊
  const whitePaint = detail(std({ map: TT.map, bumpMap: TT.bump, bumpScale: 0.6, roughness: 0.8, metalness: 0, envMapIntensity: 0.55 }), {
    scale: 1.25,
    bump: 1.6,
    albedo: 0.06,
    fadeFar: 30,
  });
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 128, lathePhi, TAU), whitePaint);
  body.castShadow = body.receiveShadow = true;
  tower.add(body);
  const stone = detail(std({ color: 0x8e877d, roughness: 0.92, bumpMap: rockBump, bumpScale: 1.0, envMapIntensity: 0.5 }), {
    map: stoneDet,
    scale: 0.9,
    bump: 2.4,
    albedo: 0.12,
    fadeFar: 40,
  });
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(TOWER.rb + 0.35, TOWER.rb + 0.5, 1.4, 96), stone);
  plinth.position.y = 5.6;
  plinth.castShadow = plinth.receiveShadow = true;
  tower.add(plinth);
  const ironDark = std({ color: 0x1c2024, roughness: 0.5, metalness: 0.55, envMapIntensity: 0.9 });
  // 窗框是上了漆的木頭（不是塑膠）：粗糙一點、帶木紋的起伏，邊角是圓的
  const frameGreen = detail(std({ color: 0x1f332c, roughness: 0.66, metalness: 0 }), { map: woodDet, scale: 3.2, bump: 1.2, albedo: 0.1, fadeFar: 16 });
  const sillStone = detail(std({ color: 0xb9b2a6, roughness: 0.85 }), { map: stoneDet, scale: 2.2, bump: 1.2, albedo: 0.12, fadeFar: 24 });
  const glassDark = std({ color: 0x0d1318, roughness: 0.08, metalness: 0.2, envMapIntensity: 1.4 });
  const warmGlass = std({ color: 0x1a1008, emissive: 0xffa24d, emissiveIntensity: 1.25, roughness: 0.2 });
  /** 圓角的方塊（窗框、門框、窗台的邊都是圓的，不是銳利的盒子） */
  const rbox = (w: number, h: number, d: number, r = 0.02) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
  /** 窗台：斜的排水面、圓角的前緣、底下一道滴水槽；沿 x 擠出，z 往外 */
  function sillGeometry(len: number, depth: number, h: number) {
    const s = new THREE.Shape();
    const back = -depth * 0.3;
    const front = depth * 0.7;
    s.moveTo(back, -h / 2);
    s.lineTo(back, h / 2);
    s.lineTo(front - 0.035, h * 0.2);
    s.quadraticCurveTo(front, h * 0.18, front, -h * 0.05);
    s.lineTo(front, -h * 0.32);
    s.quadraticCurveTo(front, -h / 2, front - 0.02, -h / 2);
    s.lineTo(front - 0.04, -h / 2);
    s.lineTo(front - 0.046, -h * 0.28);
    s.lineTo(front - 0.062, -h * 0.28);
    s.lineTo(front - 0.068, -h / 2);
    s.lineTo(back, -h / 2);
    const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.006, bevelSegments: 2, curveSegments: 6 });
    g.translate(0, 0, -len / 2);
    g.rotateY(-Math.PI / 2);
    const out = toCreasedNormals(g, 0.6);
    g.dispose();
    return out;
  }
  function placeOnTower(obj: THREE.Object3D, a: number, y: number, out = 0) {
    const r = towerR(y) + out;
    obj.position.set(Math.sin(a) * r, y, Math.cos(a) * r);
    obj.rotation.y = a;
    tower.add(obj);
  }
  const shadowAll = (g: THREE.Object3D) =>
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
    });
  TWIN.forEach((w) => {
    const g = new THREE.Group();
    // 窗洞：外框凸出牆面，玻璃退進去（看得出窗洞的深度）
    (
      [
        [0, 0.45, 0.7, 0.08],
        [-0.31, 0, 0.08, 0.98],
        [0.31, 0, 0.08, 0.98],
      ] as const
    ).forEach(([x, y, ww, hh]) => {
      const m = new THREE.Mesh(rbox(ww, hh, 0.18, 0.015), frameGreen);
      m.position.set(x, y, 0.02);
      g.add(m);
    });
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.86), w.lit ? warmGlass : glassDark);
    gl.position.z = -0.02;
    g.add(gl);
    g.add(new THREE.Mesh(rbox(0.54, 0.028, 0.03, 0.008), frameGreen));
    g.add(new THREE.Mesh(rbox(0.028, 0.86, 0.03, 0.008), frameGreen));
    const sl = new THREE.Mesh(sillGeometry(0.82, 0.26, 0.07), sillStone);
    sl.position.set(0, -0.53, 0.04);
    g.add(sl);
    shadowAll(g);
    placeOnTower(g, w.a, w.y, -0.02);
  });
  // 塔門：石框（圓角）、門楣上一道小簷、退進去的門板（上下兩塊凹板）、門前一塊踏石
  (() => {
    const g = new THREE.Group();
    (
      [
        [0, 2.72, 1.8, 0.3],
        [-0.72, 1.3, 0.3, 2.6],
        [0.72, 1.3, 0.3, 2.6],
      ] as const
    ).forEach(([x, y, ww, hh]) => {
      const m = new THREE.Mesh(rbox(ww, hh, 0.32, 0.03), sillStone);
      m.position.set(x, y, 0);
      g.add(m);
    });
    const cap = new THREE.Mesh(sillGeometry(2.0, 0.34, 0.1), sillStone);
    cap.position.set(0, 2.92, 0.04);
    g.add(cap);
    const doorM = detail(std({ color: 0x24392f, roughness: 0.62 }), { map: woodDet, scale: 2.4, bump: 1.4, albedo: 0.1, vertical: true, fadeFar: 30 });
    const d = new THREE.Mesh(rbox(1.14, 2.42, 0.08, 0.012), doorM);
    d.position.set(0, 1.21, -0.06);
    g.add(d);
    [1.75, 0.68].forEach((y) => {
      const p = new THREE.Mesh(rbox(0.86, y > 1 ? 0.95 : 0.8, 0.03, 0.01), doorM);
      p.position.set(0, y, -0.005);
      g.add(p);
    });
    const step = new THREE.Mesh(rbox(1.9, 0.18, 0.7, 0.04), stone);
    step.position.set(0, 0.0, 0.35);
    g.add(step);
    shadowAll(g);
    const r = towerR(7) + 0.05;
    g.position.set(Math.sin(DOOR_A) * r, 6.0, Math.cos(DOOR_A) * r);
    g.rotation.y = DOOR_A;
    tower.add(g);
  })();
  // 觀測室的窗（a=0 那扇是看進室內的入口）：石框圓角、楣石一道小簷、窗台有排水面與滴水槽、窗扇是上漆的木框
  const halos: THREE.SpriteMaterial[] = [];
  function watchWindow(a: number, portal: boolean) {
    const g = new THREE.Group();
    const bw = WIN.w + 0.32;
    const bh = WIN.h + 0.32;
    (
      [
        [0, WIN.h / 2 + 0.08, bw, 0.16],
        [-WIN.w / 2 - 0.08, 0, 0.16, bh],
        [WIN.w / 2 + 0.08, 0, 0.16, bh],
      ] as const
    ).forEach(([x, y, w, h]) => {
      const m = new THREE.Mesh(rbox(w, h, 0.17, 0.03), sillStone);
      m.position.set(x, y, 0.02);
      g.add(m);
    });
    const head = new THREE.Mesh(sillGeometry(bw + 0.1, 0.22, 0.07), sillStone);
    head.position.set(0, WIN.h / 2 + 0.19, 0.06);
    g.add(head);
    const sl = new THREE.Mesh(sillGeometry(bw + 0.16, 0.36, 0.11), sillStone);
    sl.position.set(0, -WIN.h / 2 - 0.1, 0.06);
    g.add(sl);
    shadowAll(g);
    if (!portal) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(WIN.w, WIN.h), warmGlass);
      p.position.z = -0.04;
      g.add(p);
    }
    const leafGlass = std({
      color: 0x9fb6c8,
      transparent: true,
      opacity: portal ? 0.14 : 0.3,
      roughness: 0.04,
      metalness: 0.1,
      envMapIntensity: 1.6,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const leaves: { hinge: THREE.Group; side: number }[] = [];
    [-1, 1].forEach((side) => {
      const hinge = new THREE.Group();
      hinge.position.set((side * WIN.w) / 2, 0, 0.06);
      g.add(hinge);
      const leaf = new THREE.Group();
      leaf.position.x = (-side * WIN.w) / 4;
      hinge.add(leaf);
      const lw = WIN.w / 2;
      const t = 0.05;
      (
        [
          [0, WIN.h / 2 - t / 2, lw, t, 0.05],
          [0, -WIN.h / 2 + t / 2 + 0.01, lw, t + 0.02, 0.05],
          [-lw / 2 + t / 2, 0, t, WIN.h, 0.05],
          [lw / 2 - t / 2, 0, t, WIN.h, 0.05],
          [0, WIN.h / 6, lw, 0.026, 0.034],
          [0, -WIN.h / 6, lw, 0.026, 0.034],
        ] as const
      ).forEach(([x, y, w, h, d]) => {
        const m = new THREE.Mesh(rbox(w, h, d, 0.009), frameGreen);
        m.position.set(x, y, 0);
        m.castShadow = true;
        leaf.add(m);
      });
      leaf.add(new THREE.Mesh(new THREE.PlaneGeometry(lw - 0.06, WIN.h - 0.06), leafGlass));
      leaves.push({ hinge, side });
    });
    const haloMat = new THREE.SpriteMaterial({
      map: glowT,
      color: 0xffa55a,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.35,
      toneMapped: false,
    });
    halos.push(haloMat);
    const halo = new THREE.Sprite(haloMat);
    halo.scale.set(3.4, 3.8, 1);
    halo.position.z = 0.25;
    g.add(halo);
    const r = towerR(WIN.y);
    g.position.set(Math.sin(a) * (r + 0.035), WIN.y, Math.cos(a) * (r + 0.035));
    g.rotation.y = a;
    tower.add(g);
    return { g, leaves, haloMat };
  }
  const mainWin = watchWindow(0, true);
  watchWindow(2.1, false);
  watchWindow(-2.1, false);
  // 入口：觀測室先畫進 render target，再貼在窗上
  const rtInt = keep(new THREE.WebGLRenderTarget(4, 4, { samples: low ? 0 : 4, type: THREE.HalfFloatType }));
  const portalMat = new THREE.ShaderMaterial({
    uniforms: {
      tInt: { value: rtInt.texture },
      uRes: { value: new THREE.Vector2(1, 1) },
      uMix: { value: 0 },
      uGlow: { value: new THREE.Color(...NIGHT.portalGlow) },
      uGain: { value: 1 },
    },
    vertexShader: /* glsl */ `void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    // 室內畫面先 tone map，再跟窗上的暖光（顯示色）混合。uGain：從夜裡的窗外看進去時，亮著燈的室內比外牆亮一截
    fragmentShader: /* glsl */ `uniform sampler2D tInt;uniform vec2 uRes;uniform float uMix;uniform vec3 uGlow;uniform float uGain;void main(){vec3 c=texture2D(tInt,gl_FragCoord.xy/uRes).rgb*uGain;gl_FragColor=vec4(c,1.0);
      #include <tonemapping_fragment>
      gl_FragColor.rgb=mix(pow(uGlow,vec3(2.2)),gl_FragColor.rgb,uMix);
      #include <colorspace_fragment>
    }`,
  });
  const pu = portalMat.uniforms as Uniforms;
  const portal = new THREE.Mesh(new THREE.PlaneGeometry(WIN.w, WIN.h), portalMat);
  portal.position.set(0, WIN.y, PORTAL_Z);
  tower.add(portal);
  // 窗裡溢出來的暖光：夜裡靠近窗時，照亮窗台、窗洞與打開的窗扇（亮著燈的那扇窗）
  const winSpill = new THREE.PointLight(0xffb06a, 0, 3.4, 2);
  winSpill.position.set(0, WIN.y - 0.2, PORTAL_Z + 0.38);
  tower.add(winSpill);

  // 燈廊與燈籠
  const galY = TOWER.y1;
  // 燈廊下的簷口：一層一層往外挑出的石砌線腳（疊澀），每一層的底面是平的、立面是直的，像磚石砌出來的挑簷；
  // 線腳下面一圈小托座，跟線腳同一組階梯、只比它多挑出一點點。近看窗那一章時，畫面上方是一排規矩的小托座，
  // 不是曲線薄片拉出來的大花瓣
  const galM = std({ color: 0x34383b, roughness: 0.62, metalness: 0.25, bumpMap: rockBump, bumpScale: 0.6, envMapIntensity: 0.8 });
  // 簷口與托架漆成跟塔身一樣的白（線腳的明暗才看得出來）
  const corniceM = detail(std({ color: 0xe4dfd5, roughness: 0.78, metalness: 0, envMapIntensity: 0.55 }), { scale: 1.6, bump: 1.1, albedo: 0.04, fadeFar: 24 });
  const slab = new THREE.Mesh(
    new THREE.LatheGeometry(
      [
        [0, 33.0],
        [4.1, 33.0],
        [4.2, 33.02],
        [4.27, 33.07],
        [4.28, 33.24],
        [4.24, 33.3],
        [0, 33.3],
      ].map(([r, y]) => new THREE.Vector2(r, y)),
      96,
    ),
    galM,
  );
  slab.castShadow = slab.receiveShadow = true;
  tower.add(slab);
  (() => {
    const dummy = new THREE.Object3D();
    const rw = towerR(32.2);
    /** 疊澀的四層：[這一層挑出到的半徑, 這一層的底面高度]，最上面一層頂住平台底面 */
    const courses: [number, number][] = [
      [rw + 0.09, 32.24],
      [rw + 0.2, 32.4],
      [rw + 0.33, 32.56],
      [rw + 0.48, 32.72],
      [4.1, 32.88],
    ];
    const cp: THREE.Vector2[] = [new THREE.Vector2(rw - 0.03, courses[0][1])];
    courses.forEach(([r, y], i) => {
      const top = i < courses.length - 1 ? courses[i + 1][1] : 33.0;
      // 底面、一道很小的倒角、立面
      cp.push(new THREE.Vector2(r - 0.012, y), new THREE.Vector2(r, y + 0.012), new THREE.Vector2(r, top));
    });
    const rawCor = new THREE.LatheGeometry(cp, 128);
    const corG = toCreasedNormals(rawCor, 0.6);
    rawCor.dispose();
    const cor = new THREE.Mesh(corG, corniceM);
    cor.castShadow = cor.receiveShadow = true;
    tower.add(cor);
    // 托座：跟疊澀同一組階梯，每一階多挑出 4 公分；寬 9 公分，邊角只倒一點圓
    const bs = new THREE.Shape();
    const r0 = rw - 0.06;
    bs.moveTo(r0, courses[0][1]);
    courses.slice(0, 4).forEach(([r, y], i) => {
      bs.lineTo(r + 0.04, y);
      bs.lineTo(r + 0.04, courses[i + 1][1]);
    });
    bs.lineTo(r0, courses[4][1]);
    bs.lineTo(r0, courses[0][1]);
    const rawBg = new THREE.ExtrudeGeometry(bs, { depth: 0.09, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, steps: 1, curveSegments: 4 });
    rawBg.translate(0, 0, -0.045);
    const bg = toCreasedNormals(rawBg, 0.5);
    rawBg.dispose();
    const BR = 32;
    const im = new THREE.InstancedMesh(bg, corniceM, BR);
    for (let i = 0; i < BR; i++) {
      const a = ((i + 0.5) / BR) * TAU;
      dummy.position.set(0, 0, 0);
      dummy.rotation.set(0, a - Math.PI / 2, 0);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    }
    im.castShadow = im.receiveShadow = true;
    tower.add(im);
    const pm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.035, 1.12, 6), ironDark, 56);
    for (let i = 0; i < 56; i++) {
      const a = (i / 56) * TAU;
      dummy.position.set(Math.sin(a) * 4.1, galY + 0.86, Math.cos(a) * 4.1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      pm.setMatrixAt(i, dummy.matrix);
    }
    pm.castShadow = true;
    tower.add(pm);
  })();
  [galY + 1.42, galY + 0.9].forEach((y) => {
    const t = new THREE.Mesh(new THREE.TorusGeometry(4.1, 0.04, 6, 140), ironDark);
    t.rotation.x = Math.PI / 2;
    t.position.y = y;
    tower.add(t);
  });
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(2.36, 2.46, 1.0, 12), std({ color: 0xd9d4ca, roughness: 0.7, metalness: 0.1 }));
  ped.position.y = galY + 0.8;
  ped.castShadow = true;
  tower.add(ped);
  const glazY0 = galY + 1.3;
  const glazH = 2.6;
  const glaz = new THREE.Mesh(
    new THREE.CylinderGeometry(2.3, 2.3, glazH, 12, 1, true),
    std({ color: 0xaec4d4, transparent: true, opacity: 0.16, roughness: 0.03, metalness: 0.2, envMapIntensity: 1.8, side: THREE.DoubleSide, depthWrite: false }),
  );
  glaz.position.y = glazY0 + glazH / 2;
  tower.add(glaz);
  (() => {
    const dummy = new THREE.Object3D();
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, glazH, 0.12), ironDark, 12);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      dummy.position.set(Math.sin(a) * 2.31, glazY0 + glazH / 2, Math.cos(a) * 2.31);
      dummy.rotation.set(0, a, 0);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    }
    tower.add(im);
  })();
  [glazY0 + 0.9, glazY0 + 1.75].forEach((y) => {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(2.32, 2.32, 0.06, 12, 1, true), ironDark);
    r.position.y = y;
    tower.add(r);
  });
  const eave = new THREE.Mesh(new THREE.CylinderGeometry(2.62, 2.62, 0.14, 12), ironDark);
  eave.position.y = glazY0 + glazH + 0.07;
  tower.add(eave);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.62, 1.55, 12), ironDark);
  roof.position.y = glazY0 + glazH + 0.14 + 0.775;
  roof.castShadow = true;
  tower.add(roof);
  const vent = new THREE.Mesh(new THREE.SphereGeometry(0.38, 20, 14), std({ color: 0x3d6b5c, roughness: 0.55, metalness: 0.4 }));
  vent.position.y = roof.position.y + 0.95;
  tower.add(vent);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.035, 1.9, 6), ironDark);
  rod.position.y = vent.position.y + 1.1;
  tower.add(rod);
  // 透鏡與燈
  const lens = new THREE.Group();
  lens.position.y = LAMP_Y;
  tower.add(lens);
  const lensGlass = std({
    color: 0xd8e6f0,
    transparent: true,
    opacity: 0.35,
    roughness: 0.05,
    metalness: 0.3,
    envMapIntensity: 2,
    emissive: 0xffcf8a,
    emissiveIntensity: 0.35,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  lens.add(new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 1.3, 32, 1, true), lensGlass));
  const prismMat = std({ color: 0xcfe0ea, roughness: 0.1, metalness: 0.6, emissive: 0xffc070, emissiveIntensity: 0.25 });
  const prismGeo = new THREE.TorusGeometry(0.6, 0.03, 6, 40);
  for (let i = 0; i < 9; i++) {
    const t = new THREE.Mesh(prismGeo, prismMat);
    t.rotation.x = Math.PI / 2;
    t.position.y = -0.6 + i * 0.15;
    lens.add(t);
  }
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xfff2dc, toneMapped: false });
  lens.add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), coreMat));
  const lampLight = new THREE.PointLight(0xffdca6, 30, 16, 2);
  lampLight.position.y = LAMP_Y;
  tower.add(lampLight);
  const glowSm = new THREE.SpriteMaterial({ map: glowT, color: 0xffe0ae, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
  const glow1 = new THREE.Sprite(glowSm);
  glow1.position.y = LAMP_Y;
  glow1.scale.setScalar(4.5);
  tower.add(glow1);
  const glowSm2 = glowSm.clone();
  glowSm2.opacity = 0.35;
  const glow2 = new THREE.Sprite(glowSm2);
  glow2.position.y = LAMP_Y;
  glow2.scale.setScalar(22);
  tower.add(glow2);
  // 光束：兩道背對背，20 秒轉一圈，所以每 10 秒有一道掃過觀者（燈質 Fl W 10s）
  const beamMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
    uniforms: { uColor: { value: new THREE.Color(1.0, 0.86, 0.62) }, uI: { value: 0.5 }, uLen: { value: 160 } },
    vertexShader: /* glsl */ `uniform float uLen;varying float vA;varying vec3 vN;varying vec3 vV;void main(){vA=position.z/uLen;vec4 mv=modelViewMatrix*vec4(position,1.0);vV=-mv.xyz;vN=normalMatrix*normal;gl_Position=projectionMatrix*mv;}`,
    fragmentShader: /* glsl */ `uniform vec3 uColor;uniform float uI;varying float vA;varying vec3 vN;varying vec3 vV;void main(){float a=pow(1.0-clamp(vA,0.0,1.0),2.4)*smoothstep(0.0,0.015,vA);float e=pow(abs(dot(normalize(vN),normalize(vV))),1.6);gl_FragColor=vec4(uColor*a*e*uI,1.0);
      #include <colorspace_fragment>
    }`,
  });
  const bu = beamMat.uniforms as Uniforms;
  const beamG = new THREE.CylinderGeometry(0.45, 11, 160, 40, 1, true);
  beamG.translate(0, -80, 0);
  beamG.rotateX(-Math.PI / 2);
  const beams = new THREE.Group();
  beams.position.y = LAMP_Y;
  tower.add(beams);
  [0, Math.PI].forEach((r) => {
    const b = new THREE.Mesh(beamG, beamMat);
    b.rotation.y = r;
    beams.add(b);
  });

  /* ---------- 守燈人的屋子 ---------- */
  // 灰泥牆（圓角的牆角、深色的石基）、有厚度的山牆、出簷的屋頂（封簷板、山牆端的博風板、屋脊、簷溝），
  // 窗是凸出牆面的石框加窗台，木窗框退在框裡；門有門框、門楣上的小雨遮與踏石
  const houseGlass = std({ color: 0x1a1008, emissive: 0xffa24d, emissiveIntensity: 1.1, roughness: 0.3 });
  (() => {
    const g = new THREE.Group();
    const L = 7;
    const D = 4.6;
    const Hh = 3.0;
    const rise = 1.45;
    const wallM = detail(std({ color: 0xe2dccf, roughness: 0.92, envMapIntensity: 0.5 }), { scale: 1.1, bump: 2.8, albedo: 0.07, fadeFar: 60 });
    const walls = new THREE.Mesh(rbox(L, Hh, D, 0.07), wallM);
    walls.position.y = Hh / 2;
    g.add(walls);
    const base = new THREE.Mesh(rbox(L + 0.14, 0.42, D + 0.14, 0.04), stone);
    base.position.y = 0.2;
    g.add(base);
    // 山牆：有厚度的三角形
    const gs = new THREE.Shape();
    gs.moveTo(-D / 2, 0);
    gs.lineTo(D / 2, 0);
    gs.lineTo(0, rise);
    gs.lineTo(-D / 2, 0);
    const gable = new THREE.ExtrudeGeometry(gs, { depth: 0.14, bevelEnabled: false });
    gable.rotateY(Math.PI / 2);
    [-1, 1].forEach((s) => {
      const m = new THREE.Mesh(gable, wallM);
      m.position.set(s > 0 ? L / 2 - 0.14 : -L / 2, Hh, 0);
      g.add(m);
    });
    const rc = makeCanvas(256, 256);
    const rx = ctx2d(rc);
    rx.fillStyle = '#7a3526';
    rx.fillRect(0, 0, 256, 256);
    for (let r = 0; r < 16; r++) {
      for (let c = 0; c < 12; c++) {
        const x = c * 22 + (r % 2) * 11;
        const y = r * 16;
        rx.fillStyle = `hsl(${10 + R() * 8},${40 + R() * 15}%,${22 + R() * 10}%)`;
        rx.fillRect(x + 1, y + 1, 20, 13);
        rx.fillStyle = 'rgba(0,0,0,0.35)';
        rx.fillRect(x, y + 13, 22, 3);
      }
    }
    overlayNoise(rx, 256, 256, NZ, 0.3, 1, 1);
    const roofM = std({ map: tex(rc, [3, 1.5]), roughness: 0.82, envMapIntensity: 0.5 });
    const trimM = detail(std({ color: 0xece7dc, roughness: 0.7, envMapIntensity: 0.5 }), { map: woodDet, scale: 3, bump: 0.8, albedo: 0.05, fadeFar: 40 });
    const ang = Math.atan2(rise, D / 2);
    const over = 0.5;
    const slope = Math.hypot(D / 2, rise) + over;
    const ridge = V3(0, Hh + rise + 0.04, 0);
    [1, -1].forEach((s) => {
      const u = V3(0, -Math.sin(ang), s * Math.cos(ang));
      const n = V3(0, Math.cos(ang), s * Math.sin(ang));
      const center = ridge.clone().addScaledVector(u, slope / 2).addScaledVector(n, 0.05);
      const roofSlab = new THREE.Mesh(rbox(L + 0.7, 0.1, slope, 0.02), roofM);
      roofSlab.rotation.x = s * ang;
      roofSlab.position.copy(center);
      g.add(roofSlab);
      // 封簷板（簷口那一條白色的板子）與簷溝
      const eave = ridge.clone().addScaledVector(u, slope);
      const fascia = new THREE.Mesh(rbox(L + 0.7, 0.2, 0.05, 0.012), trimM);
      fascia.position.copy(eave).add(V3(0, -0.04, s * 0.01));
      g.add(fascia);
      const gutter = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, L + 0.6, 16, 1, true, 0, Math.PI), ironDark);
      gutter.rotation.z = Math.PI / 2;
      gutter.rotation.y = s > 0 ? 0 : Math.PI;
      gutter.position.copy(eave).add(V3(0, -0.1, s * 0.07));
      g.add(gutter);
      // 山牆端的博風板
      [-1, 1].forEach((e) => {
        const barge = new THREE.Mesh(rbox(0.05, 0.22, slope, 0.012), trimM);
        barge.rotation.x = s * ang;
        barge.position.copy(center).addScaledVector(n, -0.1).add(V3(e * (L / 2 + 0.33), 0, 0));
        g.add(barge);
      });
    });
    const ridgeCap = new THREE.Mesh(rbox(L + 0.74, 0.16, 0.2, 0.05), roofM);
    ridgeCap.position.copy(ridge).add(V3(0, 0.08, 0));
    g.add(ridgeCap);
    // 煙囪：灰泥、頂上一圈石帽和一支陶管
    const ch = new THREE.Mesh(rbox(0.55, 1.7, 0.55, 0.03), wallM);
    ch.position.set(L / 2 - 1.2, Hh + rise - 0.05, -0.6);
    g.add(ch);
    const chCap = new THREE.Mesh(rbox(0.72, 0.1, 0.72, 0.02), stone);
    chCap.position.set(L / 2 - 1.2, Hh + rise + 0.84, -0.6);
    g.add(chCap);
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.3, 16), std({ color: 0x7a4a36, roughness: 0.8 }));
    pot.position.set(L / 2 - 1.2, Hh + rise + 1.04, -0.6);
    g.add(pot);
    // 窗：石框凸出牆面 0.12，木窗框與玻璃退在框裡，下面是有排水面的窗台
    const FZ = D / 2;
    (
      [
        [-2.4, true],
        [1.0, true],
        [2.6, false],
      ] as const
    ).forEach(([x, lit]) => {
      const W0 = 0.86;
      const H0 = 1.08;
      const y = 1.7;
      (
        [
          [0, H0 / 2 + 0.07, W0 + 0.28, 0.14],
          [-W0 / 2 - 0.07, 0, 0.14, H0],
          [W0 / 2 + 0.07, 0, 0.14, H0],
        ] as const
      ).forEach(([dx, dy, ww, hh]) => {
        const m = new THREE.Mesh(rbox(ww, hh, 0.14, 0.02), sillStone);
        m.position.set(x + dx, y + dy, FZ + 0.06);
        g.add(m);
      });
      const sill = new THREE.Mesh(sillGeometry(W0 + 0.34, 0.26, 0.08), sillStone);
      sill.position.set(x, y - H0 / 2 - 0.04, FZ + 0.08);
      g.add(sill);
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(W0, H0), lit ? houseGlass : glassDark);
      glass.position.set(x, y, FZ + 0.012);
      g.add(glass);
      (
        [
          [0, H0 / 2 - 0.03, W0, 0.06],
          [0, -H0 / 2 + 0.03, W0, 0.06],
          [-W0 / 2 + 0.03, 0, 0.06, H0],
          [W0 / 2 - 0.03, 0, 0.06, H0],
          [0, 0.06, W0, 0.035],
          [0, 0, 0.035, H0],
        ] as const
      ).forEach(([dx, dy, ww, hh]) => {
        const m = new THREE.Mesh(rbox(ww, hh, 0.05, 0.008), frameGreen);
        m.position.set(x + dx, y + dy, FZ + 0.035);
        g.add(m);
      });
    });
    // 門：石框、退進去的門板（兩塊凹板）、門楣上的小雨遮、門前踏石
    const DX = -0.7;
    (
      [
        [0, 2.2, 1.34, 0.16],
        [-0.59, 1.06, 0.16, 2.12],
        [0.59, 1.06, 0.16, 2.12],
      ] as const
    ).forEach(([dx, y, ww, hh]) => {
      const m = new THREE.Mesh(rbox(ww, hh, 0.14, 0.02), sillStone);
      m.position.set(DX + dx, y, FZ + 0.06);
      g.add(m);
    });
    const hood = new THREE.Mesh(sillGeometry(1.6, 0.46, 0.1), sillStone);
    hood.position.set(DX, 2.38, FZ + 0.12);
    g.add(hood);
    const doorM = detail(std({ color: 0x24392f, roughness: 0.62 }), { map: woodDet, scale: 2.4, bump: 1.4, albedo: 0.1, vertical: true, fadeFar: 40 });
    const door = new THREE.Mesh(rbox(1.02, 2.08, 0.06, 0.01), doorM);
    door.position.set(DX, 1.04, FZ + 0.02);
    g.add(door);
    [1.5, 0.55].forEach((y) => {
      const p = new THREE.Mesh(rbox(0.76, y > 1 ? 0.8 : 0.66, 0.03, 0.008), doorM);
      p.position.set(DX, y, FZ + 0.055);
      g.add(p);
    });
    const step = new THREE.Mesh(rbox(1.5, 0.16, 0.6, 0.04), stone);
    step.position.set(DX, 0.06, FZ + 0.32);
    g.add(step);
    shadowAll(g);
    g.position.set(HOUSE.x, 6.0, HOUSE.z);
    g.rotation.y = HOUSE.rot;
    ext.add(g);
  })();

  /* ---------- 海鷗 ---------- */
  // 一隻海鷗：紡錘形的身體、兩段式翅膀（內翼與外翼，拍動時成 M 字）、深色翼尖；翼展約 1.3 公尺。
  // 繞著塔飛的半徑與高度避開鏡頭路徑（燈塔那一章鏡頭在半徑約 50 公尺、高 24 公尺），太靠近鏡頭的那一隻就先藏起來
  interface Gull {
    g: THREE.Group;
    inner: THREE.Group[];
    outer: THREE.Group[];
    r: number;
    y: number;
    w: number;
    ph: number;
    f: number;
  }
  const gulls: Gull[] = [];
  (() => {
    const white = std({ color: 0xeceae5, roughness: 0.85, side: THREE.DoubleSide });
    const grey = std({ color: 0xa9adb3, roughness: 0.85, side: THREE.DoubleSide });
    const tip = std({ color: 0x24272b, roughness: 0.8, side: THREE.DoubleSide });
    const bodyG = new THREE.LatheGeometry(
      [
        [0, -0.24],
        [0.03, -0.2],
        [0.055, -0.08],
        [0.06, 0.04],
        [0.045, 0.14],
        [0.025, 0.2],
        [0, 0.23],
      ].map(([r, y]) => new THREE.Vector2(r, y)),
      10,
    );
    bodyG.rotateX(Math.PI / 2);
    const innerS = new THREE.Shape();
    innerS.moveTo(0, 0.08);
    innerS.quadraticCurveTo(0.2, 0.1, 0.34, 0.07);
    innerS.lineTo(0.34, -0.06);
    innerS.quadraticCurveTo(0.16, -0.09, 0, -0.07);
    innerS.lineTo(0, 0.08);
    const innerG = new THREE.ShapeGeometry(innerS, 6);
    innerG.rotateX(Math.PI / 2);
    const outerS = new THREE.Shape();
    outerS.moveTo(0, 0.07);
    outerS.quadraticCurveTo(0.2, 0.05, 0.34, -0.06);
    outerS.lineTo(0.3, -0.07);
    outerS.quadraticCurveTo(0.14, -0.06, 0, -0.06);
    outerS.lineTo(0, 0.07);
    const outerG = new THREE.ShapeGeometry(outerS, 6);
    outerG.rotateX(Math.PI / 2);
    const tipS = new THREE.Shape();
    tipS.moveTo(0.22, 0.035);
    tipS.quadraticCurveTo(0.3, 0.0, 0.34, -0.06);
    tipS.lineTo(0.3, -0.07);
    tipS.lineTo(0.22, -0.065);
    tipS.lineTo(0.22, 0.035);
    const tipG = new THREE.ShapeGeometry(tipS, 4);
    tipG.rotateX(Math.PI / 2);
    tipG.translate(0, 0.002, 0);
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(bodyG, white));
      const inner: THREE.Group[] = [];
      const outer: THREE.Group[] = [];
      [1, -1].forEach((side) => {
        const ig = new THREE.Group();
        ig.scale.x = side;
        ig.position.set(0, 0.02, 0.02);
        ig.add(new THREE.Mesh(innerG, grey));
        const og = new THREE.Group();
        og.position.x = 0.34;
        og.add(new THREE.Mesh(outerG, grey), new THREE.Mesh(tipG, tip));
        ig.add(og);
        g.add(ig);
        inner.push(ig);
        outer.push(og);
      });
      g.scale.setScalar(0.95);
      ext.add(g);
      gulls.push({ g, inner, outer, r: 15 + R() * 15, y: 11 + R() * 10, w: (0.11 + R() * 0.08) * (R() < 0.5 ? 1 : -1), ph: R() * TAU, f: 4.5 + R() * 2 });
    }
  })();

  /* ---------- 觀測室 ---------- */
  const paneCanvas = makeCanvas(256, 512);
  const paneTex = tex(paneCanvas);
  let paneDawn = -1;
  function drawPane(dawn: number) {
    const x = ctx2d(paneCanvas);
    const g = x.createLinearGradient(0, 0, 0, 512);
    const col = (i: number) => {
      const a = new THREE.Color(LOOKS[1].pane[i]);
      const b = new THREE.Color(LOOKS[3].pane[i]);
      return `#${a.lerp(b, dawn).getHexString()}`;
    };
    g.addColorStop(0, col(0));
    g.addColorStop(0.35, col(1));
    g.addColorStop(0.55, col(2));
    g.addColorStop(0.62, col(3));
    g.addColorStop(0.625, col(4));
    g.addColorStop(1, col(5));
    x.fillStyle = g;
    x.fillRect(0, 0, 256, 512);
    x.fillStyle = 'rgba(255,190,120,0.35)';
    x.fillRect(0, 322, 256, 2);
    paneTex.needsUpdate = true;
    paneDawn = dawn;
  }
  drawPane(0);

  const plasterC = makeCanvas(2048, 512);
  const px = ctx2d(plasterC);
  px.fillStyle = '#d4cab6';
  px.fillRect(0, 0, 2048, 512);
  overlayNoise(px, 2048, 512, NZ, 0.4, 3, 1.5);
  overlayNoise(px, 2048, 512, NZF, 0.16, 1, 1);
  for (let i = 0; i < 14; i++) {
    px.fillStyle = 'rgba(120,100,70,0.05)';
    px.fillRect(0, i * 37 + R() * 3, 2048, 2);
  }
  for (let i = 0; i < 40; i++) {
    const x = R() * 2048;
    const y = R() * 512;
    const r = 20 + R() * 120;
    const g = px.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(120,96,62,0.08)');
    g.addColorStop(1, 'rgba(120,96,62,0)');
    px.fillStyle = g;
    px.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  for (let i = 0; i < 60; i++) {
    const x = R() * 2048;
    const len = 20 + R() * 180;
    const g = px.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, 'rgba(90,76,58,0.12)');
    g.addColorStop(1, 'rgba(90,76,58,0)');
    px.fillStyle = g;
    px.fillRect(x, 0, 1 + R() * 3, len);
  }
  const plasterT = tex(plasterC, [1, 1]);
  const floorC = makeCanvas(1024, 1024);
  const fx = ctx2d(floorC);
  fx.fillStyle = '#4a3322';
  fx.fillRect(0, 0, 1024, 1024);
  const pw = 24;
  for (let r = 0; r * pw < 1024; r++) {
    let x = -R() * 200;
    while (x < 1024) {
      const len = 150 + R() * 230;
      const l = 26 + R() * 12;
      fx.fillStyle = `hsl(${24 + R() * 8},${34 + R() * 12}%,${l}%)`;
      fx.fillRect(x + 1, r * pw + 1, len - 2, pw - 2);
      if (R() < 0.08) {
        fx.fillStyle = 'rgba(40,22,10,0.35)';
        fx.beginPath();
        fx.ellipse(x + R() * len, r * pw + pw / 2, 6, 3, 0, 0, TAU);
        fx.fill();
      }
      x += len;
    }
  }
  overlayNoise(fx, 1024, 1024, NZ, 0.28, 2, 2);
  const floorT = tex(floorC);
  const wainC = makeCanvas(2048, 128);
  const wx = ctx2d(wainC);
  for (let i = 0; i < 158; i++) {
    wx.fillStyle = `hsl(${156 + R() * 6},${24 + R() * 6}%,${15 + R() * 3}%)`;
    wx.fillRect(i * 13, 0, 13, 128);
    wx.fillStyle = 'rgba(0,0,0,0.5)';
    wx.fillRect(i * 13, 0, 1.5, 128);
  }
  const wg2 = wx.createLinearGradient(0, 0, 0, 128);
  wg2.addColorStop(0, 'rgba(255,255,255,0.06)');
  wg2.addColorStop(0.85, 'rgba(0,0,0,0)');
  wg2.addColorStop(1, 'rgba(0,0,0,0.35)');
  wx.fillStyle = wg2;
  wx.fillRect(0, 0, 2048, 128);
  const wainT = tex(wainC);

  // 觀測室的環境遮蔽：房間形狀＋書桌、螢幕、椅子、書架這幾個方盒（室內所有材質共用）。
  // 牆上的看板與海圖不放方盒：它的遮蔽會在後牆上留下一塊比看板大一圈的暗色矩形（像一片掛在看板後面的板子）
  const DZ = -1.95;
  const DT = FL + 0.74;
  const MON_Y = DT + 0.36;
  const PZ = -2.84;
  const SHELF_A = 1.62;
  const aoUniforms = roomAoUniforms({
    radius: RR,
    floor: FL,
    ceiling: CE,
    boxes: [
      { c: [0, FL + 0.37, DZ], h: [1.15, 0.37, 0.4], range: 0.5 },
      { c: [0, MON_Y, -2.06], h: [0.98, 0.21, 0.06], range: 0.22 },
      { c: [1.62, FL + 0.47, 0.05], h: [0.25, 0.03, 0.25], range: 0.5 },
      { c: [Math.sin(SHELF_A) * (RR - 0.18), FL + 1.55, Math.cos(SHELF_A) * (RR - 0.18)], h: [0.12, 0.25, 0.45], range: 0.3 },
      { c: [-1.95, FL + 0.55, -0.8], h: [0.22, 0.55, 0.22], range: 0.3 },
    ],
  });
  const AO = { uniforms: aoUniforms, strength: 1, direct: 0.45 };
  const M = {
    // 室內的灰泥：凹凸比原本少四成（晨班的牆亮起來以後，強的凹凸會變成一面細碎的雜訊）
    plaster: detail(std({ map: plasterT, roughness: 0.93, envMapIntensity: 0.25, side: THREE.BackSide }), { scale: 1.6, bump: 1.5, albedo: 0.04, ao: AO }),
    plasterD: detail(std({ map: plasterT, roughness: 0.93, envMapIntensity: 0.25, side: THREE.DoubleSide }), { scale: 1.6, bump: 1.5, albedo: 0.04, ao: AO }),
    floor: detail(std({ map: floorT, roughness: 0.55, envMapIntensity: 0.35 }), { map: woodDet, scale: 1.4, bump: 1.4, albedo: 0.16, ao: AO }),
    ceil: detail(std({ map: floorT, color: 0x8d7a68, roughness: 0.8, envMapIntensity: 0.2, side: THREE.DoubleSide }), { map: woodDet, scale: 1.4, bump: 0.8, albedo: 0.1, ao: AO }),
    wain: detail(std({ map: wainT, roughness: 0.55, envMapIntensity: 0.35, side: THREE.BackSide }), { map: woodDet, scale: 2.4, bump: 1.6, albedo: 0.14, vertical: true, ao: AO }),
    // 胡桃木：不用模型的 UV（長桌板會被拉長），木紋整個由三向投影的細節貼圖給
    walnut: detail(std({ color: 0x4a2e1b, roughness: 0.46, envMapIntensity: 0.45 }), { map: woodDet, scale: 2.6, bump: 1.1, albedo: 0.42, ao: AO }),
    brass: std({ color: 0xb8893e, roughness: 0.3, metalness: 1, envMapIntensity: 0.9 }),
    black: std({ color: 0x121416, roughness: 0.45, metalness: 0.3, envMapIntensity: 0.5 }),
    iron: std({ color: 0x24282c, roughness: 0.55, metalness: 0.6, envMapIntensity: 0.5 }),
    green: detail(std({ color: 0x1f332c, roughness: 0.62, envMapIntensity: 0.4 }), { map: woodDet, scale: 3, bump: 0.6, albedo: 0.08, ao: AO }),
  };
  const walnutBase = M.walnut.color.clone();
  interface AddOpt {
    rx?: number;
    ry?: number;
    rz?: number;
    cast?: boolean;
    recv?: boolean;
  }
  function add(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, opt?: AddOpt) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (opt) {
      if (opt.rx) m.rotation.x = opt.rx;
      if (opt.ry) m.rotation.y = opt.ry;
      if (opt.rz) m.rotation.z = opt.rz;
      if (opt.cast !== false) m.castShadow = true;
      if (opt.recv !== false) m.receiveShadow = true;
    } else {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    parent.add(m);
    return m;
  }
  const room = new THREE.Group();
  int.add(room);
  const gap = 2 * Math.asin(WIN.w / 2 / RR);
  /** 左右兩扇側窗的方位（a = ±SIDE_A）；晨班的陽光從右邊那扇（+SIDE_A）斜斜照進來 */
  const SIDE_A = 2.1;
  // 牆：入口窗與兩扇側窗都是真的窗洞（牆會擋光，晨光只從窗洞進來）。UV 用整圈的角度與高度，灰泥不會在每一段被拉長
  function wallPiece(t0: number, t1: number, y0: number, y1: number) {
    const segs = Math.max(2, Math.round(((t1 - t0) / TAU) * 128));
    const g = new THREE.CylinderGeometry(RR, RR, y1 - y0, segs, 1, true, t0, t1 - t0);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      const th = t0 + uv.getX(i) * (t1 - t0);
      uv.setXY(i, th / TAU, (pos.getY(i) + (y0 + y1) / 2 - FL) / (CE - FL));
    }
    add(room, g, M.plaster, 0, (y0 + y1) / 2, 0);
  }
  // 相鄰的牆片多重疊一點點（陰影貼圖在接縫上不會漏出一條細光）
  const SEAM = 0.004;
  wallPiece(gap / 2 - SEAM, SIDE_A - gap / 2 + SEAM, FL, CE);
  wallPiece(SIDE_A + gap / 2 - SEAM, TAU - SIDE_A - gap / 2 + SEAM, FL, CE);
  wallPiece(TAU - SIDE_A + gap / 2 - SEAM, TAU - gap / 2 + SEAM, FL, CE);
  [0, SIDE_A, TAU - SIDE_A].forEach((h) => {
    wallPiece(h - gap / 2, h + gap / 2, WIN.top - SEAM, CE);
    wallPiece(h - gap / 2, h + gap / 2, FL, WIN.bot + SEAM);
  });
  add(room, new THREE.CylinderGeometry(RR - 0.025, RR - 0.025, 0.86, 128, 1, true), M.wain, 0, FL + 0.43, 0, { cast: false });
  add(room, new THREE.TorusGeometry(RR - 0.035, 0.028, 8, 160), M.walnut, 0, FL + 0.87, 0, { rx: Math.PI / 2, cast: false });
  add(room, new THREE.CylinderGeometry(RR - 0.02, RR - 0.02, 0.12, 128, 1, true), std({ color: 0x1a120c, roughness: 0.6, side: THREE.BackSide }), 0, FL + 0.06, 0, {
    cast: false,
  });
  // 入口窗洞內側
  (() => {
    const z0 = Math.sqrt(RR * RR - (WIN.w / 2) * (WIN.w / 2)) - 0.02;
    const z1 = PORTAL_Z + 0.001;
    const dz = z1 - z0;
    const zc = (z0 + z1) / 2;
    add(room, new THREE.PlaneGeometry(dz, WIN.h), M.plasterD, -WIN.w / 2, WIN.y, zc, { ry: Math.PI / 2, cast: false });
    add(room, new THREE.PlaneGeometry(dz, WIN.h), M.plasterD, WIN.w / 2, WIN.y, zc, { ry: -Math.PI / 2, cast: false });
    add(room, new THREE.PlaneGeometry(WIN.w, dz), M.plasterD, 0, WIN.top, zc, { rx: Math.PI / 2, cast: false });
    add(room, new RoundedBoxGeometry(WIN.w + 0.16, 0.05, dz + 0.14, 2, 0.012), M.walnut, 0, WIN.bot - 0.025, zc - 0.07);
  })();
  // 地板與天花板（天花板也擋光：晨光只能從窗洞進來）
  add(room, new THREE.CircleGeometry(RR, 96), M.floor, 0, FL, 0, { rx: -Math.PI / 2, cast: false });
  add(room, new THREE.CircleGeometry(RR + 0.25, 96), M.ceil, 0, CE, 0, { rx: Math.PI / 2 });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU + 0.16;
    add(room, new RoundedBoxGeometry(0.14, 0.18, RR - 0.35, 2, 0.015), M.walnut, Math.sin(a) * (RR / 2 + 0.15), CE - 0.09, Math.cos(a) * (RR / 2 + 0.15), { ry: a });
  }
  add(room, new THREE.CylinderGeometry(0.38, 0.38, 0.2, 32), M.walnut, 0, CE - 0.1, 0);
  // 側窗：窗洞有深度（窗框、窗台、內側的抹灰），玻璃外面是天色。窗框與窗洞內側會在晨光裡投下窗格的影子
  const skyPaneM = new THREE.MeshBasicMaterial({ map: paneTex, toneMapped: false, color: 0xb0a8a8, fog: false });
  const REVEAL = 0.3;
  [SIDE_A, -SIDE_A].forEach((a) => {
    const g = new THREE.Group();
    add(g, new THREE.PlaneGeometry(WIN.w, WIN.h), skyPaneM, 0, 0, -REVEAL, { cast: false, recv: false });
    add(g, new THREE.PlaneGeometry(REVEAL, WIN.h), M.plasterD, -WIN.w / 2, 0, -REVEAL / 2, { ry: Math.PI / 2 });
    add(g, new THREE.PlaneGeometry(REVEAL, WIN.h), M.plasterD, WIN.w / 2, 0, -REVEAL / 2, { ry: -Math.PI / 2 });
    add(g, new THREE.PlaneGeometry(WIN.w, REVEAL), M.plasterD, 0, WIN.h / 2, -REVEAL / 2, { rx: Math.PI / 2 });
    (
      [
        [0, WIN.h / 2 - 0.035, WIN.w, 0.07],
        [0, -WIN.h / 2 + 0.035, WIN.w, 0.07],
        [-WIN.w / 2 + 0.035, 0, 0.07, WIN.h],
        [WIN.w / 2 - 0.035, 0, 0.07, WIN.h],
        [0, WIN.h / 6, WIN.w, 0.035],
        [0, -WIN.h / 6, WIN.w, 0.035],
        [0, 0, 0.04, WIN.h],
      ] as const
    ).forEach(([x, y, w, h]) => add(g, new RoundedBoxGeometry(w, h, 0.05, 2, 0.008), M.green, x, y, -REVEAL + 0.05));
    add(g, new RoundedBoxGeometry(WIN.w + 0.2, 0.05, REVEAL + 0.12, 2, 0.012), M.walnut, 0, -WIN.h / 2 - 0.025, -REVEAL / 2 + 0.06);
    const r = RR;
    g.position.set(Math.sin(a) * r, WIN.y, Math.cos(a) * r);
    g.rotation.y = a + Math.PI;
    room.add(g);
  });
  // 書桌
  add(room, new RoundedBoxGeometry(2.3, 0.045, 0.8, 2, 0.012), M.walnut, 0, DT - 0.022, DZ);
  [-0.88, 0.88].forEach((x) => {
    add(room, new RoundedBoxGeometry(0.5, 0.7, 0.74, 2, 0.01), M.walnut, x, FL + 0.35, DZ);
    for (let k = 0; k < 3; k++) {
      add(room, new RoundedBoxGeometry(0.46, 0.2, 0.014, 2, 0.004), M.walnut, x, FL + 0.14 + k * 0.22, DZ + 0.372);
      add(room, new THREE.CylinderGeometry(0.008, 0.008, 0.1, 8), M.brass, x, FL + 0.16 + k * 0.22, DZ + 0.385, { rz: Math.PI / 2 });
    }
  });
  add(room, new THREE.BoxGeometry(1.26, 0.46, 0.02), M.walnut, 0, FL + 0.46, DZ - 0.36);

  // 三台螢幕：機身（邊框、黑玻璃、腳座）固定在桌上；畫面（face）是另一層，交接時帶著自己的一圈邊框離開機身，排成下方觀測台的三欄。
  // 每塊畫面有兩張貼圖：桌上的（16:9、大字）與終點的（觀測台那一欄的排法），升起時交叉淡化
  const screens = createScreenCanvases(screenSizes);
  const glassOff = std({ color: 0x07090b, roughness: 0.12, metalness: 0.0, envMapIntensity: 0.9 });
  const unitPlane = new THREE.PlaneGeometry(1, 1);
  const faceScene = new THREE.Scene();
  interface Face {
    key: FaceKey;
    g: THREE.Group;
    /** 終點的畫面（觀測台那一欄） */
    scr: THREE.Mesh;
    mat: THREE.MeshBasicMaterial;
    tex: THREE.CanvasTexture;
    /** 桌上的畫面（疊在終點畫面前面，升起時淡出） */
    desk: THREE.Mesh;
    deskMat: THREE.MeshBasicMaterial;
    deskTex: THREE.CanvasTexture;
    /** 跟著畫面離開機身的邊框：一開始疊在機身的邊框上，交接時收成 1px 的分隔線 */
    rule: THREE.Mesh;
    ruleMat: THREE.MeshBasicMaterial;
    /** 面板底色（--card）：桌上的字淡出、觀測台的字淡入之間露出來的那一層 */
    card: THREE.Mesh;
    cardMat: THREE.MeshBasicMaterial;
    w: number;
    h: number;
    homePos: THREE.Vector3;
    homeQuat: THREE.Quaternion;
    /** 這一格邊框的寬度（px，驗證用） */
    bezelPx: number;
  }
  const faces: Face[] = [];
  function monitor(key: FaceKey, w: number, h: number, x: number, y: number, z: number, ry: number, rx: number) {
    const body = new THREE.Group();
    body.position.set(x, y, z);
    body.rotation.set(rx, ry, 0, 'YXZ');
    room.add(body);
    add(body, new RoundedBoxGeometry(w + 2 * BEZEL_M, h + 2 * BEZEL_M, 0.028, 2, 0.005), M.black, 0, 0, 0);
    add(body, new RoundedBoxGeometry(w * 0.5, h * 0.45, 0.035, 2, 0.008), M.black, 0, 0, -0.03);
    add(body, new THREE.PlaneGeometry(w, h), glassOff, 0, 0, 0.0142, { cast: false });
    const t = tex(screens.end[key]);
    const dt = tex(screens.desk[key]);
    // 螢幕不受室內光影響（toneMapped false 時光照不會被曝光壓暗），亮度只看 color；也不吃霧。
    // 四層都走透明的那一條：交接時關掉深度測試，畫的順序只看 renderOrder（邊框 → 面板底色 → 終點畫面 → 桌上畫面）
    const mat = keep(new THREE.MeshBasicMaterial({ color: 0x000000, map: t, toneMapped: false, fog: false, transparent: true, opacity: 1, depthWrite: false }));
    const deskMat = keep(new THREE.MeshBasicMaterial({ color: 0x000000, map: dt, toneMapped: false, fog: false, transparent: true, opacity: 1, depthWrite: false }));
    const ruleMat = keep(new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false, fog: false, transparent: true, opacity: 0, depthWrite: false }));
    const cardMat = keep(new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false, fog: false, transparent: true, opacity: 0, depthWrite: false }));
    const g = new THREE.Group();
    faceScene.add(g);
    const rule = new THREE.Mesh(unitPlane, ruleMat);
    rule.renderOrder = 0;
    g.add(rule);
    const card = new THREE.Mesh(unitPlane, cardMat);
    card.renderOrder = 1;
    g.add(card);
    const scr = new THREE.Mesh(unitPlane, mat);
    scr.renderOrder = 2;
    g.add(scr);
    const desk = new THREE.Mesh(unitPlane, deskMat);
    desk.renderOrder = 3;
    g.add(desk);
    body.updateMatrixWorld(true);
    const homePos = body.localToWorld(V3(0, 0, 0.0152));
    const homeQuat = new THREE.Quaternion().setFromEuler(body.rotation);
    g.position.copy(homePos);
    g.quaternion.copy(homeQuat);
    scr.scale.set(w, h, 1);
    desk.scale.set(w, h, 1);
    rule.scale.set(w + 2 * BEZEL_M, h + 2 * BEZEL_M, 1);
    card.scale.set(w, h, 1);
    const f: Face = { key, g, scr, mat, tex: t, desk, deskMat, deskTex: dt, rule, ruleMat, card, cardMat, w, h, homePos, homeQuat, bezelPx: 0 };
    faces.push(f);
    return f;
  }
  const monC = monitor('center', 0.7, 0.394, 0, MON_Y, -2.12, 0, -0.1);
  monitor('left', 0.6, 0.338, -0.655, MON_Y - 0.02, -2.0, 0.42, -0.08);
  monitor('right', 0.6, 0.338, 0.655, MON_Y - 0.02, -2.0, -0.42, -0.08);
  (
    [
      [0, -2.14],
      [-0.66, -2.03],
      [0.66, -2.03],
    ] as const
  ).forEach(([x, z]) => {
    add(room, new RoundedBoxGeometry(0.05, 0.2, 0.03, 2, 0.006), M.black, x, DT + 0.1, z - 0.03);
    add(room, new RoundedBoxGeometry(0.24, 0.014, 0.17, 2, 0.005), M.black, x, DT + 0.007, z);
  });
  // 鍵盤、滑鼠、馬克杯、日誌、筆
  (() => {
    const kc = makeCanvas(512, 168);
    const kx = ctx2d(kc);
    kx.fillStyle = '#16181b';
    kx.fillRect(0, 0, 512, 168);
    const kw = 512 / 15.5;
    for (let r = 0; r < 5; r++) {
      let x = 6;
      for (let c = 0; c < 15; c++) {
        const w = r === 4 && c === 5 ? kw * 5 : kw;
        if (r === 4 && c > 5 && c < 10) continue;
        kx.fillStyle = '#2a2d31';
        kx.fillRect(x + 2, 8 + r * 31, w - 4, 26);
        kx.fillStyle = 'rgba(255,255,255,0.05)';
        kx.fillRect(x + 2, 8 + r * 31, w - 4, 3);
        x += w;
        if (x > 506) break;
      }
    }
    add(room, new RoundedBoxGeometry(0.44, 0.02, 0.15, 2, 0.006), M.black, 0, DT + 0.01, -1.72);
    add(room, new THREE.PlaneGeometry(0.43, 0.14), std({ map: tex(kc), roughness: 0.6 }), 0, DT + 0.0205, -1.72, { rx: -Math.PI / 2, cast: false });
    const mouse = add(room, new THREE.SphereGeometry(0.03, 16, 10), M.black, 0.33, DT + 0.012, -1.72);
    mouse.scale.set(1.1, 0.55, 1.8);
    const mug = std({ color: 0xe8e2d6, roughness: 0.35, envMapIntensity: 0.6 });
    add(room, new THREE.CylinderGeometry(0.045, 0.04, 0.1, 32), mug, 0.66, DT + 0.05, -1.68);
    add(room, new THREE.TorusGeometry(0.028, 0.008, 8, 20), mug, 0.713, DT + 0.05, -1.68, { ry: Math.PI / 2 });
    add(room, new THREE.CircleGeometry(0.041, 24), std({ color: 0x1c0f07, roughness: 0.15 }), 0.66, DT + 0.092, -1.68, { rx: -Math.PI / 2, cast: false });
    // 日誌：只記跟燈塔有關的中性內容，不寫任何行情判斷
    const pc = makeCanvas(256, 384);
    const pq = ctx2d(pc);
    pq.fillStyle = '#ece3cc';
    pq.fillRect(0, 0, 256, 384);
    pq.strokeStyle = 'rgba(70,110,160,0.35)';
    for (let y = 40; y < 384; y += 18) {
      pq.beginPath();
      pq.moveTo(10, y);
      pq.lineTo(246, y);
      pq.stroke();
    }
    pq.strokeStyle = 'rgba(180,60,60,0.4)';
    pq.beginPath();
    pq.moveTo(34, 0);
    pq.lineTo(34, 384);
    pq.stroke();
    pq.fillStyle = '#233a66';
    pq.font = `italic 17px ${SERIF}`;
    ['晴 · 東北風 3 級', '燈質正常 Fl W 10s', '——', '僅記錄已儲存的收盤'].forEach((t, i) => pq.fillText(t, 40, 36 + i * 36));
    const pages = std({ map: tex(pc), roughness: 0.85 });
    add(room, new RoundedBoxGeometry(0.34, 0.01, 0.24, 2, 0.003), std({ color: 0x5a1f1a, roughness: 0.6 }), -0.5, DT + 0.005, -1.66, { ry: 0.14 });
    add(room, new THREE.BoxGeometry(0.16, 0.012, 0.23), pages, -0.585, DT + 0.012, -1.672, { ry: 0.14, rz: 0.03 });
    add(room, new THREE.BoxGeometry(0.16, 0.012, 0.23), pages, -0.418, DT + 0.012, -1.648, { ry: 0.14, rz: -0.03 });
    add(room, new THREE.CylinderGeometry(0.004, 0.004, 0.14, 8), M.brass, -0.38, DT + 0.022, -1.62, { rz: Math.PI / 2, ry: 0.6 });
  })();
  // 銀行家檯燈
  const bankLight = new THREE.SpotLight(0xffd49a, BANK_LAMP, 2.4, 0.95, 0.6, 2);
  const bankShade = std({
    color: 0x0e5a3a,
    emissive: 0x0a3d26,
    emissiveIntensity: 0.6,
    roughness: 0.15,
    metalness: 0.1,
    envMapIntensity: 1.2,
    side: THREE.DoubleSide,
  });
  const bankBulb = new THREE.MeshBasicMaterial({ color: 0xfff0d0, toneMapped: false, fog: false });
  (() => {
    // 檯燈放在桌子左前角：從正面推近時不會擋住左邊那台螢幕
    const x = -1.06;
    const z = -1.64;
    add(room, new THREE.CylinderGeometry(0.07, 0.085, 0.026, 32), M.brass, x, DT + 0.013, z);
    add(room, new THREE.CylinderGeometry(0.009, 0.009, 0.3, 12), M.brass, x, DT + 0.16, z);
    add(room, new THREE.CylinderGeometry(0.075, 0.075, 0.26, 32, 1, true, -Math.PI / 2, Math.PI), bankShade, x, DT + 0.32, z, { rz: Math.PI / 2, ry: 0.5 });
    add(room, new THREE.CylinderGeometry(0.016, 0.016, 0.18, 12), bankBulb, x, DT + 0.29, z, { rz: Math.PI / 2, ry: 0.5, cast: false });
    bankLight.position.set(x, DT + 0.27, z);
    bankLight.target.position.set(x + 0.12, DT, z + 0.1);
    // 夜班的主光：鍵盤、日誌、螢幕腳座在桌面上留下影子
    bankLight.castShadow = true;
    bankLight.shadow.mapSize.set(low ? 512 : 1024, low ? 512 : 1024);
    bankLight.shadow.bias = -0.0015;
    bankLight.shadow.radius = 3;
    bankLight.shadow.camera.near = 0.02;
    bankLight.shadow.camera.far = 2.4;
    room.add(bankLight, bankLight.target);
  })();
  // 椅子
  (() => {
    // 椅子推開到右邊靠牆（晨班的桌前鏡頭往右看，椅子不能擋在畫面前景）
    const g = new THREE.Group();
    g.position.set(1.62, FL, 0.05);
    g.rotation.y = -1.25;
    room.add(g);
    add(g, new RoundedBoxGeometry(0.46, 0.045, 0.44, 2, 0.012), M.walnut, 0, 0.46, 0);
    (
      [
        [-0.2, -0.19],
        [0.2, -0.19],
        [-0.2, 0.19],
        [0.2, 0.19],
      ] as const
    ).forEach(([x, z]) => add(g, new THREE.CylinderGeometry(0.018, 0.016, 0.46, 12), M.walnut, x, 0.23, z));
    [-0.19, 0.19].forEach((x) => add(g, new THREE.CylinderGeometry(0.016, 0.016, 0.5, 12), M.walnut, x, 0.72, 0.2));
    for (let i = 0; i < 4; i++) add(g, new THREE.CylinderGeometry(0.01, 0.01, 0.42, 8), M.walnut, -0.114 + i * 0.076, 0.7, 0.2);
    add(g, new RoundedBoxGeometry(0.48, 0.07, 0.05, 2, 0.015), M.walnut, 0, 0.95, 0.2);
  })();
  // 原型的錶頭板（VIX、情緒、成交值都是假資料）換成一張裱框海圖：燈塔島的等高線與羅盤，不寫任何數字
  const PY = 31.1;
  (() => {
    const W = 1024;
    const H = 400;
    const c = makeCanvas(W, H);
    const x = ctx2d(c);
    x.fillStyle = '#e9dfc6';
    x.fillRect(0, 0, W, H);
    overlayNoise(x, W, H, NZF, 0.12, 1, 1, 'multiply');
    // 等高線：島的形狀
    const cx = W * 0.42;
    const cy = H * 0.52;
    const scale = 2.6;
    [0, 2, 4, 6].forEach((lvl, k) => {
      x.fillStyle = k === 0 ? 'rgba(160,140,100,0.25)' : 'rgba(150,120,80,0.12)';
      for (let j = 0; j < H; j += 3)
        for (let i = 0; i < W; i += 3) {
          const wx2 = (i - cx) / scale;
          const wz = (j - cy) / scale;
          if (Math.abs(wx2) > 65 || Math.abs(wz) > 65) continue;
          if (islandH(wx2, wz) > lvl) x.fillRect(i, j, 3, 3);
        }
    });
    // 羅盤與航向線
    x.strokeStyle = 'rgba(120,60,50,0.35)';
    x.lineWidth = 1.5;
    const rx2 = W * 0.82;
    const ry2 = H * 0.5;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      x.beginPath();
      x.moveTo(rx2, ry2);
      x.lineTo(rx2 + Math.cos(a) * W, ry2 + Math.sin(a) * W);
      x.stroke();
    }
    x.strokeStyle = 'rgba(60,40,30,0.8)';
    x.lineWidth = 2;
    x.beginPath();
    x.arc(rx2, ry2, 90, 0, TAU);
    x.stroke();
    x.beginPath();
    x.arc(rx2, ry2, 72, 0, TAU);
    x.stroke();
    x.fillStyle = 'rgba(60,40,30,0.85)';
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU - Math.PI / 2;
      x.beginPath();
      x.moveTo(rx2 + Math.cos(a) * 88, ry2 + Math.sin(a) * 88);
      x.lineTo(rx2 + Math.cos(a + 0.25) * 18, ry2 + Math.sin(a + 0.25) * 18);
      x.lineTo(rx2 + Math.cos(a - 0.25) * 18, ry2 + Math.sin(a - 0.25) * 18);
      x.closePath();
      x.fill();
    }
    // 燈塔位置：燈色的星號
    x.fillStyle = '#b9801f';
    x.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU - Math.PI / 2;
      const rr = i % 2 ? 6 : 15;
      x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    x.closePath();
    x.fill();
    x.strokeStyle = 'rgba(60,40,30,0.6)';
    x.lineWidth = 3;
    x.strokeRect(10, 10, W - 20, H - 20);
    add(room, new RoundedBoxGeometry(1.1, 0.46, 0.035, 2, 0.008), M.walnut, 0, PY, PZ);
    add(room, new THREE.PlaneGeometry(1.02, 0.4), std({ map: tex(c), roughness: 0.75, envMapIntensity: 0.3 }), 0, PY, PZ + 0.019, { cast: false });
  })();
  // 時鐘：台北時間
  const clock = (() => {
    const g = new THREE.Group();
    const x = 1.2;
    const z = -Math.sqrt(RR * RR - 1.44) + 0.07;
    g.position.set(x, 31.3, z);
    g.rotation.y = Math.atan2(-x, -z);
    room.add(g);
    add(g, new THREE.CylinderGeometry(0.15, 0.15, 0.05, 48), M.brass, 0, 0, 0, { rx: Math.PI / 2 });
    add(g, new THREE.TorusGeometry(0.143, 0.014, 12, 64), M.brass, 0, 0, 0.027);
    const c = makeCanvas(512, 512);
    const q = ctx2d(c);
    q.fillStyle = '#f1ead8';
    q.fillRect(0, 0, 512, 512);
    overlayNoise(q, 512, 512, NZF, 0.12, 1, 1, 'multiply');
    q.fillStyle = '#1d1a16';
    q.textAlign = 'center';
    q.textBaseline = 'middle';
    q.font = `900 44px ${SERIF}`;
    for (let i = 1; i <= 12; i++) {
      const a = (i / 12) * TAU;
      q.fillText(String(i), 256 + Math.sin(a) * 176, 256 - Math.cos(a) * 176);
    }
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * TAU;
      const r0 = i % 5 ? 214 : 204;
      q.lineWidth = i % 5 ? 2 : 5;
      q.strokeStyle = '#1d1a16';
      q.beginPath();
      q.moveTo(256 + Math.sin(a) * r0, 256 - Math.cos(a) * r0);
      q.lineTo(256 + Math.sin(a) * 226, 256 - Math.cos(a) * 226);
      q.stroke();
    }
    q.font = `500 18px ${MONO}`;
    q.fillStyle = '#6b5a3c';
    q.fillText('TAIPEI · UTC+8', 256, 330);
    add(g, new THREE.CircleGeometry(0.135, 64), std({ map: tex(c), roughness: 0.6, envMapIntensity: 0.3 }), 0, 0, 0.026, { cast: false });
    const hm = std({ color: 0x151515, roughness: 0.4 });
    const hp = new THREE.Group();
    const mp = new THREE.Group();
    hp.position.z = 0.03;
    mp.position.z = 0.032;
    g.add(hp, mp);
    add(hp, new THREE.BoxGeometry(0.008, 0.07, 0.002), hm, 0, 0.028, 0, { cast: false });
    add(mp, new THREE.BoxGeometry(0.005, 0.105, 0.002), hm, 0, 0.045, 0, { cast: false });
    return { hp, mp };
  })();
  // 晴雨錶：跟時鐘一左一右，指針停在「晴」（日誌第一行寫的就是晴）。只是室內陳設，不代表任何行情
  (() => {
    const g = new THREE.Group();
    const x = -1.22;
    const z = -Math.sqrt(RR * RR - x * x) + 0.07;
    g.position.set(x, 31.22, z);
    g.rotation.y = Math.atan2(-x, -z);
    room.add(g);
    add(g, new THREE.CylinderGeometry(0.17, 0.17, 0.05, 48), M.walnut, 0, 0, 0, { rx: Math.PI / 2 });
    add(g, new THREE.TorusGeometry(0.135, 0.012, 12, 64), M.brass, 0, 0, 0.027);
    const c = makeCanvas(512, 512);
    const q = ctx2d(c);
    q.fillStyle = '#efe6cf';
    q.fillRect(0, 0, 512, 512);
    overlayNoise(q, 512, 512, NZF, 0.12, 1, 1, 'multiply');
    q.strokeStyle = '#2a2219';
    q.lineWidth = 3;
    q.beginPath();
    q.arc(256, 256, 190, Math.PI * 0.75, Math.PI * 2.25);
    q.stroke();
    for (let i = 0; i <= 30; i++) {
      const a = Math.PI * 0.75 + (i / 30) * Math.PI * 1.5;
      const r0 = i % 5 ? 178 : 166;
      q.lineWidth = i % 5 ? 2 : 4;
      q.beginPath();
      q.moveTo(256 + Math.cos(a) * r0, 256 + Math.sin(a) * r0);
      q.lineTo(256 + Math.cos(a) * 190, 256 + Math.sin(a) * 190);
      q.stroke();
    }
    q.fillStyle = '#2a2219';
    q.textAlign = 'center';
    q.textBaseline = 'middle';
    q.font = `900 46px ${SERIF}`;
    (
      [
        ['雨', Math.PI * 0.95],
        ['變', Math.PI * 1.5],
        ['晴', Math.PI * 2.05],
      ] as const
    ).forEach(([t, a]) => q.fillText(t, 256 + Math.cos(a) * 128, 256 + Math.sin(a) * 128));
    // 指針
    const na = Math.PI * 2.05;
    q.strokeStyle = '#1a1612';
    q.lineWidth = 6;
    q.beginPath();
    q.moveTo(256 - Math.cos(na) * 40, 256 - Math.sin(na) * 40);
    q.lineTo(256 + Math.cos(na) * 170, 256 + Math.sin(na) * 170);
    q.stroke();
    q.fillStyle = '#b8893e';
    q.beginPath();
    q.arc(256, 256, 14, 0, TAU);
    q.fill();
    add(g, new THREE.CircleGeometry(0.128, 64), std({ map: tex(c), roughness: 0.55, envMapIntensity: 0.3 }), 0, 0, 0.026, { cast: false });
  })();
  // 牆上看板：靜態顯示最近儲存的收盤（原型是模擬報價的跑馬燈）
  const boardTex = tex(screens.board);
  const BOARD_Y = 31.49;
  // 交接時看板跟著房間暗下去（數字交給升起的三欄，不在畫面上方跟它們搶）
  const boardMat = new THREE.MeshBasicMaterial({ map: boardTex, toneMapped: false, fog: false });
  add(room, new RoundedBoxGeometry(1.54, 0.24, 0.05, 2, 0.008), M.black, 0, BOARD_Y, PZ + 0.005);
  add(
    room,
    new THREE.PlaneGeometry(1.46, (1.46 * screens.board.height) / screens.board.width),
    boardMat,
    0,
    BOARD_Y,
    PZ + 0.031,
    { cast: false },
  );
  // 吊燈
  const pend = new THREE.PointLight(0xffc27e, PENDANT, 9, 2);
  const pendBulb = new THREE.MeshBasicMaterial({ color: 0xfff0d8, toneMapped: false, fog: false });
  (() => {
    const x = 0;
    const z = -0.7;
    const y = 32.2;
    add(room, new THREE.CylinderGeometry(0.006, 0.006, CE - y - 0.15, 6), M.black, x, (CE + y + 0.15) / 2, z, { cast: false });
    add(room, new THREE.ConeGeometry(0.2, 0.16, 32, 1, true), std({ color: 0x1f332c, roughness: 0.4, metalness: 0.2, side: THREE.DoubleSide }), x, y + 0.08, z, { cast: false });
    add(room, new THREE.SphereGeometry(0.045, 16, 12), pendBulb, x, y + 0.02, z, { cast: false });
    pend.position.set(x, y - 0.02, z);
    pend.castShadow = true;
    pend.shadow.mapSize.set(low ? 512 : 1024, low ? 512 : 1024);
    pend.shadow.bias = -0.003;
    pend.shadow.radius = 4;
    pend.shadow.camera.near = 0.05;
    pend.shadow.camera.far = 8;
    room.add(pend);
  })();
  // 通往燈籠的梯子
  (() => {
    const a = 2.0;
    const r = 2.5;
    const g = new THREE.Group();
    g.position.set(Math.sin(a) * r, FL, Math.cos(a) * r);
    g.rotation.y = a + Math.PI;
    room.add(g);
    [-0.22, 0.22].forEach((x) => add(g, new RoundedBoxGeometry(0.04, 3.6, 0.06, 2, 0.008), M.iron, x, 1.75, -0.25, { rx: -0.14 }));
    for (let i = 0; i < 11; i++) {
      const y = 0.28 + i * 0.3;
      add(g, new THREE.CylinderGeometry(0.014, 0.014, 0.44, 8), M.iron, 0, y, -0.25 - (y - 1.75) * Math.sin(0.14), { rz: Math.PI / 2 });
    }
    add(room, new THREE.BoxGeometry(0.8, 0.02, 0.8), new THREE.MeshBasicMaterial({ color: 0x07080a }), Math.sin(a) * (r + 0.05), CE - 0.005, Math.cos(a) * (r + 0.05), {
      ry: a,
      cast: false,
    });
  })();
  // 書架
  (() => {
    const r = RR - 0.18;
    const g = new THREE.Group();
    g.position.set(Math.sin(SHELF_A) * r, FL + 1.35, Math.cos(SHELF_A) * r);
    g.rotation.y = SHELF_A + Math.PI;
    room.add(g);
    add(g, new RoundedBoxGeometry(0.9, 0.03, 0.24, 2, 0.006), M.walnut, 0, 0, 0);
    add(g, new RoundedBoxGeometry(0.9, 0.03, 0.24, 2, 0.006), M.walnut, 0, 0.42, 0);
    let x = -0.42;
    const cs = [0x6b2a22, 0x2b3f5a, 0x4f5a33, 0x7a6038, 0x3b2a3f, 0x8a7a5a, 0x1f3a33];
    while (x < 0.4) {
      const w = 0.025 + R() * 0.035;
      const h = 0.24 + R() * 0.12;
      add(g, new RoundedBoxGeometry(w, h, 0.18, 2, 0.004), std({ color: cs[Math.floor(R() * cs.length)], roughness: 0.7 }), x + w / 2, 0.015 + h / 2, 0, { rz: x > 0.3 ? -0.25 : 0 });
      x += w + 0.004;
    }
  })();
  // 黃銅望遠鏡
  (() => {
    const g = new THREE.Group();
    g.position.set(-1.95, FL, -0.8);
    room.add(g);
    const top = 1.1;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU;
      const leg = add(g, new THREE.CylinderGeometry(0.014, 0.018, 1.18, 8), M.walnut, Math.sin(a) * 0.2, top / 2, Math.cos(a) * 0.2);
      leg.rotation.set(Math.cos(a) * 0.2, 0, -Math.sin(a) * 0.2);
    }
    const tube = new THREE.Group();
    tube.position.y = top + 0.04;
    tube.rotation.set(0, 2.27, 0);
    g.add(tube);
    add(tube, new THREE.CylinderGeometry(0.04, 0.055, 0.95, 24), M.brass, 0, 0, 0, { rz: Math.PI / 2 + 0.2 });
    add(tube, new THREE.CylinderGeometry(0.06, 0.06, 0.08, 24), M.brass, -0.44, -0.09, 0, { rz: Math.PI / 2 + 0.2 });
  })();
  // 其餘室內材質（黃銅、鐵件、書背…）只加環境遮蔽
  (() => {
    const done = new Set<THREE.Material>(Object.values(M).filter((m) => m.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey));
    room.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (!mat || done.has(mat) || !(mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) return;
      done.add(mat);
      detail(mat as THREE.MeshStandardMaterial, { scale: 1, bump: 0, albedo: 0, ao: AO });
    });
  })();

  // 室內光：夜班由檯燈（暖色主光）、螢幕（冷色補光）與吊燈照亮，牆角留暗；
  // 晨班的主光是從右邊側窗斜射進來的低角度陽光（會投影：窗格、螢幕、檯燈的影子落在桌面與後牆），
  // 天光（半球光）只是很淡的冷色補光，再加一盞照在光斑附近的暖色反射光。
  const intHemi = new THREE.HemisphereLight(NIGHT.intHemiSky, NIGHT.intHemiGround, NIGHT.intHemiIntensity);
  int.add(intHemi);
  const winLight = new THREE.DirectionalLight(NIGHT.intWindowColor, NIGHT.intWindowIntensity);
  winLight.position.set(0, 34, 9);
  winLight.target.position.set(0, 30, -2);
  int.add(winLight, winLight.target);
  const sideLight = new THREE.DirectionalLight(NIGHT.sideWindowColor, NIGHT.sideWindowIntensity);
  sideLight.position.set(Math.sin(SIDE_A) * 6, WIN.y + 1.4, Math.cos(SIDE_A) * 6);
  sideLight.target.position.set(-0.8, FL + 0.5, -1.0);
  int.add(sideLight, sideLight.target);
  // 晨光：從窗外遠處照進來的聚光燈（有距離衰減，靠窗亮、往房間深處暗），陰影柔邊
  const sunWin = V3(Math.sin(SIDE_A) * RR, WIN.y, Math.cos(SIDE_A) * RR);
  const sunDir = V3(-0.86, -0.42, -0.28).normalize();
  const sunKey = new THREE.SpotLight(NIGHT.intSunColor, 0, 0, 0.36, 0.45, 2);
  sunKey.position.copy(sunWin).addScaledVector(sunDir, -4.2);
  sunKey.target.position.copy(sunWin).addScaledVector(sunDir, 3.2);
  sunKey.castShadow = true;
  sunKey.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
  sunKey.shadow.radius = 6;
  sunKey.shadow.bias = -0.0004;
  sunKey.shadow.normalBias = 0.015;
  sunKey.shadow.camera.near = 2;
  sunKey.shadow.camera.far = 12;
  int.add(sunKey, sunKey.target);
  const bounce = new THREE.PointLight(0xffcfa0, 0, 3.4, 2);
  bounce.position.copy(sunWin).addScaledVector(sunDir, 2.6).add(V3(0, 0.25, 0.35));
  int.add(bounce);
  // 螢幕的冷光：前面一盞照桌面與鍵盤（距離短，不會穿過桌子照到地板），後面一盞在牆上留一圈光暈
  const monGlow = new THREE.PointLight(0x9fbcff, 0, 1.25, 2);
  monGlow.position.set(0, DT + 0.3, -1.84);
  room.add(monGlow);
  const monHalo = new THREE.PointLight(0x8fb0ff, 0, 1.1, 2);
  monHalo.position.set(0, MON_Y + 0.05, -2.5);
  room.add(monHalo);
  // 檯燈燈罩下溢出的暖光：照亮桌面左半與後牆上的一圈
  const lampPool = new THREE.PointLight(0xffb36a, 0, 2.8, 2);
  lampPool.position.set(-0.96, DT + 0.22, -1.78);
  room.add(lampPool);
  int.background = new THREE.Color(0x0d1015);
  int.environmentIntensity = NIGHT.intEnv;
  // 室內的空氣：夜班是暗暖色、晨班是帶點藍的晨霧，越深越淡（跟室外的遠景霧氣同一個感覺）
  const intFog = new THREE.Fog(NIGHT.intFog, NIGHT.intFogNear, NIGHT.intFogFar);
  int.fog = intFog;

  // 晨光的光柱與灰塵：沿著陽光方向的一個盒子，在 shader 裡沿視線積分（邊緣柔和、越往房間深處越淡）
  const shaftUniforms: Uniforms = {
    uCamLocal: { value: V3() },
    uI: { value: 0 },
    uColor: { value: new THREE.Color(1.0, 0.86, 0.68) },
    uTime: { value: 0 },
  };
  const SHAFT_LEN = 3.6;
  const shaft = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    keep(
      new THREE.ShaderMaterial({
        uniforms: shaftUniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.FrontSide,
        fog: false,
        vertexShader: /* glsl */ `varying vec3 vLocal;void main(){vLocal=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
        fragmentShader: /* glsl */ `uniform vec3 uCamLocal;uniform float uI;uniform vec3 uColor;uniform float uTime;varying vec3 vLocal;
          float dens(vec3 p){
            float e=(1.0-smoothstep(0.26,0.5,abs(p.x)))*(1.0-smoothstep(0.3,0.5,abs(p.y)));
            float z=p.z+0.5;
            float f=smoothstep(0.0,0.06,z)*exp(-z*1.7);
            float n=0.75+0.25*sin(p.x*23.0+p.y*7.0+uTime*0.2)*sin(p.y*17.0-p.z*11.0+uTime*0.13);
            return e*f*n;
          }
          void main(){
            vec3 ro=uCamLocal;vec3 rd=normalize(vLocal-ro);
            vec3 inv=1.0/rd;vec3 t0=(-0.5-ro)*inv;vec3 t1=(0.5-ro)*inv;
            vec3 tmin=min(t0,t1);vec3 tmax=max(t0,t1);
            float a=max(max(tmin.x,tmin.y),max(tmin.z,0.0));float b=min(min(tmax.x,tmax.y),tmax.z);
            if(b<=a)discard;
            float s=0.0;float st=(b-a)/8.0;
            for(int i=0;i<8;i++){s+=dens(ro+rd*(a+st*(float(i)+0.5)));}
            s*=st;
            gl_FragColor=vec4(uColor*s*uI,1.0);
          }`,
      }),
    ),
  );
  shaft.renderOrder = 5;
  (() => {
    const zAxis = sunDir.clone();
    const yAxis = V3(0, 1, 0).sub(zAxis.clone().multiplyScalar(zAxis.y)).normalize();
    const xAxis = V3().crossVectors(yAxis, zAxis);
    shaft.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
    shaft.position.copy(sunWin).addScaledVector(sunDir, SHAFT_LEN / 2 - 0.15);
    shaft.scale.set(0.82, 1.62, SHAFT_LEN);
  })();
  int.add(shaft);
  const dust = (() => {
    const N = low ? 60 : 140;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    const DR = mulberry32(5);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (DR() - 0.5) * 0.8;
      pos[i * 3 + 1] = (DR() - 0.5) * 0.9;
      pos[i * 3 + 2] = DR() * 0.8 - 0.5;
      seed[i] = DR();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const mat = keep(
      new THREE.ShaderMaterial({
        uniforms: { uI: shaftUniforms.uI, uTime: shaftUniforms.uTime, uScale: { value: 1 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
        vertexShader: /* glsl */ `attribute float aSeed;uniform float uTime;uniform float uScale;varying float vA;
          void main(){
            vec3 p=position;
            float t=uTime*(0.02+aSeed*0.03);
            p.y=fract(p.y+0.5+t)-0.5;
            p.x+=sin(uTime*0.3+aSeed*40.0)*0.03;
            p.z+=cos(uTime*0.23+aSeed*27.0)*0.02;
            vA=(1.0-smoothstep(0.25,0.5,abs(p.x)))*(1.0-smoothstep(0.3,0.5,abs(p.y)))*exp(-(p.z+0.5)*2.0)*(0.4+0.6*aSeed);
            vec4 mv=modelViewMatrix*vec4(p,1.0);
            gl_PointSize=uScale*(1.2+aSeed*1.6)/max(0.3,-mv.z);
            gl_Position=projectionMatrix*mv;
          }`,
        fragmentShader: /* glsl */ `uniform float uI;varying float vA;void main(){vec2 c=gl_PointCoord-0.5;float d=1.0-smoothstep(0.2,0.5,length(c));gl_FragColor=vec4(vec3(1.0,0.9,0.75)*d*vA*uI*0.9,1.0);}`,
      }),
    );
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    shaft.add(pts);
    return mat;
  })();

  /* ---------- 交接：溶成頁面底色的那一層 ---------- */
  const fadeScene = new THREE.Scene();
  const fadeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const fadeMat = keep(new THREE.MeshBasicMaterial({ color: 0x080b0f, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
  const fadeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fadeMat);
  fadeQuad.frustumCulled = false;
  fadeScene.add(fadeQuad);
  shaft.updateMatrixWorld(true);

  /* ---------- 鏡頭路徑 ---------- */
  const KF = createKeyframes();
  /** 舞台（canvas）的 CSS 尺寸 */
  const stage = { w: 1440, h: 843 };
  const endCam: EndCamera = { p: V3(), q: V3(), f: 40 };
  /** 交接終點：三塊畫面所在的平面離鏡頭多遠（公尺） */
  let faceDepth = FACE_END;
  const endWide = V3();
  const pcP = V3();
  const pcQ = V3();
  const pcDir = V3();
  const tmpEnd = V3();
  function layoutCam() {
    const aspect = camera.aspect;
    const wide = clamp((aspect - 0.9) / 0.6, 0, 1);
    const L = handoffLayout(stage.w, stage.h, measured);
    const f = lerp(50, 40, wide);
    const t = Math.tan(THREE.MathUtils.degToRad(f) / 2);
    const colW = L.center[1] - L.center[0];
    // 終點鏡頭的距離：中間螢幕的寬度剛好等於中間那一欄的寬度（鏡頭推到這裡停下：手機上中間螢幕的邊框就是報價面板的外框）
    const D = monC.w / ((colW / stage.w) * 2 * t * aspect);
    const zEnd = monC.homePos.z;
    // 推到螢幕前的那一格（交接開始）：寬螢幕三台都在畫面裡；
    // 直式只放中間那台，左右各留一點牆（交接時再往前推到中間螢幕的邊框剛好是報價面板的外框）
    const close = { center: V3(0, MON_Y - 0.01, -2.06), halfW: lerp(PORTRAIT_CLOSE_HALF_W, 1.24, wide) };
    // 寬螢幕的終點：正對 −z，中間螢幕正好在中間那一欄後面
    const ox = (((L.center[0] + L.center[1]) / 2 / stage.w) * 2 - 1) * D * t * aspect;
    const oy = (1 - (((L.top + L.bottom) / 2) / stage.h) * 2) * D * t;
    endWide.set(monC.homePos.x - ox, monC.homePos.y - oy, zEnd + D);
    // 直式的終點：從交接開始那一格沿著視線直直推進，推到中間螢幕的寬度剛好是報價那一欄（上面的看板一直留在畫面外）
    portraitCloseCamera(close, aspect, f, pcP, pcQ);
    pcDir.subVectors(pcQ, pcP).normalize();
    const d0 = tmpEnd.subVectors(monC.homePos, pcP).dot(pcDir);
    tmpEnd.copy(pcP).addScaledVector(pcDir, d0 - D);
    endCam.p.lerpVectors(tmpEnd, endWide, wide);
    endCam.q.lerpVectors(tmpEnd.add(pcDir), endWide.setZ(zEnd - 1), wide);
    endCam.f = f;
    // 三塊畫面最後停在鏡頭前 FACE_END 公尺的平面上：房間裡沒有任何東西擋在畫面前面（畫面離開螢幕、往讀者這邊浮過來）
    faceDepth = Math.min(FACE_END, D * 0.6);
    layoutKeyframes(KF, aspect, close, endCam, lookDawn);
  }
  const cP = V3();
  const cQ = V3();

  /* ---------- 晨夜混合與旅程裡的時刻 ---------- */
  // 燈與曝光的倍率；screenGlow 等在 render 裡還要乘上螢幕開機的進度
  const look = {
    lamp: 1,
    beam: 1,
    windowGlow: 1,
    exposure: NIGHT.exposure,
    exposureInside: NIGHT.exposureInside,
    screen: 1,
    screenGlow: 1,
    shaft: 0,
    fogDensity: NIGHT.fogDensity,
    /** 檯燈、燈罩下溢出的暖光、吊燈（交接時乘上剩下的暖光） */
    deskLamp: 1,
    lampPool: 1,
    pendant: 1,
  };
  /** 交接時暖光還剩多少（1 = 沒有退）；refreshLook 與每一格都用它 */
  let warmth = 1;
  function applyWarmth() {
    bankLight.intensity = BANK_LAMP * look.deskLamp * warmth;
    bankShade.emissiveIntensity = 0.6 * look.deskLamp * warmth;
    bankBulb.color.setRGB(1, 0.94, 0.82).multiplyScalar(lerp(0.35, 1, look.deskLamp) * lerp(0.35, 1, warmth));
    lampPool.intensity = LAMP_POOL * look.lampPool * warmth;
    pend.intensity = PENDANT * look.pendant * warmth;
    pendBulb.color.setRGB(1, 0.94, 0.85).multiplyScalar(lerp(0.3, 1, look.pendant) * lerp(0.35, 1, warmth));
  }
  /** 四組參數（夜早、夜晚、晨早、晨晚）目前的權重 */
  let W = lookWeights(0, 0);
  let lookDawn = 0;
  let lookHour = 0;
  const colorCache = new Map<keyof SceneLook, THREE.Color[]>();
  const colorsOf = (k: keyof SceneLook) => {
    let c = colorCache.get(k);
    if (!c) {
      c = LOOKS.map((l) => new THREE.Color(l[k] as number));
      colorCache.set(k, c);
    }
    return c;
  };
  const mixNum = (k: keyof SceneLook) => LOOKS.reduce((s, l, i) => s + (l[k] as number) * W[i], 0);
  const mixHex = (target: THREE.Color, k: keyof SceneLook) => {
    const c = colorsOf(k);
    target.setRGB(
      c[0].r * W[0] + c[1].r * W[1] + c[2].r * W[2] + c[3].r * W[3],
      c[0].g * W[0] + c[1].g * W[1] + c[2].g * W[2] + c[3].g * W[3],
      c[0].b * W[0] + c[1].b * W[1] + c[2].b * W[2] + c[3].b * W[3],
    );
  };
  const mixVec = (target: THREE.Vector3 | THREE.Color, k: keyof SceneLook) => {
    const v = [0, 1, 2].map((ch) => LOOKS.reduce((s, l, i) => s + (l[k] as [number, number, number])[ch] * W[i], 0));
    if (target instanceof THREE.Color) target.setRGB(v[0], v[1], v[2]);
    else target.set(v[0], v[1], v[2]);
  };
  const lightDir = V3();
  function refreshLook() {
    W = lookWeights(lookDawn, lookHour);
    const t = lookDawn;
    const elevation = mixNum('sunElevation');
    const azimuth = mixNum('sunAzimuth');
    setSun({ sunElevation: elevation, sunAzimuth: azimuth });
    su.sunPosition.value.copy(SUN);
    su.turbidity.value = mixNum('turbidity');
    su.rayleigh.value = mixNum('rayleigh');
    su.mieCoefficient.value = mixNum('mie');
    su.mieDirectionalG.value = mixNum('mieG');
    mixHex(fog.color, 'fog');
    look.fogDensity = mixNum('fogDensity');
    // 直射光：太陽在海平面下時，方向停在海平面上方幾度（那一側的天光），強度由各組參數決定
    lightDir.setFromSphericalCoords(
      1,
      THREE.MathUtils.degToRad(90 - Math.max(elevation, MIN_LIGHT_ELEVATION)),
      THREE.MathUtils.degToRad(azimuth),
    );
    sunLight.position.copy(lightDir).multiplyScalar(160).add(V3(0, 8, 0));
    mixHex(sunLight.color, 'sunColor');
    sunLight.intensity = mixNum('sunIntensity');
    mixHex(hemi.color, 'hemiSky');
    mixHex(hemi.groundColor, 'hemiGround');
    hemi.intensity = mixNum('hemiIntensity');
    mixHex(fill.color, 'fillColor');
    fill.intensity = mixNum('fillIntensity');
    (wu.sunDirection.value as THREE.Vector3).copy(SUN);
    mixHex(wu.sunColor.value as THREE.Color, 'waterSun');
    mixHex(wu.waterColor.value as THREE.Color, 'waterColor');
    const hs = headlandUniforms.uSky.value as THREE.Color;
    hs.setRGB(0, 0, 0);
    horizonSky.forEach((c, i) => {
      hs.r += c.r * W[i];
      hs.g += c.g * W[i];
      hs.b += c.b * W[i];
    });
    (waterHaze.uHazeColor.value as THREE.Color).copy(hs);
    mixVec(twilight.uGlowLow.value, 'skyGlowLow');
    mixVec(twilight.uGlowHigh.value, 'skyGlowHigh');
    mixVec(twilight.uBelt.value, 'skyBelt');
    (cu.uSun.value as THREE.Vector3).copy(SUN);
    mixVec(cu.uLit.value, 'cloudLit');
    mixVec(cu.uShade.value, 'cloudShade');
    mixVec(cu.uHor.value, 'cloudHorizon');
    mixVec(cu.uSunC.value, 'cloudSun');
    mixVec(pu.uGlow.value, 'portalGlow');
    mixHex(intHemi.color, 'intHemiSky');
    mixHex(intHemi.groundColor, 'intHemiGround');
    intHemi.intensity = mixNum('intHemiIntensity');
    mixHex(winLight.color, 'intWindowColor');
    winLight.intensity = mixNum('intWindowIntensity');
    mixHex(sideLight.color, 'sideWindowColor');
    sideLight.intensity = mixNum('sideWindowIntensity');
    mixHex(sunKey.color, 'intSunColor');
    sunKey.intensity = mixNum('intSun');
    bounce.intensity = mixNum('intBounce');
    mixHex(intFog.color, 'intFog');
    intFog.near = mixNum('intFogNear');
    intFog.far = mixNum('intFogFar');
    int.environmentIntensity = mixNum('intEnv');
    look.lamp = mixNum('lamp');
    look.beam = mixNum('beam');
    look.windowGlow = mixNum('windowGlow');
    look.exposure = mixNum('exposure');
    look.exposureInside = mixNum('exposureInside');
    look.screen = mixNum('screen');
    look.screenGlow = mixNum('screenGlow');
    look.shaft = mixNum('shaft');
    look.deskLamp = mixNum('deskLamp');
    look.lampPool = mixNum('lampPool');
    look.pendant = mixNum('pendant');
    warmGlass.emissiveIntensity = 1.25 * look.windowGlow;
    houseGlass.emissiveIntensity = 1.1 * look.windowGlow;
    halos.forEach((h) => (h.opacity = 0.35 * look.windowGlow));
    shipLights.opacity = lerp(1, 0.4, t);
    lensGlass.emissiveIntensity = 0.35 * look.lamp;
    prismMat.emissiveIntensity = 0.25 * look.lamp;
    coreMat.color.setRGB(1, 0.95, 0.86).multiplyScalar(lerp(0.45, 1, look.lamp));
    applyWarmth();
    // 晨班的地板與桌面壓暗一點：房間整體亮了，白底的螢幕仍然是桌上最亮的東西
    M.floor.color.setScalar(lerp(1, DAWN_FLOOR, t));
    M.walnut.color.copy(walnutBase).multiplyScalar(lerp(1, DAWN_DESK, t));
    // 側窗天色只看班別（室內一定是觀測室的時刻）：混合中每變 2% 重畫一次，走到兩端時一定重畫
    const atEnd = t === 0 || t === 1;
    if (Math.abs(t - paneDawn) > 0.02 || (atEnd && t !== paneDawn)) drawPane(t);
  }
  function applyLook(dawn: number) {
    lookDawn = clamp(dawn, 0, 1);
    refreshLook();
    // 桌前的取景跟著班別（夜班偏右、晨班偏左）
    layoutCam();
  }
  let shadowsDirty = { ext: true, int: true };
  /** 室外環境光貼圖是用哪個班、哪個時刻的天空建的；天空變了就要重建（捲動中節流） */
  const env = { dawn: -1, hour: -1, at: 0 };
  function rebuildEnvNow() {
    rebuildSkyEnv();
    env.dawn = lookDawn;
    env.hour = lookHour;
    env.at = performance.now();
    shadowsDirty.ext = true;
  }
  function settleLook() {
    rebuildEnvNow();
    shadowsDirty = { ext: true, int: true };
  }
  // 岬角的霧色：四組天色各取樣一次地平線，之後直接內插（不在每格讀回 GPU）
  LOOKS.forEach((_, i) => {
    lookDawn = i >= 2 ? 1 : 0;
    lookHour = i % 2;
    refreshLook();
    sampleHorizon(horizonSky[i]);
  });
  lookDawn = 0;
  lookHour = 0;
  refreshLook();
  rebuildEnvNow();

  /* ---------- 螢幕 ---------- */
  let lastScreens: { data: ScreenData; isDark: boolean } | null = null;
  const cssCtx = makeCanvas(1, 1).getContext('2d') as CanvasRenderingContext2D;
  /** CSS 顏色（hex、rgb()、甚至 oklch()）→ three 的顏色：先讓 canvas 正規化，再交給 setStyle */
  function cssRgb(css: string): [number, number, number] {
    cssCtx.fillStyle = '#000';
    cssCtx.fillStyle = css;
    cssCtx.clearRect(0, 0, 1, 1);
    cssCtx.fillRect(0, 0, 1, 1);
    const [r, g, b] = cssCtx.getImageData(0, 0, 1, 1).data;
    return [r / 255, g / 255, b / 255];
  }
  function cssColor(target: THREE.Color, css: string) {
    const [r, g, b] = cssRgb(css);
    target.setRGB(r, g, b, THREE.SRGBColorSpace);
  }
  /**
   * 交接用的頁面顏色（sRGB 0–1）：頁面底色、分隔線色，與觀測台頂端那層餘光的顏色
   * （styles/main.css 的 --handoff-tint：--brand 以 sRGB 混 22% 進 --background）。
   * 房間溶掉時，覆蓋上去的那一層從餘光色走到底色，跟觀測台頂端在同一個 --handoff 時的顏色一樣
   */
  const pageRgb = { bg: [0.03, 0.04, 0.06] as number[], border: [0.15, 0.17, 0.2] as number[], tint: [0.2, 0.15, 0.08] as number[] };
  /** 面板底色（--card，線性）：終點畫布的底色也是它 */
  const cardColor = new THREE.Color(0x0d1117);
  const mixRgb = (target: THREE.Color, a: readonly number[], b: readonly number[], t: number) =>
    target.setRGB(lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), THREE.SRGBColorSpace);
  /** 螢幕上次是用哪一種版面、多寬的舞台畫的（窄螢幕只有一欄；收盤字級跟著舞台寬） */
  let drawnNarrow = false;
  let drawnWidth = 0;
  function setScreens(data: ScreenData, isDark: boolean) {
    lastScreens = { data, isDark };
    drawnNarrow = handoffLayout(stage.w, stage.h, measured).single;
    drawnWidth = stage.w;
    const tk = readTokens(isDark);
    drawScreens(screens, data, isDark, tk, drawnNarrow, stage.w);
    faces.forEach((f) => {
      f.tex.needsUpdate = true;
      f.deskTex.needsUpdate = true;
    });
    boardTex.needsUpdate = true;
    pageRgb.bg = cssRgb(tk.background);
    pageRgb.border = cssRgb(tk.border);
    const brand = cssRgb(tk.brand);
    pageRgb.tint = pageRgb.bg.map((v, i) => v * 0.78 + brand[i] * 0.22);
    cssColor(fadeMat.color, tk.background);
    cssColor(cardColor, tk.card);
  }

  /* ---------- 尺寸 ---------- */
  const bufSize = new THREE.Vector2();
  /** 依舞台尺寸與量到的觀測台重排：canvas 尺寸、重畫螢幕、交接終點的鏡頭與三欄 */
  function relayout() {
    const sizes = sizesFor(stage.w, stage.h);
    const narrow = handoffLayout(stage.w, stage.h, measured).single;
    const changed = resizeScreenCanvases(screens, sizes);
    // canvas 換了尺寸：貼圖要重建（WebGL2 的貼圖大小是固定的）
    faces.forEach((f) => {
      if (changed.has(screens.end[f.key])) f.tex.dispose();
      if (changed.has(screens.desk[f.key])) f.deskTex.dispose();
    });
    if ((changed.size || narrow !== drawnNarrow || Math.abs(stage.w - drawnWidth) > 0.5) && lastScreens) setScreens(lastScreens.data, lastScreens.isDark);
    layoutCam();
  }
  function resize(width: number, height: number) {
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
    renderer.getDrawingBufferSize(bufSize);
    rtInt.setSize(Math.max(1, bufSize.x), Math.max(1, bufSize.y));
    (pu.uRes.value as THREE.Vector2).copy(bufSize);
    stage.w = Math.max(1, width);
    stage.h = Math.max(1, height);
    dust.uniforms.uScale.value = (bufSize.y / 900) * 2.6;
    relayout();
  }
  function setHandoff(m: MeasuredTerminal | null) {
    measured = m;
    relayout();
  }

  /* ---------- 每格 ---------- */
  const tmpV = V3();
  const camDir = V3();
  const camLocal = V3();
  let frame = 0;
  function draw(scene: THREE.Scene, key: 'ext' | 'int', target: THREE.WebGLRenderTarget | null) {
    if (shadowsDirty[key]) {
      renderer.shadowMap.needsUpdate = true;
      shadowsDirty[key] = false;
    }
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    if (target) renderer.setRenderTarget(null);
  }
  /** 觀測室：房間 → （交接時）溶成底色的那一層 → 螢幕畫面（深度沿用房間的，前面的東西照樣擋得住） */
  function drawInt(target: THREE.WebGLRenderTarget | null, fade: number) {
    draw(int, 'int', target);
    renderer.autoClear = false;
    renderer.setRenderTarget(target);
    if (fade > 0.001) renderer.render(fadeScene, fadeCam);
    renderer.render(faceScene, camera);
    renderer.autoClear = true;
    if (target) renderer.setRenderTarget(null);
  }
  /* ---------- 交接：三塊畫面從螢幕上的位置一路排到觀測台的三欄 ---------- */
  const corner = V3();
  const viewPos = V3();
  const monRect: Rect = { left: 0, right: 0, top: 0, bottom: 0 };
  const CORNERS = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [-0.5, 0.5],
    [0.5, 0.5],
  ] as const;
  const bezelRgb = [0, 0, 0];
  /** 上一格的交接值（驗證用） */
  let lastH = 0;
  /** 矩形四角（物件座標 ±0.5）經過 matrix 投影到舞台上的外接矩形 */
  function stageRect(matrix: THREE.Matrix4, sx: number, sy: number, out: Rect, quat?: THREE.Quaternion, pos?: THREE.Vector3): Rect {
    let l = Infinity;
    let r = -Infinity;
    let t = Infinity;
    let b = -Infinity;
    for (const [cx, cy] of CORNERS) {
      corner.set(cx * sx, cy * sy, 0);
      if (quat && pos) corner.applyQuaternion(quat).add(pos);
      else corner.applyMatrix4(matrix);
      corner.project(camera);
      const x = ((corner.x + 1) / 2) * stage.w;
      const y = ((1 - corner.y) / 2) * stage.h;
      if (x < l) l = x;
      if (x > r) r = x;
      if (y < t) t = y;
      if (y > b) b = y;
    }
    out.left = l;
    out.right = r;
    out.top = t;
    out.bottom = b;
    return out;
  }
  /** 畫面回到機身上（交接開始以前） */
  function homeFaces() {
    for (const f of faces) {
      f.g.position.copy(f.homePos);
      f.g.quaternion.copy(f.homeQuat);
      f.scr.scale.set(f.w, f.h, 1);
      f.desk.scale.set(f.w, f.h, 1);
      f.card.scale.set(f.w, f.h, 1);
      f.rule.scale.set(f.w + 2 * BEZEL_M, f.h + 2 * BEZEL_M, 1);
      f.ruleMat.opacity = 0;
      f.cardMat.opacity = 0;
      f.bezelPx = 0;
      f.mat.depthTest = f.deskMat.depthTest = f.ruleMat.depthTest = f.cardMat.depthTest = true;
    }
  }
  /**
   * 交接中（h > 0）：每塊畫面在舞台上的矩形 = 「它在機身上投影出來的外接矩形」與「觀測台那一欄」之間以 h 內插
   * （lerpRect；h = 1 時剛好是量到的欄位）。矩形放在鏡頭前、正對鏡頭的平面上，投影回去就是這個矩形；
   * 一開始先從機身的角度轉正（handoffFlatten），邊框從機身的寬度收成 1px、顏色從機身的黑變成頁面的分隔線色。
   * 窄螢幕的左右兩塊沒有欄位：同樣大小，整塊移出畫面。
   */
  function placeFaces(h: number) {
    camera.updateMatrixWorld();
    const L = handoffLayout(stage.w, stage.h, measured);
    const cols = terminalColumnRects(L);
    const flat = handoffFlatten(h);
    const lift = handoffLift(h);
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const ruleA = handoffBezelIn(h);
    for (let i = 0; i < 3; i++) bezelRgb[i] = lerp(BEZEL_NIGHT[i], BEZEL_DAWN[i], lookDawn);
    for (const f of faces) {
      stageRect(f.g.matrixWorld, f.w, f.h, monRect, f.homeQuat, f.homePos);
      const viewZ = Math.max(0.05, -viewPos.copy(f.homePos).applyMatrix4(camera.matrixWorldInverse).z);
      const startPx = (BEZEL_M * stage.h) / (2 * viewZ * tanV);
      const target = cols[f.key] ?? exitRect(monRect, f.key === 'left' ? -1 : 1, stage.w, EXIT_MARGIN + startPx);
      const r = lerpRect(monRect, target, lift);
      const d = (1 - lift) * viewZ + lift * faceDepth;
      const s = rectInView(camera.fov, camera.aspect, stage, d, r, viewPos);
      viewPos.applyMatrix4(camera.matrixWorld);
      if (flat >= 1) {
        f.g.position.copy(viewPos);
        f.g.quaternion.copy(camera.quaternion);
      } else {
        f.g.position.lerpVectors(f.homePos, viewPos, flat);
        f.g.quaternion.slerpQuaternions(f.homeQuat, camera.quaternion, flat);
      }
      const fw = (1 - flat) * f.w + flat * s.w;
      const fh = (1 - flat) * f.h + flat * s.h;
      f.bezelPx = bezelWidth(startPx, lift);
      const bm = f.bezelPx * s.pxToM;
      f.scr.scale.set(fw, fh, 1);
      f.desk.scale.set(fw, fh, 1);
      f.card.scale.set(fw, fh, 1);
      f.rule.scale.set(fw + 2 * bm, fh + 2 * bm, 1);
      f.ruleMat.opacity = ruleA;
      f.cardMat.opacity = 1;
      mixRgb(f.ruleMat.color, bezelRgb, pageRgb.border, lift);
      // 畫面離開機身、往讀者這邊浮過來：房間裡的東西不再擋它（畫的順序由 renderOrder 決定）
      f.mat.depthTest = f.deskMat.depthTest = f.ruleMat.depthTest = f.cardMat.depthTest = false;
    }
  }
  /** 終點的 canvas 依終點的比例畫：畫面還矮的時候只露出上面那一段；桌上那張是 16:9，畫面變高時往下延伸畫布最下緣的面板色 */
  function fitTextures() {
    for (const f of faces) {
      const fw = f.scr.scale.x;
      const fh = f.scr.scale.y;
      const c = screens.end[f.key];
      const vis = Math.min(1, fh / fw / (c.height / c.width));
      f.tex.repeat.set(1, vis);
      f.tex.offset.set(0, 1 - vis);
      const d = screens.desk[f.key];
      const ext = Math.max(1, fh / fw / (d.height / d.width));
      f.deskTex.repeat.set(1, ext);
      f.deskTex.offset.set(0, 1 - ext);
    }
  }
  function probe(): FaceProbe {
    const rect = (): Rect => ({ left: 0, right: 0, top: 0, bottom: 0 });
    const faceOut = {} as FaceProbe['faces'];
    for (const f of faces) {
      f.g.updateMatrixWorld(true);
      faceOut[f.key] = {
        face: stageRect(f.scr.matrixWorld, 1, 1, rect()),
        bezel: stageRect(f.rule.matrixWorld, 1, 1, rect()),
        bezelPx: f.bezelPx,
        deskOpacity: f.desk.visible ? f.deskMat.opacity : 0,
        ruleOpacity: f.ruleMat.opacity,
      };
    }
    return { stage: { w: stage.w, h: stage.h }, h: lastH, room: fadeMat.opacity, faces: faceOut };
  }

  const prev = { hour: -1, dawn: -1 };
  function render({ time, p, mx, my, sway }: FrameInput) {
    frame++;
    const h = handoffValue(p);
    lastH = h;
    // 時刻跟著進度走（夜班：餘暉 → 入夜；晨班：日出前 → 日出）
    const hour = shiftHour(p);
    if (hour !== lookHour) {
      lookHour = hour;
      refreshLook();
    }
    // 天空變了：室外的環境光貼圖與陰影跟著重建。捲動或換班中節流，停下來時一定補一次準的
    const moving = hour !== prev.hour || lookDawn !== prev.dawn;
    prev.hour = hour;
    prev.dawn = lookDawn;
    const envOff = Math.max(Math.abs(env.hour - lookHour), Math.abs(env.dawn - lookDawn));
    if (envOff > 1e-4 && p < 0.62 && (!moving || (envOff > ENV_REBUILD_STEP && performance.now() - env.at > ENV_REBUILD_MS))) rebuildEnvNow();
    // 鏡頭（交接時沿著 h 推近：跟畫面升起、房間溶掉同一條曲線）
    const fov = evalCamera(KF, handoffCameraT(p), cP, cQ);
    camera.position.copy(cP);
    if (sway) {
      const idle = 1 - sstep(0.0, 0.08, p);
      camera.position.x += Math.sin(time * 0.13) * 1.6 * idle;
      camera.position.y += Math.sin(time * 0.21) * 0.35 * idle;
    }
    camera.lookAt(cQ);
    const par = 1 - sstep(0.82, 0.9, p);
    if (par > 0 && (mx !== 0 || my !== 0)) {
      camera.rotateY(-mx * 0.022 * par);
      camera.rotateX(-my * 0.014 * par);
    }
    camera.fov = fov;
    const inside =
      camera.position.z < PORTAL_Z - 0.004 && Math.hypot(camera.position.x, camera.position.z) < RR + 0.6 && camera.position.y > FL && camera.position.y < CE;
    const dPortal = Math.hypot(camera.position.x, camera.position.y - WIN.y, camera.position.z - PORTAL_Z);
    camera.near = inside ? 0.02 : clamp(dPortal * 0.06, 0.02, 0.5);
    camera.far = inside ? 60 : 40000;
    camera.updateProjectionMatrix();
    renderer.toneMappingExposure = lerp(look.exposure, look.exposureInside, sstep(0.5, 0.62, p));
    // 遠景的霧氣：首屏不動，往燈塔走時慢慢加濃（近景的塔身幾乎不受影響，遠處的島與海退進天色裡）
    const haze = sstep(0.12, 0.3, p);
    fog.density = look.fogDensity * lerp(1, HAZE_GAIN, haze);
    waterHaze.uHazeDensity.value = look.fogDensity * HAZE_GAIN * haze;
    // 離開首屏後海面靜下來：中距離的浪不再把雲的倒影打成一塊塊斑點（首屏的金色波光不變）
    waterHaze.uCalm.value = sstep(0.08, 0.24, p);
    // 燈：光束 20 秒一圈，兩道光所以每 10 秒閃一次
    const rot = (time * TAU) / 20;
    beams.rotation.y = rot;
    camDir.set(camera.position.x, 0, camera.position.z).normalize();
    const bd = tmpV.set(Math.sin(rot), 0, Math.cos(rot));
    const flash = Math.pow(Math.abs(bd.dot(camDir)), 60);
    glow1.scale.setScalar(4.5 + flash * 16 * look.lamp);
    glowSm.opacity = lerp(0.25, 1, look.lamp);
    glowSm2.opacity = (0.28 + flash * 0.6) * look.lamp;
    bu.uI.value = 0.17 * (1 - sstep(0.46, 0.54, p) * 0.6) * look.beam;
    lampLight.intensity = (30 + flash * 28) * look.lamp;
    // 靠近時窗扇打開
    const op = sstep(0.45, 0.53, p);
    mainWin.leaves.forEach((l) => {
      l.hinge.rotation.y = l.side * op * 1.95;
    });
    mainWin.haloMat.opacity = 0.35 * look.windowGlow * (1 - sstep(0.32, 0.46, p));
    pu.uMix.value = sstep(0.33, 0.43, p);
    // 夜班：從窗外看進去時室內亮一截，窗台與窗洞有暖光（晨班的室內本來就比外面暗，不加）
    const night = 1 - lookDawn;
    const nearWin = sstep(0.36, 0.47, p) * (1 - sstep(0.58, 0.62, p));
    pu.uGain.value = 1 + PORTAL_NIGHT_GAIN * night;
    winSpill.intensity = WIN_SPILL * night * nearWin;
    // 海、雲、浪花、海鷗、貨輪
    wu.time.value = time * 0.55;
    cu.uTime.value = time;
    (cu.uCam.value as THREE.Vector3).copy(camera.position);
    foamUniforms.uTime.value = time;
    for (const u of gulls) {
      const a = u.ph + time * u.w;
      u.g.position.set(Math.sin(a) * u.r, u.y + Math.sin(time * 0.4 + u.ph) * 1.2, Math.cos(a) * u.r);
      const a2 = a + 0.05 * Math.sign(u.w);
      u.g.lookAt(Math.sin(a2) * u.r, u.g.position.y, Math.cos(a2) * u.r);
      u.g.rotateZ(-0.3 * Math.sign(u.w));
      const fl = Math.sin(time * u.f + u.ph) * 0.42;
      u.inner[0].rotation.z = fl;
      u.inner[1].rotation.z = -fl;
      u.outer.forEach((o) => (o.rotation.z = -fl * 0.8));
      // 不讓任何一隻貼著鏡頭飛過（近看會變成一大片）；靠近窗以後畫面右側是文案，遠景不留會動的小點
      u.g.visible = !inside && p < 0.4 && u.g.position.distanceTo(camera.position) > 12;
    }
    shipDir.set(1, 0, 0);
    ship.position.copy(shipBase).addScaledVector(shipDir, ((time * 0.8) % 600) - 300);
    ship.visible = p < 0.4;
    // 觀測室（看得到時才更新）
    const needInt = p > 0.3 || inside;
    const fade = handoffRoom(h);
    if (needInt) {
      // 螢幕整段旅程都亮著（從窗外看進去、走到桌前、交接都是同一個狀態）；交接時拉到頁面的原色
      const on = lerp(look.screen, 1, h);
      monGlow.intensity = SCREEN_GLOW * look.screenGlow * on * (1 - fade);
      monHalo.intensity = SCREEN_GLOW * 0.6 * look.screenGlow * on * (1 - fade);
      // 檯燈與吊燈的暖光跟著交接退掉（觀測台頂端那層餘光接著淡出）
      const warm = handoffWarmth(h);
      if (warm !== warmth) {
        warmth = warm;
        applyWarmth();
        boardMat.color.setScalar(lerp(0.3, 1, warm));
      }
      // 桌上的大字先淡出（露出面板底色），觀測台那一欄的排法再淡入
      const deskA = 1 - handoffDeskOut(h);
      const endA = h > 0 ? handoffEndIn(h) : 1;
      for (const f of faces) {
        f.mat.color.setScalar(on);
        f.deskMat.color.setScalar(on);
        f.cardMat.color.copy(cardColor).multiplyScalar(on);
        f.deskMat.opacity = deskA;
        f.desk.visible = deskA > 0.002;
        f.mat.opacity = endA;
        f.scr.visible = endA > 0.002;
      }
      if (h > 0) placeFaces(h);
      else homeFaces();
      fitTextures();
      // 房間溶成頁面底色：覆蓋的那一層從觀測台頂端的餘光色（--handoff-tint）走到底色（--background）
      fadeMat.opacity = fade;
      mixRgb(fadeMat.color, pageRgb.tint, pageRgb.bg, h);
      // 晨光的光柱與灰塵
      shaft.visible = look.shaft > 0.01 && fade < 0.999;
      if (shaft.visible) {
        shaftUniforms.uI.value = look.shaft * SHAFT_GAIN * (1 - fade);
        shaftUniforms.uTime.value = time;
        (shaftUniforms.uCamLocal.value as THREE.Vector3).copy(shaft.worldToLocal(camLocal.copy(camera.position)));
      }
      const now = new Date();
      const tp = new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
      const hh = (tp.getHours() % 12) + tp.getMinutes() / 60;
      const mm = tp.getMinutes() + tp.getSeconds() / 60;
      clock.hp.rotation.z = (-hh / 12) * TAU;
      clock.mp.rotation.z = (-mm / 60) * TAU;
    }
    // 繪製
    if (inside) drawInt(null, fade);
    else {
      if ((needInt && pu.uMix.value > 0) || frame <= 2) drawInt(rtInt, 0);
      draw(ext, 'ext', null);
    }
  }
  /* ---------- 釋放 ---------- */
  function disposeMaterial(m: THREE.Material, seen: Set<object>) {
    if (seen.has(m)) return;
    seen.add(m);
    const rec = m as unknown as Record<string, unknown>;
    for (const k of Object.keys(rec)) {
      const v = rec[k] as THREE.Texture | undefined;
      if (v && (v as THREE.Texture).isTexture) disposeTexture(v, seen);
    }
    if ((m as THREE.ShaderMaterial).isShaderMaterial) {
      const u = (m as THREE.ShaderMaterial).uniforms;
      for (const k of Object.keys(u)) {
        const v = u[k]?.value as THREE.Texture | undefined;
        if (v && v.isTexture) disposeTexture(v, seen);
      }
    }
    m.dispose();
  }
  function disposeTexture(t: THREE.Texture, seen: Set<object>) {
    if (seen.has(t)) return;
    seen.add(t);
    const rt = (t as THREE.Texture & { renderTarget?: { dispose(): void } | null }).renderTarget;
    if (rt) rt.dispose();
    t.dispose();
  }
  function disposeScene(scene: THREE.Scene, seen: Set<object>) {
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry && !seen.has(mesh.geometry)) {
        seen.add(mesh.geometry);
        mesh.geometry.dispose();
      }
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => disposeMaterial(m, seen));
      else if (mat) disposeMaterial(mat, seen);
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
      const light = o as THREE.Light & { shadow?: THREE.LightShadow };
      if (light.isLight && light.shadow?.map) light.shadow.dispose();
    });
  }
  function dispose() {
    const seen = new Set<object>();
    disposeScene(ext, seen);
    disposeScene(int, seen);
    disposeScene(faceScene, seen);
    disposeScene(fadeScene, seen);
    disposables.forEach((d) => {
      if (!seen.has(d)) d.dispose();
    });
    disposables.clear();
    extEnv?.dispose();
    extEnv = null;
    intEnv.dispose();
    ext.environment = null;
    int.environment = null;
    pmrem.dispose();
    ext.clear();
    int.clear();
    faceScene.clear();
    fadeScene.clear();
  }

  return { render, resize, setScreens, setHandoff, applyLook, settleLook, probe, dispose };
}
