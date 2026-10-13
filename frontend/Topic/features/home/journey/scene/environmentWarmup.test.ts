import assert from 'node:assert/strict';
import * as THREE from 'three';
import { warmEnvironmentShaders } from './environmentWarmup';

function fixture() {
  const previousTarget = new THREE.WebGLRenderTarget(4, 4);
  const targets = new Set<THREE.WebGLRenderTarget>();
  const disposed = new Set<THREE.WebGLRenderTarget>();
  const pending: { resolve(value: THREE.Object3D): void; reject(error: unknown): void; object: THREE.Object3D }[] = [];
  const compiledMaterials = new Set<THREE.Material>();
  const programs: {
    program: { polls: number; readyAfter: number };
    reflections: number;
    getUniforms(): void;
    getAttributes(): void;
  }[] = [];
  let reflectionTaskAvailable = true;
  let currentTarget: THREE.WebGLRenderTarget | null = previousTarget;
  let activeFace = 2;
  let activeMip = 3;
  let drawCalls = 0;
  const render = () => { drawCalls++; };
  const renderer = {
    render,
    info: { programs },
    getContext: () => ({
      getExtension: () => ({ COMPLETION_STATUS_KHR: 0x91b1 }),
      getProgramParameter(program: { polls: number; readyAfter: number }) {
        program.polls++;
        return program.polls >= program.readyAfter;
      },
    }),
    toneMapping: THREE.ACESFilmicToneMapping,
    autoClear: true,
    xr: { enabled: true },
    state: { buffers: { depth: { getReversed: () => false } } },
    getClearColor: (color: THREE.Color) => color.setRGB(0.1, 0.2, 0.3),
    getRenderTarget: () => currentTarget,
    getActiveCubeFace: () => activeFace,
    getActiveMipmapLevel: () => activeMip,
    setRenderTarget(target: THREE.WebGLRenderTarget | null, face = 0, mip = 0) {
      currentTarget = target;
      activeFace = face;
      activeMip = mip;
      if (target && target !== previousTarget && !targets.has(target)) {
        targets.add(target);
        target.addEventListener('dispose', () => disposed.add(target));
      }
    },
    compileAsync(object: THREE.Object3D) {
      assert.notEqual(currentTarget, previousTarget, 'Compile must see the actual PMREM render target');
      object.traverse((child) => {
        const material = (child as THREE.Mesh).material;
        if (material) (Array.isArray(material) ? material : [material]).forEach((entry) => {
          if (compiledMaterials.has(entry)) return;
          compiledMaterials.add(entry);
          programs.push({
            program: { polls: 0, readyAfter: 2 },
            reflections: 0,
            getUniforms() {
              assertRestored();
              assert.ok(reflectionTaskAvailable, 'Each PMREM program reflection must get a separate task');
              assert.ok(this.program.polls >= this.program.readyAfter, 'Wait for every PMREM shader before reflection');
              reflectionTaskAvailable = false;
              setTimeout(() => { reflectionTaskAvailable = true; }, 0);
              this.reflections++;
            },
            getAttributes() { assert.ok(this.reflections > 0); },
          });
        });
      });
      return new Promise<THREE.Object3D>((resolve, reject) => { pending.push({ resolve, reject, object }); });
    },
  } as unknown as THREE.WebGLRenderer;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x123456);
  const background = scene.background;
  const material = new THREE.MeshStandardMaterial();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), material));

  const assertRestored = () => {
    assert.equal(renderer.render, render);
    assert.equal(renderer.getRenderTarget(), previousTarget);
    assert.equal(renderer.getActiveCubeFace(), 2);
    assert.equal(renderer.getActiveMipmapLevel(), 3);
    assert.equal(renderer.toneMapping, THREE.ACESFilmicToneMapping);
    assert.equal(renderer.autoClear, true);
    assert.equal(renderer.xr.enabled, true);
    assert.equal(scene.background, background);
  };
  const settle = () => pending.forEach(({ resolve, object }) => resolve(object));
  const dispose = () => {
    pmrem.dispose();
    scene.traverse((object) => (object as THREE.Mesh).geometry?.dispose());
    material.dispose();
    previousTarget.dispose();
  };
  return { renderer, pmrem, scene, pending, targets, disposed, compiledMaterials, programs, material, assertRestored, settle, dispose, draws: () => drawCalls };
}

async function main() {
  const successful = fixture();
  const ready = warmEnvironmentShaders(successful.renderer, successful.pmrem, successful.scene, 0.04);
  successful.assertRestored();
  assert.equal(successful.draws(), 0, 'Warmup submits no draw calls');
  assert.equal(successful.targets.size, 2, 'The real PMREM pass visits its output and ping-pong maps');
  assert.equal(successful.disposed.size, 0, 'Targets must remain valid while compilation is pending');
  assert.ok(successful.compiledMaterials.has(successful.material));
  const names = [...successful.compiledMaterials].map((material) => material.name);
  assert.ok(names.includes('PMREM.Background'));
  assert.ok(names.some((name) => name.toLowerCase().includes('blur')), 'The nonzero sigma blur shader is included');
  assert.ok(names.some((name) => name.toLowerCase().includes('ggx')), 'GGX convolution is included');
  successful.settle();
  await ready;
  assert.ok(successful.programs.every((program) => program.reflections === 1), 'All PMREM shaders finish first-use reflection before actual rendering');
  assert.equal(successful.disposed.size, 1, 'Only the dummy output is released; the generator retains its internals');
  const materialsBefore = new Set(successful.compiledMaterials);
  const again = warmEnvironmentShaders(successful.renderer, successful.pmrem, successful.scene, 0.04);
  assert.deepEqual(successful.compiledMaterials, materialsBefore, 'The generator reuses the prepared shader materials');
  successful.settle();
  await again;
  assert.ok(successful.programs.every((program) => program.reflections === 1), 'Previously prepared programs are not reflected again');
  successful.dispose();

  const cancelled = fixture();
  const abort = new AbortController();
  const cancellation = warmEnvironmentShaders(cancelled.renderer, cancelled.pmrem, cancelled.scene, 0.04, abort.signal);
  abort.abort();
  await assert.rejects(cancellation, { name: 'AbortError' });
  cancelled.assertRestored();
  assert.equal(cancelled.disposed.size, 1);
  cancelled.settle();
  cancelled.dispose();

  const alreadyCancelled = fixture();
  await assert.rejects(warmEnvironmentShaders(alreadyCancelled.renderer, alreadyCancelled.pmrem, alreadyCancelled.scene, 0.04, abort.signal), { name: 'AbortError' });
  assert.equal(alreadyCancelled.targets.size, 0, 'Already cancelled startup must not allocate PMREM targets');
  alreadyCancelled.assertRestored();
  alreadyCancelled.dispose();

  const rejected = fixture();
  const rejectedFailure = new Error('Asynchronous compile failure');
  const rejection = warmEnvironmentShaders(rejected.renderer, rejected.pmrem, rejected.scene, 0.04);
  rejected.pending[0].reject(rejectedFailure);
  await assert.rejects(rejection, rejectedFailure);
  rejected.assertRestored();
  assert.equal(rejected.disposed.size, 1);
  rejected.settle();
  rejected.dispose();

  const failed = fixture();
  const failure = new Error('Compile failed');
  failed.renderer.compileAsync = () => { throw failure; };
  await assert.rejects(warmEnvironmentShaders(failed.renderer, failed.pmrem, failed.scene, 0.04), failure);
  failed.assertRestored();
  assert.equal(failed.disposed.size, 1, 'Even a synchronous compile failure releases the captured output');
  failed.dispose();
  console.log('PMREM shader warmup, state restoration, material reuse, and cancellation tests passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
