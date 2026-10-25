import { Box3, Group, Vector3 } from 'three';
import { loadGlbScene } from './armor-models';
import { BB_UNITS_PER_METER, type CharacterTemplate } from './character-model';

/** The transport plane (Ilyushin Il-38): the battle royale drop plane and survival supply drops. */
export const TRANSPORT_PLANE_URL = '/models/dists/il-38.glb';

/** Callers draw the plane at this scale (that of the old Blockbench plane); the template undoes it. */
const DRAWN_SCALE = BB_UNITS_PER_METER / 1.5;
/** Nose to tail (m) and where the cabin's centre sits above the plane's position, as before. */
const LENGTH = 43;
const CABIN_HEIGHT = 12.67;

/**
 * Loads the plane as a template whose root, drawn at the callers' usual scale, is nose towards −Z
 * (the way planes fly in game), `LENGTH` metres long, its cabin `CABIN_HEIGHT` above the origin.
 */
export async function loadTransportPlane(): Promise<CharacterTemplate> {
  const scene = (await loadGlbScene(TRANSPORT_PLANE_URL)).clone(true);
  const box = new Box3().setFromObject(scene), size = box.getSize(new Vector3()), centre = box.getCenter(new Vector3());
  const k = LENGTH / size.z;
  const inner = new Group();
  // The model's nose points +Z: half a turn about Y.
  inner.rotation.y = Math.PI;
  inner.add(scene);
  scene.position.set(-centre.x, -(box.min.y + size.y * .3), -centre.z);
  const root = new Group();
  inner.scale.setScalar(k / DRAWN_SCALE);
  inner.position.y = CABIN_HEIGHT / DRAWN_SCALE;
  root.add(inner);
  return { root, boneNames: [], clips: new Map() };
}
