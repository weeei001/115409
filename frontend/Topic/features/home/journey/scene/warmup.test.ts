import assert from 'node:assert/strict';
import * as THREE from 'three';
import { prepareScene } from './warmup';

interface CapturedBatch {
  objects: THREE.Mesh[];
  target: THREE.WebGLRenderTarget | null;
  fog: THREE.Scene['fog'];
  environment: THREE.Scene['environment'];
}

function fixture() {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x102030, 0.02);
  scene.environment = new THREE.Texture();
  const camera = new THREE.PerspectiveCamera();
  const originalTarget = new THREE.WebGLRenderTarget(2, 2);
  let target: THREE.WebGLRenderTarget | null = originalTarget;
  let face = 3;
  let mip = 2;
  const batches: CapturedBatch[] = [];
  const programs: { program: { polls: number; readyAfter: number }; reflected: boolean; getUniforms(): void; getAttributes(): void }[] = [];
  let reflectionTaskAvailable = true;
  const context = {
    getExtension: (): { COMPLETION_STATUS_KHR: number } | null => null,
    getProgramParameter(program: { polls: number; readyAfter: number }) {
      program.polls++;
      return program.polls >= program.readyAfter;
    },
  };
  const renderer = {
    shadowMap: { enabled: true },
    info: { programs },
    getContext: () => context,
    getRenderTarget: () => target,
    getActiveCubeFace: () => face,
    getActiveMipmapLevel: () => mip,
    setRenderTarget(next: THREE.WebGLRenderTarget | null, nextFace = 0, nextMip = 0) {
      target = next;
      face = nextFace;
      mip = nextMip;
    },
    compileAsync(group: THREE.Object3D, _camera: THREE.Camera, actualScene: THREE.Scene) {
      assert.equal(actualScene, scene);
      const objects = group.children as THREE.Mesh[];
      assert.ok(objects.length <= 8);
      assert.equal(new Set(objects.map((object) => object.material)).size, objects.length, 'every material variant has its own readiness check');
      batches.push({ objects, target, fog: scene.fog, environment: scene.environment });
      // Double-sided materials can link two programs from a single compile job.
      for (let i = 0; i < 2; i++) {
        programs.push({
          program: { polls: 0, readyAfter: 0 },
          reflected: false,
          getUniforms() {
            assert.ok(reflectionTaskAvailable, 'each program reflection gets a separate task');
            assert.ok(this.program.polls >= this.program.readyAfter, 'all variants finish linking before reflection');
            reflectionTaskAvailable = false;
            setTimeout(() => { reflectionTaskAvailable = true; }, 0);
            this.reflected = true;
          },
          getAttributes() { assert.ok(this.reflected); },
        });
      }
      return Promise.resolve().then(() => {
        assert.equal(target, originalTarget, 'restore the output before awaiting compilation');
        assert.equal(face, 3);
        assert.equal(mip, 2);
        assert.ok(scene.fog);
        assert.ok(scene.environment);
        return group;
      });
    },
  };
  return { scene, camera, originalTarget, batches, renderer, gl: renderer as unknown as THREE.WebGLRenderer };
}

async function run() {
  const f = fixture();
  const source = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), alphaMap: new THREE.Texture(), alphaTest: 0.3, side: THREE.FrontSide });
  const geometry = new THREE.BoxGeometry();
  const normal = new THREE.Mesh(geometry, source);
  normal.castShadow = true;
  const duplicate = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), source);
  duplicate.castShadow = true;
  const instanced = new THREE.InstancedMesh(geometry, source, 2);
  instanced.castShadow = true;
  instanced.setColorAt(0, new THREE.Color('red'));
  const directional = new THREE.DirectionalLight();
  const point = new THREE.PointLight();
  directional.castShadow = point.castShadow = true;
  f.scene.add(normal, duplicate, instanced, directional, point);
  const parent = normal.parent;
  let sourceDisposed = false;
  source.addEventListener('dispose', () => { sourceDisposed = true; });
  const resource = await prepareScene(f.gl, f.scene, f.camera, null);
  assert.ok(f.renderer.info.programs.every((program) => program.reflected), 'linking also prepares reflection before the first draw');
  const normalBatches = f.batches.filter((batch) => batch.fog !== null);
  assert.equal(normalBatches.flatMap((batch) => batch.objects).length, 2, 'reuse programs for identical material/geometry features');
  assert.ok(normalBatches.every((batch) => batch.target === null));
  assert.equal(normal.material, source);
  assert.equal(normal.parent, parent, 'warmup never reparents original objects');
  const shadowBatches = f.batches.filter((batch) => batch.fog === null);
  const shadowObjects = shadowBatches.flatMap((batch) => batch.objects);
  assert.equal(shadowObjects.length, 4, 'depth and point shadow programs cover ordinary and instanced meshes');
  assert.ok(shadowBatches.every((batch) => batch.environment === null && batch.target !== null));
  const warmedInstances = shadowObjects.filter((object) => (object as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh[];
  assert.equal(warmedInstances.length, 2);
  assert.ok(warmedInstances.every((object) => object.instanceColor !== null));
  const shadowMaterials = new Set(shadowObjects.map((object) => object.material as THREE.MeshDepthMaterial));
  let disposed = 0;
  for (const material of shadowMaterials) {
    assert.equal(material.side, THREE.BackSide);
    assert.equal(material.map, source.map);
    assert.equal(material.alphaMap, source.alphaMap);
    assert.equal(material.alphaTest, 0.3);
    if (material.isMeshDepthMaterial) assert.equal(material.depthPacking, THREE.BasicDepthPacking);
    material.addEventListener('dispose', () => { disposed++; });
  }
  assert.equal(disposed, 0, 'compiled shadow programs stay retained until world disposal');
  resource.dispose();
  resource.dispose();
  assert.equal(disposed, 2, 'disposal is idempotent');
  assert.equal(sourceDisposed, false);

  const subclass = fixture();
  const procedural = new THREE.Mesh(geometry, source);
  procedural.clone = () => { throw new Error('procedural subclasses must not be reconstructed'); };
  subclass.scene.add(procedural);
  const subclassResource = await prepareScene(subclass.gl, subclass.scene, subclass.camera, null);
  subclassResource.dispose();

  const parallel = fixture();
  parallel.scene.add(normal.clone());
  parallel.renderer.getContext().getExtension = () => ({ COMPLETION_STATUS_KHR: 0x91b1 });
  const compileParallel = parallel.renderer.compileAsync;
  parallel.renderer.compileAsync = (group, camera, scene) => {
    const result = compileParallel(group, camera, scene);
    parallel.renderer.info.programs[0].program.readyAfter = 3;
    return result;
  };
  const parallelResource = await prepareScene(parallel.gl, parallel.scene, parallel.camera, null);
  assert.equal(parallel.renderer.info.programs[0].program.polls, 3, 'wait for the non-current double-sided variant');
  parallelResource.dispose();

  const queued = fixture();
  for (let i = 0; i < 9; i++) queued.scene.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()));
  const submitQueued = queued.renderer.compileAsync;
  const releaseBatches: (() => void)[] = [];
  queued.renderer.compileAsync = (group, camera, scene) => {
    assert.ok(queued.renderer.info.programs.every((program) => !program.reflected), 'submit all batches before reflection');
    const compiled = submitQueued(group, camera, scene);
    const release = new Promise<void>((resolve) => { releaseBatches.push(resolve); });
    if (releaseBatches.length === 2) releaseBatches.forEach((resolve) => resolve());
    return compiled.then(async (object) => { await release; return object; });
  };
  let queueTimeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const queuedResource = await Promise.race([
      prepareScene(queued.gl, queued.scene, queued.camera, null),
      new Promise<never>((_, reject) => { queueTimeout = setTimeout(() => reject(new Error('the second batch waited for the first batch to finish')), 500); }),
    ]);
    assert.equal(releaseBatches.length, 2, 'GPU compilation overlaps across submission batches');
    queuedResource.dispose();
  } finally {
    clearTimeout(queueTimeout);
  }

  const reflectionAbort = fixture();
  reflectionAbort.scene.add(normal.clone());
  const reflectionController = new AbortController();
  reflectionAbort.renderer.getContext().getExtension = () => ({ COMPLETION_STATUS_KHR: 0x91b1 });
  reflectionAbort.renderer.getContext().getProgramParameter = () => {
    reflectionController.abort(new Error('cancel shader readiness polling'));
    return false;
  };
  await assert.rejects(prepareScene(reflectionAbort.gl, reflectionAbort.scene, reflectionAbort.camera, null, reflectionController.signal), /cancel shader readiness polling/);
  assert.ok(reflectionAbort.renderer.info.programs.every((program) => !program.reflected));

  const noShadows = fixture();
  noShadows.scene.add(normal.clone(), directional.clone(), point.clone());
  const plain = await prepareScene(noShadows.gl, noShadows.scene, noShadows.camera, null, undefined, { shadows: false });
  assert.ok(noShadows.batches.every((batch) => batch.fog !== null));
  plain.dispose();

  const aborted = fixture();
  const controller = new AbortController();
  aborted.scene.add(normal.clone(), directional.clone());
  const abortReason = new Error('route changed');
  const compile = aborted.renderer.compileAsync;
  let cancelledMaterial: THREE.Material | undefined;
  let cancelledDisposed = false;
  aborted.renderer.compileAsync = (group, camera, scene) => {
    if (scene.fog === null) {
      cancelledMaterial = (group.children[0] as THREE.Mesh).material as THREE.Material;
      cancelledMaterial.addEventListener('dispose', () => { cancelledDisposed = true; });
      controller.abort(abortReason);
    }
    return compile(group, camera, scene);
  };
  await assert.rejects(prepareScene(aborted.gl, aborted.scene, aborted.camera, null, controller.signal), (error) => error === abortReason);
  assert.ok(cancelledMaterial);
  assert.equal(cancelledDisposed, true, 'cancellation releases retained preparation resources');
  assert.equal(aborted.renderer.getRenderTarget(), aborted.originalTarget);
  assert.ok(aborted.scene.fog);

  const pending = fixture();
  pending.scene.add(normal.clone());
  const pendingController = new AbortController();
  pending.renderer.compileAsync = () => {
    setTimeout(() => pendingController.abort(abortReason), 0);
    return new Promise(() => {});
  };
  await assert.rejects(prepareScene(pending.gl, pending.scene, pending.camera, null, pendingController.signal), (error) => error === abortReason);
  assert.equal(pending.renderer.getRenderTarget(), pending.originalTarget, 'context loss cannot hold startup open indefinitely');

  const submitAbort = fixture();
  for (let i = 0; i < 9; i++) submitAbort.scene.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()));
  const submitController = new AbortController();
  let rejectLate: ((error: Error) => void) | undefined;
  const unhandled: unknown[] = [];
  const captureUnhandled = (error: unknown) => { unhandled.push(error); };
  process.on('unhandledRejection', captureUnhandled);
  try {
    submitAbort.renderer.compileAsync = () => {
      setTimeout(() => submitController.abort(abortReason), 0);
      return new Promise((_, reject) => { rejectLate = reject; });
    };
    await assert.rejects(prepareScene(submitAbort.gl, submitAbort.scene, submitAbort.camera, null, submitController.signal), (error) => error === abortReason);
    assert.ok(rejectLate);
    rejectLate(new Error('driver response after cancellation'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(unhandled, [], 'observe late rejections even when aborted between batch submissions');
  } finally {
    process.removeListener('unhandledRejection', captureUnhandled);
  }

  const failed = fixture();
  failed.scene.add(normal.clone());
  const failure = new Error('context lost');
  failed.renderer.compileAsync = () => { throw failure; };
  await assert.rejects(prepareScene(failed.gl, failed.scene, failed.camera, null), (error) => error === failure);
  assert.equal(failed.renderer.getRenderTarget(), failed.originalTarget);
  assert.equal(failed.renderer.getActiveCubeFace(), 3);
  assert.equal(failed.renderer.getActiveMipmapLevel(), 2);
  assert.ok(failed.scene.fog);
  console.log('Scene shader preparation tests passed.');
}

void run();
