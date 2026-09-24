
import React, { useRef, useMemo, useCallback, useState, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { createNoise3D } from 'simplex-noise';
import * as THREE from 'three';
import { useHtmlDarkClass } from '@/lib/hooks/useClientEnv';

const noise3D = createNoise3D();

/* ── Particle Field：Additive 混合避免半透明球重疊成「整片霧暈」── */

function ParticleField({
  count = 1200,
  isDark = true,
  slowMotion = false,
  sphereSegments = 10,
}: {
  count?: number;
  isDark?: boolean;
  /** 系統偏好減少動態時：只放慢漂移，仍保持漂浮（不凍結） */
  slowMotion?: boolean;
  /** 球體網格細分；行動裝置降低以減少 GPU 負擔 */
  sphereSegments?: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const mouseRef = useRef({ x: 0, y: 0 });
  const { viewport } = useThree();

  const particles = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    const scales = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 20;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 14;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 10;
      speeds[i] = 0.2 + Math.random() * 0.6;
      scales[i] = 0.35 + Math.random() * 0.85;
    }
    return { positions, speeds, scales };
  }, [count]);

  const color1 = useMemo(() => new THREE.Color('#ffa95a'), []);
  const color2 = useMemo(() => new THREE.Color('#ffd6b8'), []);
  const tempColor = useMemo(() => new THREE.Color(), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const handlePointerMove = useCallback(
    (e: THREE.Event & { point: THREE.Vector3 }) => {
      mouseRef.current.x = (e.point.x / viewport.width) * 2;
      mouseRef.current.y = (e.point.y / viewport.height) * 2;
    },
    [viewport],
  );

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    /* 一般：較明顯漂移；減少動態：同方向慢速漂移，仍持續動畫 */
    const timeScale = slowMotion ? 0.05 : 0.16;
    const t = clock.getElapsedTime() * timeScale;
    const parallax = slowMotion ? 0.1 : 0.26;
    const mx = mouseRef.current.x * parallax;
    const my = mouseRef.current.y * parallax;

    for (let i = 0; i < count; i++) {
      const ix = i * 3;
      const baseX = particles.positions[ix];
      const baseY = particles.positions[ix + 1];
      const baseZ = particles.positions[ix + 2];
      const speed = particles.speeds[i];
      const scale = particles.scales[i];

      const nx = noise3D(baseX * 0.15, baseY * 0.15, t * speed) * 1.22;
      const ny = noise3D(baseX * 0.15 + 100, baseY * 0.15 + 100, t * speed) * 1.22;
      const nz = noise3D(baseX * 0.15 + 200, baseY * 0.15 + 200, t * speed) * 0.52;

      dummy.position.set(
        baseX + nx + mx * (1 - Math.abs(baseZ) / 5),
        baseY + ny + my * (1 - Math.abs(baseZ) / 5),
        baseZ + nz,
      );

      const pulse = (Math.sin(t * 2.2 + i * 0.08) + 1) / 2;
      const s = scale * (0.038 + 0.024 * pulse);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);

      const blend = (Math.sin(t * 1.4 + i * 0.37) + 1) / 2;
      tempColor.copy(color1).lerp(color2, blend);
      tempColor.multiplyScalar(isDark ? 0.88 : 0.82);
      meshRef.current.setColorAt(i, tempColor);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
  });

  return (
    <group>
      <mesh onPointerMove={handlePointerMove} visible={false}>
        <planeGeometry args={[100, 100]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
      <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
        <sphereGeometry args={[1, sphereSegments, sphereSegments]} />
        <meshBasicMaterial
          transparent
          opacity={isDark ? 0.28 : 0.24}
          toneMapped={false}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          color="#ffffff"
        />
      </instancedMesh>
    </group>
  );
}

function useMobileViewport() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 640px)');
    const onChange = () => setMobile(mql.matches);
    mql.addEventListener('change', onChange);
    setMobile(mql.matches);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return mobile;
}

function Scene({
  isDark,
  lowPower,
  isMobile,
  slowMotion,
}: {
  isDark: boolean;
  lowPower: boolean;
  isMobile: boolean;
  slowMotion: boolean;
}) {
  const count = isMobile ? (lowPower ? 72 : 120) : lowPower ? 320 : 560;
  const segments = isMobile ? 6 : 10;
  return (
    <>
      <ambientLight intensity={isDark ? 0.22 : 0.42} />
      <pointLight position={[5, 5, 5]} intensity={isDark ? 0.45 : 0.38} color="#ffd6b8" />
      <ParticleField count={count} isDark={isDark} slowMotion={slowMotion} sphereSegments={segments} />
    </>
  );
}

interface ParticleBackgroundProps {
  className?: string;
}

function useReducedMotionMedia() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener('change', onChange);
    setReduced(mql.matches);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

function useLowPowerCanvas() {
  const [low, setLow] = useState(false);
  useEffect(() => {
    const cores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 8) : 8;
    const saveData =
      typeof navigator !== 'undefined' &&
      'connection' in navigator &&
      (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    setLow(cores <= 4 || Boolean(saveData));
  }, []);
  return low;
}

function usePageVisible() {
  const [visible, setVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  );
  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
  return visible;
}

function ParticleBackgroundInner({ className = '' }: ParticleBackgroundProps) {
  const isDark = useHtmlDarkClass();
  const reducedMotion = useReducedMotionMedia();
  const lowPower = useLowPowerCanvas();
  const isMobile = useMobileViewport();
  const pageVisible = usePageVisible();

  return (
    <div className={`absolute inset-0 h-full min-h-[100dvh] w-full ${className}`} aria-hidden>
      <Canvas
        className="h-full w-full touch-none"
        dpr={isMobile ? 1 : [1, 1.5]}
        frameloop={pageVisible ? 'always' : 'never'}
        camera={{ position: [0, 0, 6], fov: 60 }}
        style={{ pointerEvents: 'none', display: 'block' }}
        gl={{
          antialias: !isMobile,
          alpha: true,
          powerPreference: isMobile || lowPower ? 'low-power' : 'high-performance',
        }}
      >
        <Scene
          isDark={isDark}
          lowPower={lowPower}
          isMobile={isMobile}
          slowMotion={reducedMotion}
        />
      </Canvas>
    </div>
  );
}

export default ParticleBackgroundInner;
