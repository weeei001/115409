import type * as THREE from 'three';
import { throwIfStartupAborted, waitStartupFrame, yieldStartup } from './startup';

type RendererProgram = NonNullable<THREE.WebGLRenderer['info']['programs']>[number];

/** Finish first-use reflection one linked program per task, before its first draw. */
export async function initializeShaderPrograms(
  renderer: THREE.WebGLRenderer,
  existingPrograms: ReadonlySet<RendererProgram>,
  signal?: AbortSignal,
): Promise<void> {
  throwIfStartupAborted(signal);
  const programs = (renderer.info.programs ?? []).filter((program) => !existingPrograms.has(program));
  const context = renderer.getContext();
  const parallel = context.getExtension('KHR_parallel_shader_compile');
  for (const program of programs) {
    // compileAsync leaves uniform/attribute reflection until first use. Driver
    // getProgramInfoLog work can otherwise accumulate into one blocked frame.
    await yieldStartup(signal);
    // A material can create several variants, while compileAsync only waits for
    // its final currentProgram. Check every linked program before reflection.
    // Poll once per frame: the driver compiles off-thread, so spinning only takes frames from the poster.
    while (parallel && !context.getProgramParameter(program.program as WebGLProgram, parallel.COMPLETION_STATUS_KHR)) {
      await waitStartupFrame(signal);
    }
    throwIfStartupAborted(signal);
    program.getUniforms();
    program.getAttributes();
  }
}
