'use client';

import React, { useRef, useMemo, useCallback, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { usePrefersReducedMotionClient } from '../lib/usePrefersReducedMotionClient';
import { useHtmlDarkClass } from '../lib/useHtmlDarkClass';

/** 世界座標縮放：讓金幣／鈔票在畫面上更小巧、不搶版面 */
const COIN_WORLD_SCALE = 0.52;
const NOTE_WORLD_SCALE = 0.55;

/* ─────────────────────────────────────────────────────────────────────────────
   Layered-sine noise  (no external dependency needed)
   ───────────────────────────────────────────────────────────────────────────── */
function sn(x: number, y: number, t: number): number {
  return (
    Math.sin(x * 1.37 + t * 0.91) * Math.cos(y * 0.83 + t * 0.67) * 0.45 +
    Math.sin(x * 0.71 - t * 1.13) * Math.cos(y * 1.47 + t * 0.31) * 0.33 +
    Math.sin(x * 2.03 + t * 0.53) * Math.cos(y * 0.59 - t * 0.77) * 0.22
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Canvas textures (generated once, reused across instances)
   ───────────────────────────────────────────────────────────────────────────── */
function makeCoinTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(100, 88, 8, 128, 128, 128);
  g.addColorStop(0, '#FFF5B0');
  g.addColorStop(0.4, '#FFD700');
  g.addColorStop(0.82, '#CC9900');
  g.addColorStop(1, '#7A5500');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(128, 128, 122, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#996600'; ctx.lineWidth = 9; ctx.stroke();
  ctx.strokeStyle = '#FFE870'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(128, 128, 107, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = '#BB8800'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(128, 128, 95, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.font = 'bold 62px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('$', 130, 134);
  ctx.fillStyle = '#7A5500';
  ctx.fillText('$', 128, 132);
  return new THREE.CanvasTexture(c);
}

function makeNoteTexture(
  bg: string, border: string, text: string, denom: string,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg; ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = border; ctx.lineWidth = 4; ctx.strokeRect(4, 4, 248, 120);
  ctx.lineWidth = 1.5; ctx.strokeRect(8, 8, 240, 112);
  ctx.strokeStyle = border + '44'; ctx.lineWidth = 0.8;
  for (let i = 0; i < 8; i++) {
    for (let s = 0; s < 2; s++) {
      const xStart = s ? 148 : 12, xEnd = s ? 244 : 108;
      ctx.beginPath();
      for (let px = xStart; px <= xEnd; px += 2) {
        const y = 17 + i * 13 + Math.sin(px * 0.26 + s * 3.1) * 5;
        px === xStart ? ctx.moveTo(px, y) : ctx.lineTo(px, y);
      }
      ctx.stroke();
    }
  }
  ctx.fillStyle = text; ctx.textAlign = 'center';
  ctx.font = 'bold 11px serif'; ctx.fillText('中華民國', 128, 50);
  ctx.font = 'bold 21px serif'; ctx.fillText(denom, 128, 78);
  ctx.font = '8px monospace'; ctx.fillStyle = border + '88';
  ctx.fillText('BANK OF TAIWAN', 128, 105);
  return new THREE.CanvasTexture(c);
}

/* ─────────────────────────────────────────────────────────────────────────────
   Particle data helper
   ───────────────────────────────────────────────────────────────────────────── */
interface ParticleData {
  x: number; y: number; z: number;
  sp: number; sc: number;
  r0: number; r1: number; r2: number;
  tilt: number; tz: number;
}

function makeParticleData(
  n: number,
  xRange: number, yRange: number, zRange: number,
  minSp: number, maxSp: number,
  minSc: number, maxSc: number,
): ParticleData[] {
  return Array.from({ length: n }, () => ({
    x: (Math.random() - 0.5) * xRange,
    y: (Math.random() - 0.5) * yRange,
    z: (Math.random() - 0.5) * zRange,
    sp: minSp + Math.random() * (maxSp - minSp),
    sc: minSc + Math.random() * (maxSc - minSc),
    r0: Math.random() * Math.PI * 2,
    r1: Math.random() * Math.PI * 2,
    r2: (Math.random() - 0.5) * Math.PI * 0.8,
    tilt: Math.random() * Math.PI,
    tz: (Math.random() - 0.5) * 0.5,
  }));
}

/* ─────────────────────────────────────────────────────────────────────────────
   Coins
   ───────────────────────────────────────────────────────────────────────────── */
function Coins({
  count = 48, isDark = true, slowMotion = false, mouseRef,
}: {
  count?: number; isDark?: boolean; slowMotion?: boolean;
  mouseRef: React.MutableRefObject<{ x: number; y: number }>;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const data = useMemo(() => makeParticleData(count, 22, 15, 9, 0.2, 0.7, 0.22, 0.52), [count]);
  const tex = useMemo(() => makeCoinTexture(), []);
  useEffect(() => () => tex.dispose(), [tex]);

  const mat = useMemo(() => new THREE.MeshPhongMaterial({
    map: tex,
    color: 0xFFCC00,
    emissive: isDark ? 0x221100 : 0x332200,
    specular: new THREE.Color(1, 0.95, 0.5),
    shininess: 220,
    transparent: true,
    opacity: isDark ? 0.88 : 0.42,
  }), [tex, isDark]);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const et = clock.getElapsedTime();
    const t = et * (slowMotion ? 0.065 : 0.15);
    const mx = mouseRef.current.x * 0.38;
    const my = mouseRef.current.y * 0.38;

    for (let i = 0; i < count; i++) {
      const d = data[i];
      const nx = sn(d.x * 0.12, d.y * 0.12, t * d.sp) * 1.65;
      const ny = sn(d.x * 0.12 + 100, d.y * 0.12 + 100, t * d.sp) * 1.65;
      const df = 1 - Math.abs(d.z) / 6;
      dummy.position.set(d.x + nx + mx * df, d.y + ny + my * df, d.z);
      dummy.rotation.set(
        d.tilt + Math.sin(et * 0.42 + i) * 0.14,
        d.r0 + et * (slowMotion ? 0.58 : 1.85) * d.sp,
        d.tz,
      );
      dummy.scale.setScalar(d.sc * COIN_WORLD_SCALE);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <cylinderGeometry args={[1, 1, 0.15, 32]} />
      <primitive object={mat} attach="material" />
    </instancedMesh>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Banknotes  (green NT$1000 or red NT$500)
   ───────────────────────────────────────────────────────────────────────────── */
function Banknotes({
  count = 17, variant = 'green', isDark = true, slowMotion = false,
  noiseSeedOffset = 0, mouseRef,
}: {
  count?: number; variant?: 'green' | 'red'; isDark?: boolean;
  slowMotion?: boolean; noiseSeedOffset?: number;
  mouseRef: React.MutableRefObject<{ x: number; y: number }>;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const data = useMemo(() => makeParticleData(count, 24, 15, 9, 0.08, 0.3, 0.45, 1.0), [count]);

  const tex = useMemo(() => variant === 'green'
    ? makeNoteTexture('#0b2e1e', '#4ade80', '#86efac', 'NT$1000')
    : makeNoteTexture('#3a0c0c', '#f87171', '#fca5a5', 'NT$500'),
    [variant]);
  useEffect(() => () => tex.dispose(), [tex]);

  const mat = useMemo(() => new THREE.MeshPhongMaterial({
    map: tex,
    transparent: true,
    opacity: isDark ? 0.85 : 0.38,
    side: THREE.DoubleSide,
    shininess: 18,
    specular: variant === 'green'
      ? new THREE.Color(0.08, 0.25, 0.08)
      : new THREE.Color(0.25, 0.05, 0.05),
  }), [tex, isDark, variant]);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const et = clock.getElapsedTime();
    const t = et * (slowMotion ? 0.05 : 0.14);
    const mx = mouseRef.current.x * 0.3;
    const my = mouseRef.current.y * 0.3;
    const s = noiseSeedOffset;

    for (let i = 0; i < count; i++) {
      const d = data[i];
      const nx = sn(d.x * 0.09 + s, d.y * 0.09 + s, t * d.sp) * 2.15;
      const ny = sn(d.x * 0.09 + s + 60, d.y * 0.09 + s + 60, t * d.sp) * 2.15;
      dummy.position.set(d.x + nx + mx, d.y + ny + my, d.z);
      dummy.rotation.set(
        d.r2 + Math.sin(et * 0.5 * d.sp + i) * 0.38,
        d.r1 + et * (slowMotion ? 0.2 : 0.55) * d.sp,
        d.r0 * 0.3 + Math.cos(et * 0.3 * d.sp + i) * 0.12,
      );
      dummy.scale.setScalar(d.sc * NOTE_WORLD_SCALE);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <planeGeometry args={[2.0, 1.0]} />
      <primitive object={mat} attach="material" />
    </instancedMesh>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Gold sparkle dust (additive blend)
   ───────────────────────────────────────────────────────────────────────────── */
function Sparkles({
  count = 180, slowMotion = false, isDark = true,
}: { count?: number; slowMotion?: boolean; isDark?: boolean }) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const data = useMemo(() => makeParticleData(count, 22, 14, 9, 0.3, 0.9, 0.02, 0.07), [count]);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const et = clock.getElapsedTime();
    const t = et * (slowMotion ? 0.065 : 0.15);

    for (let i = 0; i < count; i++) {
      const d = data[i];
      const nx = sn(d.x * 0.15, d.y * 0.15, t * d.sp * 1.2) * 1.28;
      const ny = sn(d.x * 0.15 + 300, d.y * 0.15 + 300, t * d.sp) * 1.28;
      dummy.position.set(d.x + nx, d.y + ny, d.z);
      const pulse = 0.55 + 0.45 * Math.sin(et * 2.5 * d.sp + i * 0.35);
      dummy.scale.setScalar(d.sc * pulse);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 6, 6]} />
      <meshBasicMaterial
        color={isDark ? '#FFDD44' : '#FFD080'}
        transparent
        opacity={isDark ? 0.14 : 0.055}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </instancedMesh>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Animated key light
   ───────────────────────────────────────────────────────────────────────────── */
function AnimatedKeyLight({ isDark }: { isDark: boolean }) {
  const lightRef = useRef<THREE.PointLight>(null!);
  useFrame(({ clock }) => {
    const et = clock.getElapsedTime();
    lightRef.current.position.x = Math.sin(et * 0.27) * (isDark ? 7 : 5);
    lightRef.current.position.y = Math.cos(et * 0.18) * (isDark ? 5 : 3.5) + 2;
  });
  return (
    <pointLight
      ref={lightRef}
      position={[5, 6, 5]}
      intensity={isDark ? 2.6 : 0.95}
      color={isDark ? '#FFE090' : '#FFF8EE'}
      distance={isDark ? 55 : 70}
    />
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Scene
   ───────────────────────────────────────────────────────────────────────────── */
function Scene({
  isDark, lowPower, slowMotion,
}: { isDark: boolean; lowPower: boolean; slowMotion: boolean }) {
  const mouseRef = useRef({ x: 0, y: 0 });
  const { viewport } = useThree();

  const handlePointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      mouseRef.current.x = (e.point.x / viewport.width) * 2;
      mouseRef.current.y = (e.point.y / viewport.height) * 2;
    },
    [viewport],
  );

  const coinCount = lowPower ? 24 : 48;
  const greenCount = lowPower ? 9 : 17;
  const redCount = lowPower ? 7 : 13;
  const sparkCount = lowPower ? 80 : 180;

  return (
    <>
      {/* Invisible plane to catch pointer events for parallax */}
      <mesh onPointerMove={handlePointerMove} visible={false}>
        <planeGeometry args={[100, 100]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>

      {/* Lighting */}
      <ambientLight
        color={isDark ? '#334466' : '#ffffff'}
        intensity={isDark ? 1.0 : 0.72}
      />
      <AnimatedKeyLight isDark={isDark} />
      <pointLight
        position={[-7, -5, 4]}
        intensity={isDark ? 0.85 : 0.35}
        color={isDark ? '#2244aa' : '#b8c5e0'}
        distance={isDark ? 42 : 55}
      />
      <pointLight
        position={[0, -8, -2]}
        intensity={isDark ? 0.65 : 0.28}
        color={isDark ? '#FFAA00' : '#ffd4a8'}
        distance={isDark ? 35 : 48}
      />

      {/* Money objects */}
      <Coins count={coinCount} isDark={isDark} slowMotion={slowMotion} mouseRef={mouseRef} />
      <Banknotes
        count={greenCount} variant="green" isDark={isDark}
        slowMotion={slowMotion} noiseSeedOffset={0} mouseRef={mouseRef}
      />
      <Banknotes
        count={redCount} variant="red" isDark={isDark}
        slowMotion={slowMotion} noiseSeedOffset={150} mouseRef={mouseRef}
      />
      <Sparkles count={sparkCount} slowMotion={slowMotion} isDark={isDark} />

      {/* Atmospheric fog — 明亮模式與頁面 --color-bg 一致 */}
      <fog
        attach="fog"
        args={
          isDark
            ? ['#060a14', 18, 35]
            : ['#eef1f4', 26, 52]
        }
      />
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   System hooks
   ───────────────────────────────────────────────────────────────────────────── */
function useLowPower() {
  const [low, setLow] = useState(false);
  useEffect(() => {
    const cores = navigator.hardwareConcurrency ?? 8;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } })
      .connection?.saveData ?? false;
    setLow(cores <= 4 || saveData);
  }, []);
  return low;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Public component
   ───────────────────────────────────────────────────────────────────────────── */
interface MoneyBackgroundProps {
  /** Extra Tailwind / CSS classes applied to the wrapper div */
  className?: string;
}

export default function MoneyBackground({ className = '' }: MoneyBackgroundProps) {
  /** 與 `<html class="dark">` 同步，不依賴 ThemeContext 初次 render */
  const isDark = useHtmlDarkClass();
  const slowMotion = usePrefersReducedMotionClient();
  const lowPower = useLowPower();

  return (
    <div
      className={`absolute inset-0 h-full min-h-[100dvh] w-full ${className}`}
      aria-hidden="true"
    >
      <Canvas
        className="h-full w-full touch-none"
        dpr={[1, 1.5]}
        frameloop="always"
        camera={{ position: [0, 0, 7], fov: 60 }}
        style={{
          pointerEvents: 'none',
          display: 'block',
          background: isDark ? '#060a14' : '#f8f9fa',
        }}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      >
        <Scene isDark={isDark} lowPower={lowPower} slowMotion={slowMotion} />
      </Canvas>

      {/* Subtle grid overlay — stock chart feel */}
      <div
        aria-hidden
        style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: isDark
            ? [
                'linear-gradient(rgba(255,204,0,0.04) 1px, transparent 1px)',
                'linear-gradient(90deg, rgba(255,204,0,0.04) 1px, transparent 1px)',
              ].join(',')
            : [
                'linear-gradient(rgba(0,0,0,0.045) 1px, transparent 1px)',
                'linear-gradient(90deg, rgba(0,0,0,0.045) 1px, transparent 1px)',
                'linear-gradient(rgba(255,169,90,0.05) 1px, transparent 1px)',
              ].join(','),
          backgroundSize: '62px 46px',
        }}
      />

      {/* Vignette — 明亮模式僅輕微收邊，避免整屏變暗 */}
      <div
        aria-hidden
        style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: isDark
            ? 'radial-gradient(ellipse at 50% 50%, transparent 25%, rgba(6,10,20,0.82) 100%)'
            : 'radial-gradient(ellipse at 50% 45%, transparent 35%, rgba(0,0,0,0.045) 100%)',
        }}
      />
    </div>
  );
}
