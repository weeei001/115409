import * as THREE from 'three';
import { initializeShaderPrograms } from './shaderPrograms';
import { throwIfStartupAborted, waitForStartup, yieldStartup } from './startup';

type Renderable = THREE.Mesh | THREE.Points | THREE.Line | THREE.Sprite;
type ShadowMaterial = (THREE.MeshDepthMaterial | THREE.MeshDistanceMaterial) & { wireframe?: boolean; wireframeLinewidth?: number };
type SourceMaterial = THREE.Material & Partial<THREE.MeshStandardMaterial>;

interface CompileJob {
  object: Renderable;
  material: THREE.Material;
}

interface PreparationOptions {
  /** The second output variant of a scene can reuse its prepared shadows. */
  shadows?: boolean;
}

/** A compile-only mesh avoids invoking Water/Sky subclass constructors. */
function compileProxy(object: Renderable, material: THREE.Material): THREE.Mesh {
  const source = object as THREE.InstancedMesh & THREE.SkinnedMesh & THREE.Points & { isBatchedMesh?: boolean; _colorsTexture?: THREE.Texture | null };
  const proxy = new THREE.Mesh(object.geometry, material);
  // compileAsync only reads these object flags and the geometry attributes; it
  // never uploads instance data or draws the proxy.
  Object.assign(proxy, {
    isInstancedMesh: source.isInstancedMesh === true,
    instanceColor: source.instanceColor ?? null,
    morphTexture: source.morphTexture ?? null,
    isSkinnedMesh: source.isSkinnedMesh === true,
    isPoints: source.isPoints === true,
    isBatchedMesh: source.isBatchedMesh === true,
    _colorsTexture: source._colorsTexture ?? null,
  });
  return proxy;
}

/** Geometry features that participate in Three's shader program cache key. */
function geometryVariant(object: Renderable): string {
  const mesh = object as THREE.InstancedMesh & THREE.SkinnedMesh & { isBatchedMesh?: boolean; _colorsTexture?: THREE.Texture | null };
  const attributes = object.geometry.attributes;
  const morph = object.geometry.morphAttributes;
  return [
    object.type,
    !!mesh.isInstancedMesh,
    mesh.isInstancedMesh && mesh.instanceColor !== null,
    mesh.isInstancedMesh && mesh.morphTexture !== null,
    !!mesh.isBatchedMesh,
    mesh.isBatchedMesh && mesh._colorsTexture !== null,
    !!mesh.isSkinnedMesh,
    !!attributes.position,
    !!attributes.normal,
    !!attributes.tangent,
    !!attributes.uv,
    attributes.color?.itemSize ?? 0,
    morph.position?.length ?? -1,
    morph.normal?.length ?? -1,
    morph.color?.length ?? -1,
  ].join(':');
}

/** Match WebGLShadowMap's depth/distance material settings without changing the scene. */
function createShadowMaterial(source: SourceMaterial, point: boolean): ShadowMaterial {
  // Three r186 uses native depth textures and the default BasicDepthPacking.
  const material: ShadowMaterial = point ? new THREE.MeshDistanceMaterial() : new THREE.MeshDepthMaterial();
  material.visible = source.visible;
  material.wireframe = source.wireframe ?? false;
  material.side = source.shadowSide ?? (source.side === THREE.FrontSide ? THREE.BackSide : source.side === THREE.BackSide ? THREE.FrontSide : THREE.DoubleSide);
  material.map = source.map ?? null;
  material.alphaMap = source.alphaMap ?? null;
  material.alphaTest = source.alphaToCoverage ? 0.5 : source.alphaTest;
  material.clipShadows = source.clipShadows;
  material.clippingPlanes = source.clippingPlanes;
  material.clipIntersection = source.clipIntersection;
  material.displacementMap = source.displacementMap ?? null;
  material.displacementScale = source.displacementScale ?? 1;
  material.displacementBias = source.displacementBias ?? 0;
  material.wireframeLinewidth = source.wireframeLinewidth ?? 1;
  return material;
}

/**
 * Submit small batches with task boundaries, restoring shared state immediately.
 * Queue all batches before waiting so the GPU can compile their shaders together.
 * Reflection then checks every linked variant, including earlier currentPrograms.
 */
async function compileJobs(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  target: THREE.WebGLRenderTarget | null,
  jobs: CompileJob[],
  shadow: boolean,
  signal?: AbortSignal,
) {
  const existingPrograms = new Set(renderer.info.programs);
  const compilations: Promise<THREE.Object3D>[] = [];
  let index = 0;
  while (index < jobs.length) {
    await yieldStartup(signal);
    throwIfStartupAborted(signal);
    const batch = new THREE.Group();
    const materials = new Set<THREE.Material>();
    while (index < jobs.length && batch.children.length < 8) {
      const job = jobs[index];
      if (materials.has(job.material)) break;
      const proxy = compileProxy(job.object, job.material);
      batch.add(proxy);
      materials.add(job.material);
      index++;
    }

    const previousTarget = renderer.getRenderTarget();
    const previousFace = renderer.getActiveCubeFace();
    const previousMip = renderer.getActiveMipmapLevel();
    const previousFog = scene.fog;
    const previousEnvironment = scene.environment;
    let compilation: Promise<THREE.Object3D>;
    try {
      renderer.setRenderTarget(target);
      // Shadow rendering uses an empty scene but the actual scene's light state.
      if (shadow) {
        scene.fog = null;
        scene.environment = null;
      }
      compilation = renderer.compileAsync(batch, camera, scene);
    } finally {
      scene.fog = previousFog;
      scene.environment = previousEnvironment;
      renderer.setRenderTarget(previousTarget, previousFace, previousMip);
    }
    compilations.push(compilation);
    // A batch can reject while later batches are still yielding, or after
    // cancellation. Observe it immediately; Promise.all still reports failures.
    void compilation.catch(() => undefined);
  }
  await waitForStartup(Promise.all(compilations), signal);
  throwIfStartupAborted(signal);
  await initializeShaderPrograms(renderer, existingPrograms, signal);
}

/**
 * Prepare one scene/output variant while preserving its appearance. Keep the
 * returned resource until world disposal: releasing the temporary shadow
 * materials earlier would evict shader programs before real shadows use them.
 */
export async function prepareScene(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  target: THREE.WebGLRenderTarget | null,
  signal?: AbortSignal,
  { shadows = true }: PreparationOptions = {},
): Promise<{ dispose(): void }> {
  throwIfStartupAborted(signal);
  const retained = new Set<THREE.Material>();
  const normalJobs: CompileJob[] = [];
  const shadowJobs: CompileJob[] = [];
  const normalVariants = new Set<string>();
  const shadowVariants = new Set<string>();
  const shadowMaterials = new Map<string, ShadowMaterial>();
  let hasPointShadow = false;
  let hasDepthShadow = false;
  if (shadows && renderer.shadowMap.enabled) {
    scene.traverseVisible((object) => {
      const light = object as THREE.Light & { isPointLight?: boolean };
      if (!light.isLight || !light.castShadow || !light.layers.test(camera.layers)) return;
      if (light.isPointLight) hasPointShadow = true;
      else hasDepthShadow = true;
    });
  }

  const resource = {
    dispose() {
      retained.forEach((material) => material.dispose());
      retained.clear();
    },
  };
  let shadowTarget: THREE.WebGLRenderTarget | null = null;
  try {
    scene.traverse((object) => {
      const mesh = object as Renderable;
      if (!mesh.geometry || !mesh.material) return;
      const variant = geometryVariant(mesh);
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const key = `${material.uuid}:${variant}`;
        if (!normalVariants.has(key)) {
          normalVariants.add(key);
          normalJobs.push({ object: mesh, material });
        }
        if (!mesh.castShadow) continue;
        for (const point of [false, true]) {
          if (point ? !hasPointShadow : !hasDepthShadow) continue;
          const shadowKey = `${point}:${key}`;
          if (shadowVariants.has(shadowKey)) continue;
          shadowVariants.add(shadowKey);
          const custom = point ? mesh.customDistanceMaterial : mesh.customDepthMaterial;
          let shadowMaterial: THREE.Material | undefined = custom;
          if (!shadowMaterial) {
            const materialKey = `${point}:${material.uuid}`;
            shadowMaterial = shadowMaterials.get(materialKey);
            if (!shadowMaterial) {
              const created = createShadowMaterial(material as SourceMaterial, point);
              shadowMaterials.set(materialKey, created);
              retained.add(created);
              shadowMaterial = created;
            }
          }
          shadowJobs.push({ object: mesh, material: shadowMaterial });
        }
      }
    });
    await compileJobs(renderer, scene, camera, target, normalJobs, false, signal);
    if (shadowJobs.length) {
      // Only the output color space matters for compilation, not map resolution.
      shadowTarget = new THREE.WebGLRenderTarget(1, 1);
      await compileJobs(renderer, scene, camera, shadowTarget, shadowJobs, true, signal);
    }
    return resource;
  } catch (error) {
    resource.dispose();
    throw error;
  } finally {
    shadowTarget?.dispose();
  }
}

const WARM_BATCH = 8;

/**
 * A first draw uploads geometry and textures and finishes driver-side program
 * setup. Spread that over frames by drawing a few objects at a time into one
 * scissored pixel, instead of letting the first visible frame do all of it.
 */
export async function warmDraws(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  target: THREE.WebGLRenderTarget | null,
  signal?: AbortSignal,
): Promise<void> {
  throwIfStartupAborted(signal);
  const objects: THREE.Object3D[] = [];
  scene.traverseVisible((object) => {
    const o = object as THREE.Object3D & Partial<Record<'isMesh' | 'isPoints' | 'isLine' | 'isSprite', boolean>>;
    if (o.isMesh || o.isPoints || o.isLine || o.isSprite) objects.push(object);
  });
  const culled = objects.map((object) => object.frustumCulled);
  for (const object of objects) {
    object.visible = false;
    // The real camera pose is not set yet; upload everything the scene can show.
    object.frustumCulled = false;
  }
  const previousTarget = renderer.getRenderTarget();
  const previousFace = renderer.getActiveCubeFace();
  const previousMip = renderer.getActiveMipmapLevel();
  const scissor = new THREE.Vector4();
  const scissorTest = target ? target.scissorTest : renderer.getScissorTest();
  if (target) scissor.copy(target.scissor);
  else renderer.getScissor(scissor);
  try {
    for (let i = 0; i < objects.length; i += WARM_BATCH) {
      await yieldStartup(signal);
      const batch = objects.slice(i, i + WARM_BATCH);
      batch.forEach((object) => (object.visible = true));
      try {
        if (target) {
          target.scissor.set(0, 0, 1, 1);
          target.scissorTest = true;
        } else {
          renderer.setScissor(0, 0, 1, 1);
          renderer.setScissorTest(true);
        }
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
      } finally {
        batch.forEach((object) => (object.visible = false));
        if (target) {
          target.scissor.copy(scissor);
          target.scissorTest = scissorTest;
        } else {
          renderer.setScissor(scissor);
          renderer.setScissorTest(scissorTest);
        }
        renderer.setRenderTarget(previousTarget, previousFace, previousMip);
      }
    }
  } finally {
    objects.forEach((object, i) => {
      object.visible = true;
      object.frustumCulled = culled[i];
    });
  }
}
