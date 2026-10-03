/**
 * 同一個場景的兩個班：夜班（dark）與晨班（light）。每個班在旅程裡都有時間往前走：
 * - 夜班：首屏是日落後的餘暉（太陽剛沉到海平面下），走到觀測室時已經入夜。
 * - 晨班：首屏是日出前的天光（燈還亮著），走到觀測室時太陽剛出海面。
 * 每個班有早、晚兩組參數（EARLY 是首屏、LATE 是窗與室內），場景依「班」（dawn 0–1）與「時刻」（hour 0–1）雙線性內插。
 * 這些是場景美術用的色值（不是介面 token），可以直接寫數值。
 */

export interface SceneLook {
  /** 太陽仰角、方位角（度）；仰角可以是負的（太陽在海平面下，天空只剩餘暉） */
  sunElevation: number;
  sunAzimuth: number;
  turbidity: number;
  rayleigh: number;
  mie: number;
  mieG: number;
  fog: number;
  fogDensity: number;
  /** 直射光（太陽在海平面下時，代表西邊／東邊天空的餘光，方向固定在海平面上方幾度） */
  sunColor: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  /** 天光補光（鏡頭左前方的冷光，給白塔圓柱的明暗） */
  fillColor: number;
  fillIntensity: number;
  waterColor: number;
  waterSun: number;
  /** 室外與室內的曝光 */
  exposure: number;
  exposureInside: number;
  /** 燈籠、光束、亮窗的強度倍率 */
  lamp: number;
  beam: number;
  windowGlow: number;
  /**
   * 暮光（加在天空上的線性色）：Preetham 天空在太陽沉下去之後，背對太陽那一側會整片變黑，
   * 這裡補上地平線附近的藍（Low）、天頂的深藍（High），以及背日側離地平線幾度的粉色帶（金星帶，Belt）。
   */
  skyGlowLow: [number, number, number];
  skyGlowHigh: [number, number, number];
  skyBelt: [number, number, number];
  /** 雲層（線性色，可大於 1） */
  cloudLit: [number, number, number];
  cloudShade: [number, number, number];
  cloudHorizon: [number, number, number];
  cloudSun: [number, number, number];
  /** 觀測室：天光（半球光）、從入口窗進來的光、側窗斜射進來的光 */
  intHemiSky: number;
  intHemiGround: number;
  intHemiIntensity: number;
  intWindowColor: number;
  intWindowIntensity: number;
  sideWindowColor: number;
  sideWindowIntensity: number;
  /** 室內環境光貼圖的強度 */
  intEnv: number;
  /** 晨光：從右側窗斜射進來的低角度陽光（聚光燈，燭光）與它的顏色、照在光斑附近的反射光 */
  intSun: number;
  intSunColor: number;
  intBounce: number;
  /** 室內的空氣（線性霧）：顏色、開始與完全看不見的距離 */
  intFog: number;
  intFogNear: number;
  intFogFar: number;
  /** 晨光光柱與灰塵的濃度（0–1） */
  shaft: number;
  /** 銀行家檯燈（聚光）與燈罩下照亮桌面、後牆的一圈暖光 */
  deskLamp: number;
  lampPool: number;
  /** 吊燈 */
  pendant: number;
  /** 螢幕亮度，以及螢幕打在桌面與牆上的冷光 */
  screen: number;
  screenGlow: number;
  /** 室外看進窗戶時的光（線性色） */
  portalGlow: [number, number, number];
  /** 側窗看出去的天色（由上到下） */
  pane: [string, string, string, string, string, string];
}

/** 夜班・首屏：太陽剛沉下去，西南方還有一道橘色的餘暉，上方已經是深藍 */
export const NIGHT_EARLY: SceneLook = {
  sunElevation: -0.5,
  sunAzimuth: 136,
  turbidity: 6,
  rayleigh: 2.6,
  mie: 0.007,
  mieG: 0.86,
  fog: 0x5c5a72,
  fogDensity: 0.00022,
  sunColor: 0xff9e62,
  sunIntensity: 1.5 * Math.PI,
  hemiSky: 0x7487b4,
  hemiGround: 0x3a2e28,
  hemiIntensity: 0.8 * Math.PI,
  fillColor: 0x5d6f9a,
  fillIntensity: 0.7 * Math.PI,
  waterColor: 0x0a1d2a,
  waterSun: 0xffb27a,
  exposure: 0.55,
  exposureInside: 0.62,
  lamp: 1,
  beam: 1,
  windowGlow: 1,
  skyGlowLow: [0.035, 0.042, 0.09],
  skyGlowHigh: [0.006, 0.01, 0.032],
  skyBelt: [0.03, 0.014, 0.03],
  cloudLit: [1.2, 0.56, 0.36],
  cloudShade: [0.14, 0.14, 0.24],
  cloudHorizon: [0.8, 0.4, 0.32],
  cloudSun: [1.9, 0.85, 0.42],
  intHemiSky: 0x2c3a5c,
  intHemiGround: 0x1e140c,
  intHemiIntensity: 0.05 * Math.PI,
  intWindowColor: 0x5a6f9e,
  intWindowIntensity: 0.06 * Math.PI,
  sideWindowColor: 0x4a5d8a,
  sideWindowIntensity: 0.05 * Math.PI,
  intEnv: 0.05,
  intSun: 0,
  intSunColor: 0xffd2a0,
  intBounce: 0,
  intFog: 0x0a0807,
  intFogNear: 2.2,
  intFogFar: 16,
  shaft: 0,
  deskLamp: 1,
  lampPool: 1.4,
  pendant: 0.22,
  screen: 1,
  screenGlow: 1,
  portalGlow: [0.96, 0.66, 0.36],
  pane: ['#0f1a33', '#1c2647', '#3b3552', '#5a4150', '#141c26', '#090e14'],
};

/** 夜班・入夜：天空只剩地平線上一點藍紫，燈塔的光束與亮著的窗是畫面裡最亮的東西 */
export const NIGHT_LATE: SceneLook = {
  ...NIGHT_EARLY,
  sunElevation: -1.6,
  turbidity: 4.5,
  rayleigh: 2.2,
  mie: 0.005,
  fog: 0x262b3e,
  sunColor: 0x8f86c0,
  sunIntensity: 0.4 * Math.PI,
  hemiSky: 0x5c6782,
  hemiGround: 0x241c1a,
  hemiIntensity: 0.32 * Math.PI,
  fillColor: 0x5b6579,
  fillIntensity: 0.28 * Math.PI,
  waterColor: 0x061420,
  waterSun: 0x8a90c0,
  exposure: 1.2,
  skyGlowLow: [0.016, 0.02, 0.05],
  skyGlowHigh: [0.003, 0.005, 0.017],
  skyBelt: [0.006, 0.003, 0.008],
  cloudLit: [0.26, 0.22, 0.34],
  cloudShade: [0.05, 0.06, 0.1],
  cloudHorizon: [0.24, 0.2, 0.3],
  cloudSun: [0.4, 0.26, 0.26],
};

/** 晨班・首屏：日出前的天光，東南方的天邊開始發白，燈塔的燈還亮著最後一圈 */
export const DAWN_EARLY: SceneLook = {
  sunElevation: -1.1,
  sunAzimuth: 136,
  turbidity: 2.0,
  rayleigh: 1.8,
  mie: 0.003,
  mieG: 0.8,
  fog: 0x8e9cb4,
  fogDensity: 0.0002,
  sunColor: 0xffc9b8,
  sunIntensity: 0.55 * Math.PI,
  hemiSky: 0xa9bad6,
  hemiGround: 0x4d4844,
  hemiIntensity: 0.5 * Math.PI,
  fillColor: 0xb7c6de,
  fillIntensity: 0.45 * Math.PI,
  waterColor: 0x264662,
  waterSun: 0xffd8c4,
  exposure: 1.9,
  // 晨班的室內多一點曝光（房間不再是一片低對比的灰）；地板與桌面另外壓暗，螢幕仍然是最亮的
  exposureInside: 0.56,
  lamp: 0.75,
  beam: 0.55,
  windowGlow: 0.7,
  skyGlowLow: [0.07, 0.075, 0.115],
  skyGlowHigh: [0.02, 0.034, 0.075],
  skyBelt: [0.05, 0.028, 0.04],
  cloudLit: [0.62, 0.5, 0.54],
  cloudShade: [0.2, 0.22, 0.3],
  cloudHorizon: [0.55, 0.45, 0.46],
  cloudSun: [0.9, 0.62, 0.52],
  // 晨班的室內：主光是從右側窗斜射進來的陽光（有陰影、靠窗亮往裡暗），天光只是很淡的冷色補光，
  // 牆角、桌下留暗（環境遮蔽壓在補光上），跟夜班一樣有明暗，不是一屋子平均的灰
  intHemiSky: 0xb4c6e2,
  intHemiGround: 0x5a4636,
  intHemiIntensity: 0.24 * Math.PI,
  intWindowColor: 0xc9d8ee,
  // 入口窗（鏡頭背後）進來的天光把後牆整面照亮：看板上方、交接文案那一列的牆面是亮的，不靠襯底
  intWindowIntensity: 0.6 * Math.PI,
  sideWindowColor: 0xd6e2f2,
  sideWindowIntensity: 0,
  intEnv: 0.1,
  intSun: 420,
  intSunColor: 0xffd3a4,
  intBounce: 1.1,
  intFog: 0x9fb0c6,
  intFogNear: 2.0,
  intFogFar: 34,
  shaft: 1,
  deskLamp: 0.22,
  lampPool: 0.15,
  pendant: 0,
  screen: 0.9,
  screenGlow: 0.25,
  portalGlow: [0.66, 0.7, 0.76],
  pane: ['#86a4cc', '#adc3dd', '#ead6c8', '#f8ddc0', '#5f7688', '#30445a'],
};

/** 晨班・日出：太陽剛出海面，塔身右側被曬成暖色，燈熄了 */
export const DAWN_LATE: SceneLook = {
  ...DAWN_EARLY,
  sunElevation: 1.6,
  turbidity: 2.4,
  rayleigh: 1.5,
  mie: 0.004,
  mieG: 0.8,
  fog: 0xb4c0cc,
  sunColor: 0xffd2a8,
  sunIntensity: 2.2 * Math.PI,
  hemiSky: 0xbccce2,
  hemiGround: 0x5d564e,
  hemiIntensity: 0.7 * Math.PI,
  fillColor: 0xd2dceb,
  fillIntensity: 0.75 * Math.PI,
  waterColor: 0x2a4c62,
  waterSun: 0xffe6cc,
  exposure: 0.66,
  lamp: 0.2,
  beam: 0,
  windowGlow: 0.35,
  skyGlowLow: [0.03, 0.036, 0.05],
  skyGlowHigh: [0.012, 0.022, 0.05],
  skyBelt: [0, 0, 0],
  cloudLit: [1.45, 1.15, 1.0],
  cloudShade: [0.46, 0.48, 0.56],
  cloudHorizon: [1.06, 0.88, 0.8],
  cloudSun: [1.8, 1.3, 0.9],
};

/** 0 夜班早、1 夜班晚、2 晨班早、3 晨班晚 */
export const LOOKS: readonly [SceneLook, SceneLook, SceneLook, SceneLook] = [NIGHT_EARLY, NIGHT_LATE, DAWN_EARLY, DAWN_LATE];

/** 班（0 夜、1 晨）與時刻（0 首屏、1 觀測室）對應到四組參數的權重 */
export function lookWeights(dawn: number, hour: number): [number, number, number, number] {
  const d = Math.min(1, Math.max(0, dawn));
  const h = Math.min(1, Math.max(0, hour));
  return [(1 - d) * (1 - h), (1 - d) * h, d * (1 - h), d * h];
}
