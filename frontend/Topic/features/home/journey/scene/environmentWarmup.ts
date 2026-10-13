import type * as THREE from 'three';
import { initializeShaderPrograms } from './shaderPrograms';
import { throwIfStartupAborted, waitForStartup } from './startup';

/**
 * Precompile the exact capture, blur, and GGX variants used by fromScene().
 * PMREM has no asynchronous scene API, so its synchronous pass submits shader
 * compilation instead of draws. The shared renderer is restored before any
 * await; the same generator must then produce the actual environment map.
 */
export async function warmEnvironmentShaders(
  renderer: THREE.WebGLRenderer,
  pmrem: THREE.PMREMGenerator,
  scene: THREE.Scene,
  sigma = 0,
  signal?: AbortSignal,
): Promise<void> {
  throwIfStartupAborted(signal);
  const previousRender = renderer.render;
  const previousTarget = renderer.getRenderTarget();
  const previousFace = renderer.getActiveCubeFace();
  const previousMip = renderer.getActiveMipmapLevel();
  const previousToneMapping = renderer.toneMapping;
  const previousAutoClear = renderer.autoClear;
  const previousXr = renderer.xr.enabled;
  const previousBackground = scene.background;
  const existingPrograms = new Set(renderer.info.programs);
  const compilations: Promise<THREE.Object3D>[] = [];
  let temporaryTarget: THREE.WebGLRenderTarget | null = null;

  try {
    try {
      renderer.render = (object, camera) => {
        // The first scene-capture pass targets PMREM's disposable output map.
        // Its internal ping-pong target remains owned by the generator.
        temporaryTarget ??= renderer.getRenderTarget();
        compilations.push(renderer.compileAsync(object, camera));
      };
      temporaryTarget = pmrem.fromScene(scene, sigma);
    } finally {
      renderer.render = previousRender;
      renderer.toneMapping = previousToneMapping;
      renderer.autoClear = previousAutoClear;
      renderer.xr.enabled = previousXr;
      scene.background = previousBackground;
      renderer.setRenderTarget(previousTarget, previousFace, previousMip);
    }
    await waitForStartup(Promise.all(compilations), signal);
    await initializeShaderPrograms(renderer, existingPrograms, signal);
  } finally {
    // Observe rejections even when capture throws before reaching the await.
    void Promise.allSettled(compilations);
    temporaryTarget?.dispose();
  }
}
