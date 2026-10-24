import { Box3, BufferAttribute, Group, Matrix4, Mesh, SkinnedMesh, Vector3, type BufferGeometry, type Material, type Object3D, type Skeleton } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ARMOR_BY_ID, type ArmorSpec } from '@zion/shared';
import { cachedFetch } from '@/lib/preload';
import type { ArmorAnchors, HumanAssets } from './human-rig';

/**
 * Worn armour pieces (GLB models in real metres). A pack file holds several pieces modelled
 * around one head (or one torso), so they are fitted to the wearer together: the pack's
 * reference piece (the plain helmet / soft vest) is matched to the wearer's skull or torso and
 * every other piece of the pack keeps its place relative to it (a mask sits under the helmet as
 * modelled). A standalone helmet is fitted on its own the same way.
 */
export interface ArmorPiece {
  spec: ArmorSpec;
  /** The piece in its file's frame, turned to face +Z (meshes share the loaded geometry). */
  object: Group;
  /** The box the fit matches to the wearer: the pack's reference piece, or the piece itself. */
  ref: Box3;
}

/** Each pack's reference piece (the one the others were modelled around). */
const PACK_REFERENCE: Record<string, string> = {
  '/models/gear/armor/head-pack.glb': 'Helmet_1_T1',
  '/models/gear/armor/vest-pack.glb': 'Vest_1_T1',
};

const files = new Map<string, Promise<Object3D>>();
/** A GLB scene, parsed once per file (packs serve many pieces and their icons). */
export function loadGlbScene(url: string): Promise<Object3D> {
  let p = files.get(url);
  if (!p) {
    p = cachedFetch(url)
      .then((r) => { if (!r.ok) throw new Error(`armour model ${url} unavailable (${r.status})`); return r.arrayBuffer(); })
      .then((buf) => new GLTFLoader().parseAsync(buf, ''))
      .then((gltf) => { gltf.scene.updateMatrixWorld(true); return gltf.scene; });
    p.catch(() => files.delete(url));
    files.set(url, p);
  }
  return p;
}

/**
 * The meshes under a node (or the whole file), baked into one group. A pack lays its pieces out
 * side by side, each around its own node's origin (the same point of the head or torso for all),
 * so a node's piece is moved back to that origin.
 */
export function bake(scene: Object3D, node: string | undefined, yaw: number): Group {
  const src = node ? scene.getObjectByName(node) : scene;
  if (!src) throw new Error(`armour node ${node} missing`);
  const out = new Group(), turn = new Matrix4().makeRotationY(yaw);
  if (node) turn.multiply(new Matrix4().setPosition(src.getWorldPosition(new Vector3()).negate()));
  src.traverse((o) => {
    if (!(o as Mesh).isMesh) return;
    const m = o as Mesh, mesh = new Mesh(m.geometry as BufferGeometry, m.material as Material | Material[]);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.multiplyMatrices(turn, m.matrixWorld);
    mesh.castShadow = true;
    out.add(mesh);
  });
  out.updateMatrixWorld(true);
  return out;
}

const pieces = new Map<number, Promise<ArmorPiece | null>>();

/** Loads (once) an armour piece by wire id; null if it has no model or fails to load. */
export function loadArmorPiece(id: number): Promise<ArmorPiece | null> {
  let p = pieces.get(id);
  if (p) return p;
  const spec = ARMOR_BY_ID.get(id);
  p = spec
    ? loadGlbScene(spec.model.url).then((scene) => {
        const yaw = spec.model.yaw ?? 0, object = bake(scene, spec.model.node, yaw);
        const refName = spec.model.node ? PACK_REFERENCE[spec.model.url] : undefined;
        const ref = new Box3().setFromObject(refName ? bake(scene, refName, yaw) : object, true);
        return { spec, object, ref };
      }).catch((err: unknown) => {
        console.warn('armour model failed to load', err);
        return null;
      })
    : Promise.resolve(null);
  pieces.set(id, p);
  return p;
}

/** Already-loaded piece (or undefined while loading). */
const loaded = new Map<number, ArmorPiece | null>();
export function requestArmor(id: number, onReady: () => void): ArmorPiece | null | undefined {
  if (loaded.has(id)) return loaded.get(id);
  void loadArmorPiece(id).then((t) => {
    loaded.set(id, t);
    onReady();
  });
  return undefined;
}

/** Helmets and hoods (shemagh, balaclava, ghost and gas masks) hide the hair; a face plate or headset does not. */
const HOODS = new Set(['mask_shemagh', 'mask_balaclava', 'mask_ghost', 'mask_gas']);
export function coversHair(piece: ArmorPiece): boolean {
  return piece.spec.slot === 'head' || HOODS.has(piece.spec.item);
}

/** The bone a piece rides on (survivor skeleton): the head, or the upper chest. */
export function armorBone(piece: ArmorPiece): string {
  return piece.spec.slot === 'chest' ? 'spine_003' : 'spine_006';
}

/**
 * Where a piece sits on the wearer: a matrix from the piece's frame into the survivor's model
 * space (facing +Z). Helmets: the reference shell a little wider than the skull, its crown just
 * above the head's; vests: the reference vest a little wider than the torso, its collar at the
 * base of the neck, centred front to back on the chest.
 */
export function fitArmor(piece: ArmorPiece, body: ArmorAnchors): Matrix4 {
  const ref = piece.ref, size = ref.getSize(new Vector3()), centre = ref.getCenter(new Vector3());
  const model = piece.spec.model, t = new Vector3();
  let s: number;
  if (piece.spec.slot === 'chest') {
    const width = body.chest.max.x - body.chest.min.x;
    s = (width * 1.3) / size.x * (model.scale ?? 1);
    t.set(body.chest.centre.x - centre.x * s, body.neck + .01 - ref.max.y * s, body.chest.centre.z + .018 - centre.z * s);
  } else {
    const width = body.head.max.x - body.head.min.x;
    s = (width * 1.28) / size.x * (model.scale ?? 1);
    t.set(body.head.centre.x - centre.x * s, body.head.max.y + .012 - ref.max.y * s, body.head.centre.z - .006 - centre.z * s);
  }
  if (model.offset) t.add(new Vector3(...model.offset));
  return new Matrix4().makeTranslation(t.x, t.y, t.z).multiply(new Matrix4().makeScale(s, s, s));
}

/** Nearest body vertex (bind pose), on a uniform grid built once per body. */
const grids = new WeakMap<HumanAssets, (x: number, y: number, z: number) => number>();
function nearestBodyVertex(assets: HumanAssets): (x: number, y: number, z: number) => number {
  let f = grids.get(assets);
  if (f) return f;
  const pos = assets.parts.get('body')!.geometry.getAttribute('position'), cell = .04, map = new Map<string, number[]>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  for (let i = 0; i < pos.count; i++) { const k = key(Math.floor(pos.getX(i) / cell), Math.floor(pos.getY(i) / cell), Math.floor(pos.getZ(i) / cell)); const l = map.get(k); if (l) l.push(i); else map.set(k, [i]); }
  f = (x, y, z) => {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    let best = 0, bd = Infinity;
    for (let r = 0; r < 12 && (bd === Infinity || (r - 1) * cell < Math.sqrt(bd)); r++) {
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
        for (const i of map.get(key(cx + dx, cy + dy, cz + dz)) ?? []) { const d = (pos.getX(i) - x) ** 2 + (pos.getY(i) - y) ** 2 + (pos.getZ(i) - z) ** 2; if (d < bd) { bd = d; best = i; } }
      }
    }
    return best;
  };
  grids.set(assets, f);
  return f;
}

/**
 * A vest worn as skinned meshes on the wearer's skeleton: every vertex takes the skin weights of
 * the body point under it, so shoulder pads and sleeves follow the arms and the torso bends it.
 * `fit` places the piece in the survivor's model space (bind pose).
 */
export function skinArmor(piece: ArmorPiece, fit: Matrix4, assets: HumanAssets, skeleton: Skeleton): Group {
  const out = new Group(), near = nearestBodyVertex(assets), body = assets.parts.get('body')!.geometry;
  const si = body.getAttribute('skinIndex'), sw = body.getAttribute('skinWeight');
  for (const child of piece.object.children) {
    const src = child as Mesh, g = (src.geometry as BufferGeometry).clone().applyMatrix4(new Matrix4().multiplyMatrices(fit, src.matrix));
    const pos = g.getAttribute('position'), idx = new Uint16Array(pos.count * 4), w = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      const j = near(pos.getX(i), pos.getY(i), pos.getZ(i));
      for (let k = 0; k < 4; k++) { idx[i * 4 + k] = si.getComponent(j, k); w[i * 4 + k] = sw.getComponent(j, k); }
    }
    g.setAttribute('skinIndex', new BufferAttribute(idx, 4));
    g.setAttribute('skinWeight', new BufferAttribute(w, 4));
    const mesh = new SkinnedMesh(g, src.material);
    mesh.bind(skeleton, new Matrix4());
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    out.add(mesh);
  }
  return out;
}
