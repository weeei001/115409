/**
 * 材質的近距離細節與觀測室的環境遮蔽（three 0.186，不加套件）。
 *
 * - 細節：用世界座標做三向投影（triplanar），貼一張可無縫重複的灰階高度圖，同時做凹凸與一點反照率起伏。
 *   不靠模型的 UV，所以長條的桌板、圓柱的牆都不會被拉長；超過 fadeFar 公尺就淡掉（遠景只靠原本的貼圖）。
 * - 環境遮蔽（只給觀測室）：依房間的形狀（圓牆、地板、天花板）與幾個方盒遮擋物（書桌、看板…）算出角落、
 *   桌下、物件邊緣的暗部，壓在間接光（半球光、環境光貼圖）上，直射光只壓一點。
 *
 * 同一組設定的材質共用同一個 shader program（customProgramCacheKey），uniform 各自獨立。
 */
import * as THREE from 'three';
import { TAU, clamp, mulberry32, pnoise2 } from './noise';

/** 觀測室遮蔽用的方盒：中心、半邊長，w 是影響距離（公尺） */
export interface AoBox {
  c: [number, number, number];
  h: [number, number, number];
  range: number;
}

export interface RoomAo {
  /** 房間半徑、地板高、天花板高 */
  radius: number;
  floor: number;
  ceiling: number;
  boxes: AoBox[];
}

export interface DetailOptions {
  /** 灰階高度圖（可無縫重複，資料貼圖） */
  map: THREE.Texture;
  /** 每公尺幾個週期 */
  scale: number;
  /** 凹凸強度（0 不做） */
  bump: number;
  /** 反照率起伏（0–1） */
  albedo: number;
  /** x、z 兩個投影面轉 90°：木紋順著垂直方向（牆裙的直板） */
  vertical?: boolean;
  /** 細節的凹凸在這個距離以外淡掉（公尺） */
  fadeFar?: number;
  /** 觀測室的環境遮蔽（同一個物件的所有材質共用） */
  ao?: { uniforms: Record<string, THREE.IUniform>; strength: number; direct: number } | null;
}

export const AO_MAX = 8;

/** 觀測室遮蔽的 uniform（所有室內材質共用同一份，改值時全部一起變） */
export function roomAoUniforms(room: RoomAo): Record<string, THREE.IUniform> {
  const c: THREE.Vector3[] = [];
  const h: THREE.Vector4[] = [];
  for (let i = 0; i < AO_MAX; i++) {
    const b = room.boxes[i];
    c.push(b ? new THREE.Vector3(...b.c) : new THREE.Vector3(0, -999, 0));
    h.push(b ? new THREE.Vector4(b.h[0], b.h[1], b.h[2], b.range) : new THREE.Vector4(0, 0, 0, 0.001));
  }
  return {
    uAoRoom: { value: new THREE.Vector3(room.radius, room.floor, room.ceiling) },
    uAoC: { value: c },
    uAoH: { value: h },
  };
}

const VERT_HEAD = /* glsl */ `
varying vec3 vSdPos;
varying vec3 vSdN;
`;

const VERT_BODY = /* glsl */ `
{
  vec4 sdW = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    sdW = instanceMatrix * sdW;
  #endif
  sdW = modelMatrix * sdW;
  vSdPos = sdW.xyz;
  vSdN = inverseTransformDirection( transformedNormal, viewMatrix );
}
`;

const FRAG_HEAD = /* glsl */ `
uniform sampler2D uSdMap;
uniform float uSdScale;
uniform float uSdBump;
uniform float uSdAlbedo;
uniform float uSdFar;
uniform float uSdVert;
varying vec3 vSdPos;
varying vec3 vSdN;
vec3 sdWeights( vec3 n ) {
  vec3 w = pow( abs( n ), vec3( 4.0 ) );
  return w / ( w.x + w.y + w.z + 1e-5 );
}
float sdHeight( vec3 p, vec3 w ) {
  vec2 ux = uSdVert > 0.5 ? p.yz : p.zy;
  vec2 uz = uSdVert > 0.5 ? p.yx : p.xy;
  return w.x * texture2D( uSdMap, ux * uSdScale ).r + w.y * texture2D( uSdMap, p.xz * uSdScale ).r + w.z * texture2D( uSdMap, uz * uSdScale ).r;
}
vec3 sdPerturb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir ) {
  vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
  vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
  vec3 R1 = cross( vSigmaY, surf_norm );
  vec3 R2 = cross( surf_norm, vSigmaX );
  float fDet = dot( vSigmaX, R1 ) * faceDir;
  vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
  return normalize( abs( fDet ) * surf_norm - vGrad );
}
#ifdef SD_ROOM_AO
uniform vec3 uAoRoom;
uniform vec3 uAoC[ ${AO_MAX} ];
uniform vec4 uAoH[ ${AO_MAX} ];
uniform float uAoStrength;
uniform float uAoDirect;
float sdRoomAo( vec3 p, vec3 n ) {
  float ao = 1.0;
  float r = length( p.xz );
  vec3 radial = vec3( p.x, 0.0, p.z ) / max( r, 1e-4 );
  float vertical = 1.0 - abs( n.y );
  // 牆與地板、天花板的交角
  ao *= 1.0 - 0.6 * ( 1.0 - smoothstep( 0.0, 0.75, p.y - uAoRoom.y ) ) * vertical;
  ao *= 1.0 - 0.5 * ( 1.0 - smoothstep( 0.0, 0.7, uAoRoom.z - p.y ) ) * vertical;
  // 靠近圓牆的地板、天花板與家具
  float side = 1.0 - abs( dot( n, radial ) );
  ao *= 1.0 - 0.45 * ( 1.0 - smoothstep( 0.0, 0.9, uAoRoom.x - r ) ) * side;
  // 方盒遮擋物：外面依距離與朝向變暗，裡面（桌下的空間）依深度變暗
  for ( int i = 0; i < ${AO_MAX}; i ++ ) {
    vec3 c = uAoC[ i ];
    vec4 h = uAoH[ i ];
    vec3 q = abs( p - c ) - h.xyz;
    float d = length( max( q, 0.0 ) ) + min( max( q.x, max( q.y, q.z ) ), 0.0 );
    float occ;
    if ( d < 0.0 ) {
      occ = smoothstep( 0.02, 0.22, - d );
    } else {
      vec3 cp = clamp( p, c - h.xyz, c + h.xyz ) - p;
      float cl = length( cp );
      float facing = cl > 1e-4 ? clamp( dot( n, cp / cl ) * 0.55 + 0.45, 0.0, 1.0 ) : 1.0;
      occ = ( 1.0 - smoothstep( 0.0, h.w, d ) ) * facing * smoothstep( 0.0, 0.012, d );
    }
    ao *= 1.0 - 0.62 * occ;
  }
  return mix( 1.0, ao, uAoStrength );
}
#endif
`;

const FRAG_ALBEDO = /* glsl */ `
vec3 sdN0 = normalize( vSdN );
vec3 sdw = sdWeights( sdN0 );
float sdH0 = sdHeight( vSdPos, sdw );
diffuseColor.rgb *= 1.0 + uSdAlbedo * ( sdH0 - 0.5 ) * 2.0;
`;

const FRAG_NORMAL = /* glsl */ `
{
  float sdFade = 1.0 - smoothstep( uSdFar * 0.45, uSdFar, length( vViewPosition ) );
  if ( uSdBump > 0.0 && sdFade > 0.0 ) {
    vec3 dpx = dFdx( vSdPos );
    vec3 dpy = dFdy( vSdPos );
    float hx = sdHeight( vSdPos + dpx, sdw );
    float hy = sdHeight( vSdPos + dpy, sdw );
    vec2 dH = uSdBump * sdFade * vec2( hx - sdH0, hy - sdH0 );
    normal = sdPerturb( - vViewPosition, normal, dH, faceDirection );
  }
}
`;

const FRAG_AO = /* glsl */ `
#ifdef SD_ROOM_AO
{
  vec3 aoN = sdN0;
  #ifdef DOUBLE_SIDED
    aoN *= faceDirection;
  #endif
  float sdAo = sdRoomAo( vSdPos, aoN );
  reflectedLight.indirectDiffuse *= sdAo;
  reflectedLight.indirectSpecular *= sdAo;
  reflectedLight.directDiffuse *= mix( 1.0, sdAo, uAoDirect );
  reflectedLight.directSpecular *= mix( 1.0, sdAo, uAoDirect );
}
#endif
`;

/** 幫 MeshStandardMaterial 加上近距離細節（與觀測室的遮蔽） */
export function addSurfaceDetail(material: THREE.MeshStandardMaterial, o: DetailOptions): THREE.MeshStandardMaterial {
  const ao = o.ao ?? null;
  const own: Record<string, THREE.IUniform> = {
    uSdMap: { value: o.map },
    uSdScale: { value: o.scale },
    uSdBump: { value: o.bump },
    uSdAlbedo: { value: o.albedo },
    uSdFar: { value: o.fadeFar ?? 14 },
    uSdVert: { value: o.vertical ? 1 : 0 },
  };
  if (ao) {
    own.uAoStrength = { value: ao.strength };
    own.uAoDirect = { value: ao.direct };
  }
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, own);
    if (ao) Object.assign(shader.uniforms, ao.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${VERT_BODY}`);
    shader.fragmentShader = (ao ? '#define SD_ROOM_AO\n' : '') +
      shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAG_HEAD}`)
        .replace('#include <map_fragment>', `#include <map_fragment>\n${FRAG_ALBEDO}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAG_NORMAL}`)
        .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${FRAG_AO}`);
  };
  material.customProgramCacheKey = () => (ao ? 'beacon-detail-ao' : 'beacon-detail');
  return material;
}

/* ---------- 細節高度圖（可無縫重複的灰階） ---------- */

function toTexture(c: HTMLCanvasElement, aniso: number): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function canvas(n: number): [HTMLCanvasElement, CanvasRenderingContext2D, ImageData] {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const x = c.getContext('2d') as CanvasRenderingContext2D;
  return [c, x, x.createImageData(n, n)];
}

/** 週期 P 的 fbm（貼圖邊界接得起來） */
function pfbm(u: number, v: number, base: number, oct: number, seed: number): number {
  let s = 0;
  let a = 0.5;
  let P = base;
  for (let o = 0; o < oct; o++) {
    s += a * pnoise2(u * P + seed, v * P + seed * 0.61, P);
    a *= 0.5;
    P *= 2;
  }
  return s;
}

/** 灰泥／粉刷：抹刀留下的大起伏、細砂粒與零星的小凹洞 */
export function plasterDetail(n: number, aniso: number): THREE.CanvasTexture {
  const [c, x, img] = canvas(n);
  const d = img.data;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const v = j / n;
      const trowel = pfbm(u, v, 3, 3, 7.1);
      const sand = pfbm(u, v, 32, 3, 2.3);
      const h = 0.5 + trowel * 0.55 + sand * 0.35;
      const k = (j * n + i) * 4;
      d[k] = d[k + 1] = d[k + 2] = clamp(h, 0, 1) * 255;
      d[k + 3] = 255;
    }
  x.putImageData(img, 0, 0);
  // 零星的小凹洞（離邊緣遠一點，免得在接縫被切掉一半）
  const R = mulberry32(41);
  for (let i = 0; i < n / 5; i++) {
    const px = 4 + R() * (n - 8);
    const py = 4 + R() * (n - 8);
    const r = 1 + R() * 2.4;
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, 'rgba(0,0,0,0.32)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(px - r, py - r, 2 * r, 2 * r);
  }
  return toTexture(c, aniso);
}

/** 木紋：沿 u 方向的年輪條紋（被雜訊推彎）加上細纖維，v 方向有整數條年輪所以可以重複 */
export function woodDetail(n: number, aniso: number): THREE.CanvasTexture {
  const [c, x, img] = canvas(n);
  const d = img.data;
  const rings = 14;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const v = j / n;
      const warp = pfbm(u, v, 2, 3, 5.7) * 0.9;
      const ring = Math.sin(TAU * (v * rings + warp));
      const late = Math.pow(0.5 + 0.5 * ring, 6);
      const fiber = pnoise2(u * 4 + 1.3, v * 96 + 0.7, 96) * 0.5 + pnoise2(u * 8 + 3.1, v * 192 + 2.2, 192) * 0.25;
      const h = 0.62 - late * 0.38 + fiber * 0.3 + pfbm(u, v, 8, 2, 1.9) * 0.12;
      const k = (j * n + i) * 4;
      d[k] = d[k + 1] = d[k + 2] = clamp(h, 0, 1) * 255;
      d[k + 3] = 255;
    }
  x.putImageData(img, 0, 0);
  return toTexture(c, aniso);
}

/** 石材：粗顆粒與幾道細裂紋（窗台、托架、屋子的基座） */
export function stoneDetail(n: number, aniso: number): THREE.CanvasTexture {
  const [c, x, img] = canvas(n);
  const d = img.data;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const v = j / n;
      const grain = pfbm(u, v, 16, 3, 4.4);
      const blot = pfbm(u, v, 4, 3, 8.8);
      const vein = 1 - Math.abs(pfbm(u, v, 3, 4, 2.6));
      const h = 0.55 + grain * 0.45 + blot * 0.35 - Math.pow(vein, 18) * 0.35;
      const k = (j * n + i) * 4;
      d[k] = d[k + 1] = d[k + 2] = clamp(h, 0, 1) * 255;
      d[k + 3] = 255;
    }
  x.putImageData(img, 0, 0);
  return toTexture(c, aniso);
}
