import { Box3, Group, Vector3, type Object3D } from 'three';
import { loadGlbScene } from './armor-models';
import { BB_UNITS_PER_METER, type CharacterTemplate } from './character-model';

/** The transport plane (Ilyushin Il-38): the battle royale drop plane and survival supply drops. */
export const TRANSPORT_PLANE_URL = '/models/dists/il-38.glb';

/** Callers draw the plane at this scale (that of the old Blockbench plane); the template undoes it. */
const DRAWN_SCALE = BB_UNITS_PER_METER / 1.5;
/** Nose to tail (m) and where the cabin's centre sits above the plane's position, as before. */
export const TRANSPORT_PLANE_LENGTH = 64.5;
const CABIN_HEIGHT = 12.67;

/**
 * Loads the plane as a template whose root, drawn at the callers' usual scale, is nose towards −Z
 * (the way planes fly in game), 64.5 metres long, its cabin `CABIN_HEIGHT` above the origin.
 */
export async function loadTransportPlane(): Promise<CharacterTemplate> {
  const scene = (await loadGlbScene(TRANSPORT_PLANE_URL)).clone(true);
  return buildTransportPlane(scene);
}

/** The Il-38's four thin rotor meshes are separate, but their authored origins are off-centre. */
export function buildTransportPlane(scene: Object3D): CharacterTemplate {
  scene.updateMatrixWorld(true);
  const boneNames: string[] = [];
  for (const meshName of ['Object_6', 'Object_8', 'Object_10', 'Object_12']) {
    const mesh = scene.getObjectByName(meshName);
    if (!mesh) throw new Error(`Il-38 propeller missing: ${meshName}`);
    const center = new Box3().setFromObject(mesh).getCenter(new Vector3());
    const pivot = new Group();
    pivot.name = `propeller_${boneNames.length}`;
    pivot.position.copy(scene.worldToLocal(center));
    scene.add(pivot);
    // Preserve the authored mesh transform while moving its spin axis to the hub (+Z).
    pivot.attach(mesh);
    boneNames.push(pivot.name);
  }
  const box = new Box3().setFromObject(scene), size = box.getSize(new Vector3()), centre = box.getCenter(new Vector3());
  const k = TRANSPORT_PLANE_LENGTH / size.z;
  const inner = new Group();
  // The model's nose points +Z: half a turn about Y.
  inner.rotation.y = Math.PI;
  inner.add(scene);
  scene.position.set(-centre.x, -(box.min.y + size.y * .3), -centre.z);
  const root = new Group();
  inner.scale.setScalar(k / DRAWN_SCALE);
  inner.position.y = CABIN_HEIGHT / DRAWN_SCALE;
  root.add(inner);
  return { root, boneNames, clips: new Map([['propellers_spin', {
    name: 'propellers_spin', length: .2, loop: true,
    bones: new Map(boneNames.map((name) => [name, {
      rotation: { times: [0, .2], values: [[0, 0, 0], [0, 0, 360]], step: [false, false] },
    }])),
  }]]) };
}
