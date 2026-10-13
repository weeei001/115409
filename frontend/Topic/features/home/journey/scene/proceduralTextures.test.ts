import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { plasterDetail, stoneDetail, woodDetail } from './surface';
import { waterNormals } from './waterNormals';

type RecordedCanvas = {
  width: number;
  height: number;
  pixels: Uint8ClampedArray | null;
  calls: unknown[];
  getContext: () => unknown;
};

let allocatedCanvases = 0;
let uploadedImages = 0;
function recordedCanvas(): RecordedCanvas {
  allocatedCanvases++;
  const canvas: RecordedCanvas = { width: 0, height: 0, pixels: null, calls: [], getContext: () => context };
  const context = {
    createImageData(width: number, height: number) { return { data: new Uint8ClampedArray(width * height * 4) }; },
    putImageData(image: { data: Uint8ClampedArray }) { canvas.pixels = image.data; uploadedImages++; },
    createRadialGradient(...args: number[]) {
      canvas.calls.push(['gradient', ...args]);
      return { addColorStop(...stop: [number, string]) { canvas.calls.push(['stop', ...stop]); } };
    },
    fillRect(...args: number[]) { canvas.calls.push(['fill', ...args]); },
  };
  return canvas;
}

const hash = (data: Uint8ClampedArray | string) => createHash('sha256').update(data).digest('hex');
// Captured from the synchronous implementation at both production texture sizes.
const originalPixels = {
  256: {
    plasterDetail: '46a9e49b1656c58977025c5305ea31fd71fab82907de466fac6ac033f609b09f',
    woodDetail: '4eee42996e28ec9ba815ed30cbe6efd483217dacb3f7a9b0c75d38a5c6440be8',
    stoneDetail: '7a647b37285051470fb46fb9db4825de9cc579b7c878d206d5d064d442a55f00',
    waterNormals: 'caef3c8f58c29b71fb4b18fb05ac8517bb48d8c0dd1efe0edd1a744da9577339',
  },
  512: {
    plasterDetail: '3d11bf600b0f5c0db4eb46ba7232a9cd908098505d114842b0856c50e19ba5ae',
    woodDetail: '947174440a395414e176ebbf52284dcfdc28e0213cd350b2f963208643176b19',
    stoneDetail: '7155ac96011fe1c67c5b91b82d2b55edcecaa5e2f30a2228ba7767168cf92208',
    waterNormals: 'a8741e5746fe9551b44b0ed58a166d4cf6f4d4e796139156911ab69c54af5ac7',
  },
};
const originalPlasterPits = {
  256: 'dc5296016108661d9ab555ca134fa67f928088d30141b71ebf8e215df6839dc9',
  512: '5b9ef649eedbbf0ffd074602232c018ec24a61724a8360e2534010356eeffb85',
};
const generators = { plasterDetail, woodDetail, stoneDetail, waterNormals };

async function main() {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: recordedCanvas } });
  try {
    for (const size of [256, 512] as const) {
      for (const name of Object.keys(generators) as (keyof typeof generators)[]) {
        let inputRan = false;
        setTimeout(() => { inputRan = true; }, 0);
        const texture = await generators[name](size, 8);
        const canvas = texture.image as unknown as RecordedCanvas;
        assert.ok(inputRan, `${name} must allow input tasks before completion`);
        assert.ok(canvas.pixels);
        assert.equal(hash(canvas.pixels), originalPixels[size][name], `${name} ${size}px must preserve the original pixels`);
        if (name === 'plasterDetail') assert.equal(hash(JSON.stringify(canvas.calls)), originalPlasterPits[size], 'Plaster pit gradients must be unchanged');
        assert.equal(texture.wrapS, THREE.RepeatWrapping);
        assert.equal(texture.wrapT, THREE.RepeatWrapping);
        assert.equal(texture.anisotropy, name === 'waterNormals' ? 2 : 8);
        assert.equal(texture.colorSpace, THREE.NoColorSpace);
        assert.equal(texture.minFilter, THREE.LinearMipmapLinearFilter);
        assert.equal(texture.generateMipmaps, true);
        texture.dispose();
      }
    }

    for (const generate of Object.values(generators)) {
      const beforeStart = new AbortController();
      beforeStart.abort();
      const allocationsBefore = allocatedCanvases;
      await assert.rejects(generate(256, 8, beforeStart.signal), { name: 'AbortError' });
      assert.equal(allocatedCanvases, allocationsBefore, 'Already aborted startup must allocate no canvas');

      const duringWork = new AbortController();
      const uploadsBefore = uploadedImages;
      setTimeout(() => duringWork.abort(), 0);
      await assert.rejects(generate(512, 8, duringWork.signal), { name: 'AbortError' });
      assert.equal(uploadedImages, uploadsBefore, 'Aborted procedural work must not publish a texture');
    }
    console.log('Procedural texture pixels, filtering, task yielding, and cancellation tests passed');
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
