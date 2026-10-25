import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

let draco: DRACOLoader | null = null;

/**
 * A GLTF loader that also reads compressed models (Draco, meshopt), as many exported map and
 * Sketchfab models are; the Draco decoder is served from /draco/.
 */
export function gltfLoader(): GLTFLoader {
  const loader = new GLTFLoader();
  if (typeof window !== 'undefined') {
    draco ??= new DRACOLoader().setDecoderPath('/draco/');
    loader.setDRACOLoader(draco);
  }
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}
