/// <reference lib="webworker" />
import { glbTriangles, uploadedMapFit } from '@zion/assets';

/**
 * A map model's centring and collision, worked out off the page's thread (a large map takes a
 * while: the page stays responsive meanwhile). Only uncompressed GLBs; compressed ones (Draco,
 * meshopt) are decoded on the page by three.js instead.
 */
self.onmessage = (e: MessageEvent<ArrayBuffer>) => {
  try {
    const fit = uploadedMapFit(glbTriangles(new Uint8Array(e.data), true));
    (self as unknown as Worker).postMessage({ fit });
  } catch (err) {
    (self as unknown as Worker).postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
