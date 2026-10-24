import { Box3, BufferGeometry, Group, Mesh, PropertyBinding, SkinnedMesh, Vector3, type AnimationClip, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { cachedFetch } from '@/lib/preload';
import type { CharacterTemplate } from './character-model';
import { ZombieVariant } from '@zion/shared';

export const ZOMBIE_MODEL_URLS = [
  ...Array.from({ length: 10 }, (_, i) => `/models/mobs/polyart-zombie-${String(i + 1).padStart(2, '0')}.glb`),
  '/models/mobs/zombie-hunter.glb', '/models/mobs/zombie-dog.glb',
];
export interface ZombieModel {
  kind: 'human' | 'hunter' | 'dog';
  aliases: Record<string, string>;
  animations: AnimationClip[];
  recorded: boolean;
}
/** Stable across streaming/rejoining; ordinary gameplay kinds share all ten appearances. */
export function zombieTemplateIndex(variant: ZombieVariant, id: number): number {
  if (variant === ZombieVariant.Brute) return 10;
  if (variant === ZombieVariant.Crimson) return 11;
  const n = id >>> 0;
  return ((Math.imul(n ^ (n >>> 16), 0x45d9f3b) >>> 0) % 10);
}
export async function loadZombieModel(url: string): Promise<CharacterTemplate> {
  const response = await cachedFetch(url);
  if (!response.ok) throw new Error(`Zombie model ${url}: HTTP ${response.status}`);
  return parseZombieModel(await response.arrayBuffer());
}
export async function parseZombieModel(data: ArrayBuffer): Promise<CharacterTemplate> {
  const gltf = await new GLTFLoader().parseAsync(data, '');
  const meta = gltf.parser.json.extras?.zion_zombie as ZombieModel & { height: number };
  if (!meta?.aliases) throw new Error('Zombie GLB requires rig metadata');
  const aliases = Object.fromEntries(Object.entries(meta.aliases).map(([key, value]) => [key, PropertyBinding.sanitizeNodeName(value)]));
  const root = new Group(), fit = new Group(); root.name = 'zombie-model'; root.add(fit); fit.add(gltf.scene);
  // Recover aliases on older exports whose numbered spine names differ by skin.
  const find = (pattern: RegExp) => {
    let name: string | undefined;
    gltf.scene.traverse(node => { if (!name && node.type === 'Bone' && pattern.test(node.name)) name = node.name; });
    return name;
  };
  const inferred: Record<string, RegExp> = {
    hips: /bip.*Pelvis/i, body: /bip.*Spine/i, head: /bip.*Head/i,
    arm_left: /bip L UpperArm/i, arm_right: /bip R UpperArm/i,
    forearm_left: /bip L Forearm/i, forearm_right: /bip R Forearm/i,
    hand_left: /bip L Hand/i, hand_right: /bip R Hand/i,
    leg_left: /bip L Thigh/i, leg_right: /bip R Thigh/i,
    shin_left: /bip L Calf/i, shin_right: /bip R Calf/i,
    foot_left: /bip L Foot/i, foot_right: /bip R Foot/i,
  };
  for (const [role, pattern] of Object.entries(inferred)) {
    if (!aliases[role] || !gltf.scene.getObjectByName(aliases[role]!)) {
      const name = find(pattern); if (name) aliases[role] = name;
    }
  }
  // Fit the bind skeleton. Source clips never affect the reference pose or runtime gait.
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(o => { if (o instanceof SkinnedMesh) o.skeleton.update(); });
  const bounds = new Box3().setFromObject(gltf.scene, true), size = bounds.getSize(new Vector3());
  if (!(size.y > .001)) throw new Error('Zombie GLB has empty bounds');
  const scale = meta.height / size.y;
  fit.scale.setScalar(scale);
  fit.position.set(-(bounds.min.x + bounds.max.x) / 2 * scale, -bounds.min.y * scale, -(bounds.min.z + bounds.max.z) / 2 * scale);
  root.rotation.y = Math.PI; // Source faces +Z; game characters face -Z.
  root.updateMatrixWorld(true);
  splitSkin(root, aliases);
  root.updateMatrixWorld(true);
  const boneNames: string[] = [];
  root.traverse(o => { if (o.type === 'Bone') boneNames.push(o.name); if (o instanceof Mesh) { o.castShadow = o.receiveShadow = true; o.frustumCulled = false; } });
  return { root, boneNames, clips: new Map(), zombie: { kind: meta.kind, aliases, animations: [], recorded: false } };
}
/** Shared geometry split once per template: a removed limb must also disappear on a skinned mesh. */
function splitSkin(root: Object3D, aliases: Record<string, string>): void {
  const regions = ['head', 'forearm_left', 'forearm_right', 'shin_left', 'shin_right'];
  const meshes: SkinnedMesh[] = []; root.traverse(o => { if (o instanceof SkinnedMesh) meshes.push(o); });
  for (const mesh of meshes) {
    const geometry = mesh.geometry, joints = geometry.getAttribute('skinIndex'), weights = geometry.getAttribute('skinWeight');
    const zone = mesh.skeleton.bones.map(b => {
      for (const name of regions) { let p: Object3D | null = b; while (p) { if (p.name === aliases[name]) return name; p = p.parent; } }
      return 'body';
    });
    const groups = new Map<string, number[]>();
    const count = geometry.index?.count ?? geometry.getAttribute('position').count;
    for (let t = 0; t < count; t += 3) {
      const scores = new Map<string, number>(), ids = [0, 1, 2].map(k => geometry.index ? geometry.index.getX(t + k) : t + k);
      for (const v of ids) for (let k = 0; k < 4; k++) {
        const name = zone[joints.getComponent(v, k)] ?? 'body'; scores.set(name, (scores.get(name) ?? 0) + weights.getComponent(v, k));
      }
      const name = [...scores].sort((a, b) => b[1] - a[1])[0]![0];
      const indices = groups.get(name) ?? []; indices.push(...ids); groups.set(name, indices);
    }
    for (const [zoneName, indices] of groups) {
      const part = new BufferGeometry();
      for (const [name, attribute] of Object.entries(geometry.attributes)) part.setAttribute(name, attribute);
      part.setIndex(indices);
      const piece = new SkinnedMesh(part, mesh.material);
      piece.name = `${mesh.name}-${zoneName}`; piece.userData.zombieZone = zoneName;
      piece.position.copy(mesh.position); piece.quaternion.copy(mesh.quaternion); piece.scale.copy(mesh.scale);
      piece.bind(mesh.skeleton, mesh.bindMatrix); mesh.parent!.add(piece);
    }
    mesh.removeFromParent(); geometry.dispose();
  }
}
