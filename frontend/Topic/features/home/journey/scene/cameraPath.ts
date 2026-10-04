/**
 * 鏡頭路徑：關鍵影格 + Catmull-Rom（移植自 beacon.html 原型，時間軸對到五段文案）。
 * 海面 0–0.22、燈塔 0.22–0.4、窗 0.4–0.62、桌前 0.62–0.78、交接 0.78–1（見 journeyMath 的 CHAPTERS）。
 *
 * 窗、桌前、交接三章各有寬螢幕與直式手機兩組構圖（位置、注視點、視角），依畫面比例內插：
 * - 寬螢幕：窗在畫面左側（文案在窗的右邊）；桌前的看板與螢幕偏右（文案在左邊牆上）；交接時推近三台螢幕。
 * - 直式：看板與中間螢幕落在進度列下方的安全區，不拍到天花板與吊燈；交接時推到中間螢幕剛好是報價面板那一欄。
 */
import { Vector3, MathUtils } from 'three';
import { clamp, lerp } from './noise';

export interface Keyframe {
  t: number;
  /** 鏡頭位置 */
  p: Vector3;
  /** 注視點 */
  q: Vector3;
  /** 垂直視角（度） */
  f: number;
}

const V3 = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);

/** 關鍵影格的索引（layoutKeyframes 依畫面比例改這幾格） */
const K = { hero: 0, drift: 1, tower: 3, window: 6, inside: 8, desk: 9, deskHold: 10, close: 11, end: 12 } as const;

export function createKeyframes(): Keyframe[] {
  return [
    { t: 0.0, p: V3(-58, 9.5, 105), q: V3(-30, 18, 0), f: 45 }, // 海面：首屏
    { t: 0.07, p: V3(-53, 10.2, 99), q: V3(-27, 18.6, 0), f: 45 },
    { t: 0.2, p: V3(-27, 14.5, 73), q: V3(-8, 22, 0), f: 44 }, // 往燈塔靠近
    { t: 0.31, p: V3(21, 24.5, 45), q: V3(0, 27.5, 0), f: 44 }, // 燈塔：繞上去，看光束
    { t: 0.42, p: V3(8, 31.2, 19), q: V3(0.5, 31.1, 3.4), f: 44 }, // 窗：往窗靠近
    { t: 0.49, p: V3(0.8, 31.2, 11), q: V3(0, 31.1, 2), f: 45 },
    { t: 0.555, p: V3(0, 31.1, 7.2), q: V3(0, 31.05, 0), f: 46 },
    { t: 0.6, p: V3(0, 31.06, 3.0), q: V3(0, 30.95, -3), f: 52 }, // 穿過窗
    { t: 0.65, p: V3(0, 30.95, 1.0), q: V3(0, 30.85, -3), f: 50 },
    { t: 0.69, p: V3(0, 30.86, 0.55), q: V3(0, 30.86, -2.4), f: 38 }, // 桌前
    { t: 0.78, p: V3(0, 30.84, 0.3), q: V3(0, 30.84, -2.4), f: 38 },
    { t: 0.92, p: V3(), q: V3(), f: 40 }, // 交接開始：三台螢幕在桌上
    // 交接終點：中間螢幕的寬度剛好是觀測台中間那一欄（0.92–1 由 handoffCameraT 依 --ease-swell 走，兩端都是平緩的）
    { t: 1.0, p: V3(), q: V3(), f: 40 },
  ];
}

/**
 * 桌前的取景（觀測室座標）：看板上緣 TOP 放在畫面上方，桌面前緣 EDGE 放在畫面下方。
 * 橫向至少要放進 halfW（量在 widthZ 的深度：寬螢幕量三台螢幕，直式量看板）。
 */
const DESK = {
  top: { y: 31.66, z: -2.84 },
  edge: { y: 30.12, z: -1.56 },
  monitorZ: -2.05,
  boardZ: -2.84,
};

/**
 * 鏡頭固定在眼睛高度 eyeY，找出距離與俯仰角，讓 TOP 落在畫面 fTop、EDGE 落在 fEdge（由上往下 0–1）。
 * 橫向放不下時再往後退，俯仰角只對齊 TOP。
 */
function aimDesk(fovDeg: number, aspect: number, eyeY: number, fTop: number, fEdge: number, halfW: number, widthZ: number) {
  const t = Math.tan(MathUtils.degToRad(fovDeg) / 2);
  const aTop = Math.atan((0.5 - fTop) * 2 * t);
  const aEdge = Math.atan((0.5 - fEdge) * 2 * t);
  const want = aTop - aEdge;
  const span = (z: number) => Math.atan2(DESK.top.y - eyeY, z - DESK.top.z) - Math.atan2(DESK.edge.y - eyeY, z - DESK.edge.z);
  // 距離越遠，兩點張開的角度越小：二分法
  let lo = DESK.edge.z + 0.4;
  let hi = 2.6;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (span(mid) > want) lo = mid;
    else hi = mid;
  }
  const zFit = (lo + hi) / 2;
  const zWidth = widthZ + halfW / (t * aspect);
  const z = clamp(Math.max(zFit, zWidth), DESK.edge.z + 0.4, 2.6);
  const pitch = Math.atan2(DESK.top.y - eyeY, z - DESK.top.z) - aTop;
  return { z, pitch };
}

/**
 * 直式的交接開始（0.92）：鏡頭在中間螢幕前、稍微往下看（約 8°），中間螢幕在進度列下方、下面是桌前與地板（交接文案放在那裡），
 * 看板在畫面上緣之外。交接時沿著這個視線直直推進（BeaconWorld 算終點），看板一直留在畫面外。
 */
export function portraitCloseCamera(close: { center: Vector3; halfW: number }, aspect: number, fovDeg: number, outP: Vector3, outQ: Vector3) {
  const tc = Math.tan(MathUtils.degToRad(fovDeg) / 2);
  const dClose = close.halfW / (tc * aspect);
  const lift = 0.1;
  outP.copy(close.center).add(V3(0, lift, dClose));
  outQ.copy(close.center).add(V3(0, lift - (dClose + 1) * Math.tan(MathUtils.degToRad(8)), -1));
}

/** 交接終點的鏡頭：注視點與位置（由 BeaconWorld 依三欄的位置算出） */
export interface EndCamera {
  p: Vector3;
  q: Vector3;
  f: number;
}

/**
 * 依畫面比例調整首屏構圖、燈塔、窗、桌前與交接的取景。
 * close：三台螢幕在桌上的中心；endCam：交接終點的鏡頭（三塊畫面排成三欄時的鏡頭）。
 * dawn（0 夜班、1 晨班）：寬螢幕的桌前，夜班看板與螢幕偏右（文案在左邊的牆上）；
 * 晨班反過來偏左，右邊是被側窗陽光照亮的牆面，文案放在那裡（本來就亮，不必墊一大片襯底）。
 */
export function layoutKeyframes(KF: Keyframe[], aspect: number, close: { center: Vector3; halfW: number }, endCam: EndCamera, dawn = 0) {
  const wide = clamp((aspect - 0.9) / 0.6, 0, 1); // 0 直式、1 桌機
  // 海面：燈塔在寬螢幕的右側三分之一，直式在中間；直式的注視點壓低，地平線往上移
  const heroX = lerp(-2, -30, wide);
  KF[K.hero].q.set(heroX, lerp(11, 18, wide), 0);
  KF[K.drift].q.set(heroX * 0.9, lerp(11.7, 18.6, wide), 0);
  if (aspect < 0.9) {
    KF[K.hero].p.set(-66, 10, 122);
    KF[K.drift].p.set(-60, 10.8, 114);
  } else {
    KF[K.hero].p.set(-58, 9.5, 105);
    KF[K.drift].p.set(-53, 10.2, 99);
  }
  // 燈塔：寬螢幕把注視點往左移，塔身落在右側，左上的天空留給文案
  KF[K.tower].q.set(lerp(1.5, -9, wide), lerp(26.5, 27.5, wide), lerp(0, 3, wide));
  // 窗：寬螢幕把窗放在畫面左側三分之一（文案在窗的右邊）；直式窗在進度列下方的上半部，文案在下面的塔身上
  KF[K.window].p.set(lerp(0, 0.35, wide), 31.1, lerp(9.5, 7.2, wide));
  KF[K.window].q.set(lerp(0, 0.95, wide), lerp(29.87, 31.05, wide), 0);
  KF[K.window].f = lerp(44, 46, wide);

  // 桌前：寬螢幕看板到桌面前緣填滿畫面、構圖偏右（左邊牆上放文案）；
  // 直式量看板的寬度（看板與中間螢幕完整），看板上緣在進度列下方，桌面前緣以下留給文案，不拍天花板
  const deskFov = lerp(50, 40, wide);
  const eyeY = lerp(30.9, 30.86, wide);
  // 晨班的直式：看板往下放（上緣在畫面四成的地方），吊燈與看板之間留一段曬亮的牆給文案；地板壓暗了，不把文案放在地板上
  const portraitDawn = dawn * (1 - wide);
  const aim = aimDesk(
    deskFov,
    aspect,
    eyeY,
    lerp(lerp(0.12, 0.4, portraitDawn), 0.2, wide),
    lerp(lerp(0.6, 0.88, portraitDawn), 0.78, wide),
    lerp(0.84, 1.16, wide),
    wide > 0.5 ? DESK.monitorZ : DESK.boardZ,
  );
  const lookZ = -2.4;
  const lookY = eyeY + Math.tan(aim.pitch) * (aim.z - lookZ);
  const shiftX = lerp(0, lerp(-0.55, 0.55, dawn), wide);
  KF[K.desk].p.set(shiftX * 0.3, eyeY, aim.z + 0.12);
  KF[K.desk].q.set(shiftX, lookY, lookZ);
  KF[K.desk].f = deskFov;
  KF[K.deskHold].p.set(shiftX * 0.3, eyeY, aim.z);
  KF[K.deskHold].q.set(shiftX, lookY, lookZ);
  KF[K.deskHold].f = deskFov;
  // 剛進窗時還是廣角，再收到桌前的視角；位置一定在桌前那格的後面（鏡頭只往前走）
  KF[K.inside].p.set(0, 30.95, Math.max(1.0, aim.z + 0.35));
  KF[K.inside].f = lerp(deskFov + 6, 50, wide);

  // 交接開始（0.92）：推到三台螢幕前（寬螢幕三台整排在畫面裡，直式中間那台約八成寬），之後交接再推到終點
  const closeFov = endCam.f;
  KF[K.close].f = closeFov;
  const portraitP = V3();
  const portraitQ = V3();
  portraitCloseCamera(close, aspect, closeFov, portraitP, portraitQ);
  // 寬螢幕：置中、比桌前更近；看板上緣壓低到約四分之一（跟上方交接文案那一列隔開一段牆，燈色的看板不跟「進入觀測台」搶），
  // 三台螢幕整排在畫面裡，桌面前緣在畫面最下面
  const eyeC = 30.8;
  const aimC = aimDesk(closeFov, aspect, eyeC, 0.255, 0.94, close.halfW, DESK.monitorZ);
  const wideQ = V3(0, eyeC + Math.tan(aimC.pitch) * (aimC.z - lookZ), lookZ);
  // 一定比桌前那一格更靠近（鏡頭只往前推）
  const wideP = V3(0, eyeC, Math.min(aimC.z, aim.z - 0.3));
  KF[K.close].q.lerpVectors(portraitQ, wideQ, wide);
  KF[K.close].p.lerpVectors(portraitP, wideP, wide);
  KF[K.end].f = endCam.f;
  KF[K.end].p.copy(endCam.p);
  KF[K.end].q.copy(endCam.q);
}

function cr(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: number, out: Vector3) {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  out.set(f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y), f(p0.z, p1.z, p2.z, p3.z));
}

/** 取 t 時的鏡頭位置與注視點（寫進 outP、outQ），回傳視角 */
export function evalCamera(KF: Keyframe[], t: number, outP: Vector3, outQ: Vector3): number {
  let i = 0;
  while (i < KF.length - 2 && t > KF[i + 1].t) i++;
  const a = KF[i];
  const b = KF[i + 1];
  const u = clamp((t - a.t) / (b.t - a.t), 0, 1);
  // 最後一段（交接：推到終點）走直線：位置、注視點都沿著同一條線推進，畫面不會中途上下晃（曲線由 handoffCameraT 給）
  if (i + 1 === KF.length - 1) {
    outP.lerpVectors(a.p, b.p, u);
    outQ.lerpVectors(a.q, b.q, u);
    return lerp(a.f, b.f, u);
  }
  const p0 = KF[Math.max(0, i - 1)];
  const p3 = KF[Math.min(KF.length - 1, i + 2)];
  cr(p0.p, a.p, b.p, p3.p, u, outP);
  cr(p0.q, a.q, b.q, p3.q, u, outQ);
  return lerp(a.f, b.f, u * u * (3 - 2 * u));
}

/**
 * 交接：畫面上的一個矩形（舞台 px）放在鏡頭前 d 公尺、正對鏡頭的平面上，是鏡頭座標裡的哪一塊。
 * 中心寫進 out（鏡頭座標，z = −d），回傳寬高（公尺）。不論鏡頭朝哪裡，投影回去都剛好是這個矩形。
 */
export function rectInView(fovDeg: number, aspect: number, stage: { w: number; h: number }, d: number, rect: { left: number; right: number; top: number; bottom: number }, out: Vector3) {
  const t = Math.tan(MathUtils.degToRad(fovDeg) / 2);
  const hh = d * t;
  const hw = hh * aspect;
  const toX = (px: number) => ((px / stage.w) * 2 - 1) * hw;
  const toY = (py: number) => (1 - (py / stage.h) * 2) * hh;
  const x0 = toX(rect.left);
  const x1 = toX(rect.right);
  const y0 = toY(rect.top);
  const y1 = toY(rect.bottom);
  out.set((x0 + x1) / 2, (y0 + y1) / 2, -d);
  return { w: x1 - x0, h: y0 - y1, pxToM: (2 * hh) / stage.h };
}
