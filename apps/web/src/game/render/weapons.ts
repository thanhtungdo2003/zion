import { Group, Matrix4, Vector3 } from 'three';
import { ResourceDisposer } from './resources';
import { ARMOR_SPECS, EntityFlags } from '@zion/shared';
import { ITEMS, type Stance } from '../inventory/items';
import { Avatar } from './avatars';
import { BB_UNITS_PER_METER, buildBBModel, fetchWithProgress, type CharacterTemplate, type RawModel } from './character-model';

type Vec3 = [number, number, number];

/**
 * How each weapon model is authored and how it should sit in the hand. Axes/points are in the
 * weapon's own Blockbench pixels: `barrel` = direction the muzzle points, `up` = top of the gun,
 * `grip` = where the right hand closes. `length` is the real-world length of the longest side.
 */
interface WeaponSpec {
  url: string;
  length: number;
  barrel: Vec3;
  up: Vec3;
  grip: Vec3;
  /** Left palm under the handguard, for the two-handed lobby pose. */
  support?: Vec3;
  /** Trigger hand for the authored patrol pose (the lobby rig carries the stock on its left locator). */
  patrolTriggerHand?: 'left' | 'right';
  /** Muzzle tip and ejection port (optional for non-guns). */
  muzzle?: Vec3;
  eject?: Vec3;
  /** Name of the model's reload clip, if any. */
  reloadClip?: string;
}

/**
 * Size multiplier for guns held in the hand (stylised: real-size guns look tiny on the chunky
 * character). Grenades and inventory icons are unaffected.
 */
const HELD_GUN_SCALE = 1.5;
/**
 * Extra placement of held guns relative to the grip, in metres: `back` pulls the gun towards the
 * shoulder (along the barrel), `up` raises it.
 */
const HELD_GUN_OFFSET = { back: 0.06, up: 0.025 };

const WEAPON_SPECS: Record<string, WeaponSpec> = {
  badge_recruit: { url: '/models/materias/tanbinh-badge.bbmodel', length: 0.15, barrel: [1, 0, 0], up: [0, 1, 0], grip: [0, 0, 0] },
  badge_private: { url: '/models/materias/binhnhi-badge.bbmodel', length: 0.15, barrel: [1, 0, 0], up: [0, 1, 0], grip: [0, 0, 0] },
  badge_corporal: { url: '/models/materias/corporal-badge.bbmodel', length: 0.15, barrel: [1, 0, 0], up: [0, 1, 0], grip: [0, 0, 0] },
  badge_sergeant: { url: '/models/materias/sergeant-badge.bbmodel', length: 0.15, barrel: [1, 0, 0], up: [0, 1, 0], grip: [0, 0, 0] },
  badge_elite: { url: '/models/materias/elite-badge.bbmodel', length: 0.15, barrel: [1, 0, 0], up: [0, 1, 0], grip: [0, 0, 0] },
  ak47: { url: '/models/weapons/ak47-rifle.bbmodel', length: 0.95, barrel: [0, 1, 0], up: [0, 0, -1], grip: [0, 0.5, 4.5], support: [0, 18, 3], patrolTriggerHand: 'left', muzzle: [0, 36, 1], eject: [1, 11, 0.5], reloadClip: 'reload' },
  shotgun: { url: '/models/weapons/pump-shotgun.bbmodel', length: 1.0, barrel: [0, 1, 0], up: [0, 0, -1], grip: [0, 16, 4.5], muzzle: [0, 52, -1], eject: [1, 24, 0] },
  gl18: { url: '/models/weapons/glock-18.bbmodel', length: 0.24, barrel: [0, 0, -1], up: [0, 1, 0], grip: [0, 4, 3.5], muzzle: [0, 10.5, -8], eject: [1, 11.5, 0.5], reloadClip: 'reload' },
  awm: { url: '/models/weapons/awm-sniper-4x.bbmodel', length: 1.15, barrel: [0, 1, 0], up: [0, 0, 1], grip: [0, 13.5, -4.5], muzzle: [0, 56, 0.5], eject: [2, 20, 1.5] },
  m4a1: { url: '/models/weapons/m4a1-rifle.bbmodel', length: 0.9, barrel: [0, 1, 0], up: [0, 0, 1], grip: [0, 0.5, -3.5], muzzle: [0, 34, 1], eject: [1, 4, 2] },
  aug: { url: '/models/weapons/steyr-aug.bbmodel', length: 0.8, barrel: [0, 1, 0], up: [0, 0, 1], grip: [0, 16.5, -3.5], muzzle: [0, 44, 3], eject: [2, 24, 3] },
  svd: { url: '/models/weapons/svd-dragunov.bbmodel', length: 1.2, barrel: [0, 1, 0], up: [1, 0, 0], grip: [-4.5, 11.5, 0], muzzle: [1, 56, 0], eject: [1, 23, 1] },
  saiga12: { url: '/models/weapons/saiga-12-shotgun.bbmodel', length: 1.0, barrel: [0, 1, 0], up: [0, 0, -1], grip: [0, 2.5, 5], muzzle: [0, 39, 0], eject: [2.5, 11, -0.5] },
  double_barrel: { url: '/models/weapons/double-barrel-shotgun.bbmodel', length: 1.0, barrel: [0, 1, 0], up: [0, 0, 1], grip: [0, 12, -1.5], muzzle: [0, 44, 1] },
  revolver: { url: '/models/weapons/revolver.bbmodel', length: 0.3, barrel: [0, 1, 0], up: [0, 0, -1], grip: [0, 2, 4.5], muzzle: [0, 26, -4] },
  mp5: { url: '/models/weapons/mp5-smg.bbmodel', length: 0.6, barrel: [0, 0, -1], up: [0, 1, 0], grip: [0, 3.5, 6.5], muzzle: [0, 10, -18], eject: [1, 10, -6] },
  grenade_launcher: { url: '/models/weapons/grenade-launcher.bbmodel', length: 0.75, barrel: [0, 1, 0], up: [0, 0, 1], grip: [0, -1.5, -5], muzzle: [0, 27, 0] },
  crossbow: { url: '/models/weapons/modern-crossbow.bbmodel', length: 0.85, barrel: [0, 1, 0], up: [0, 0, 1], grip: [0, 9.5, -4.5], muzzle: [0, 38, 0] },
  rocket_launcher: { url: '/models/weapons/rocket-launcher.bbmodel', length: 1.2, barrel: [0, 1, 0], up: [0, 0, 1], grip: [0, 11.5, -7], muzzle: [0, 34, 0] },
  flamethrower: { url: '/models/weapons/flamethrower.bbmodel', length: 0.95, barrel: [0, 1, 0], up: [0, 0, 1], grip: [0, 8.5, -4.5], muzzle: [0, 34, 0] },
  // Blades: fitted like a gun (point forward); `muzzle` marks the tip for slash effects.
  katana: { url: '/models/weapons/katana.bbmodel', length: 1.0, barrel: [0, 1, 0], up: [1, 0, 0], grip: [0, 5, 0] },
  quam: { url: '/models/weapons/cay-quam.bbmodel', length: 1.9, barrel: [0, 1, 0], up: [1, 0, 0], grip: [0, 18, 0] },
  // Ammo boxes are never held; they are loaded for their inventory icons (muzzle-less = no gun scaling).
  ammo_762: { url: '/models/ammos/ak-box-762x39.bbmodel', length: 0.2, barrel: [1, 0, 0], up: [0, 1, 0], grip: [0, 8, 0] },
  ammo_9mm: { url: '/models/ammos/ammo-box-9mm-30rd.bbmodel', length: 0.2, barrel: [1, 0, 0], up: [0, 1, 0], grip: [0, 8, 0] },
  ammo_12g: { url: '/models/ammos/shotgun-shell-box.bbmodel', length: 0.2, barrel: [1, 0, 0], up: [0, 1, 0], grip: [2, 4, 4] },
  ammo_300wm: { url: '/models/ammos/awm-300wm-box.bbmodel', length: 0.2, barrel: [1, 0, 0], up: [0, 1, 0], grip: [0, 7, 0] },
  ammo_556: { url: '/models/weapons/ammo-box-556-nato.bbmodel', length: 0.2, barrel: [1, 0, 0], up: [0, 1, 0], grip: [0.5, 6.5, 0] },
  ammo_762x54: { url: '/models/weapons/ammo-box-762x54r.bbmodel', length: 0.3, barrel: [1, 0, 0], up: [0, 1, 0], grip: [5, 6.5, 0] },
  ammo_357: { url: '/models/ammos/ammo-box-9mm-30rd.bbmodel', length: 0.2, barrel: [1, 0, 0], up: [0, 1, 0], grip: [0, 8, 0] },
  ammo_40mm: { url: '/models/weapons/grenade-40mm-retail-pack.bbmodel', length: 0.3, barrel: [1, 0, 0], up: [0, 1, 0], grip: [0, 6.5, 0.75] },
  rocket: { url: '/models/weapons/rocket-missile.bbmodel', length: 0.9, barrel: [0, 1, 0], up: [1, 0, 0], grip: [0, 16, 0] },
  bolts: { url: '/models/weapons/arrow-quiver.bbmodel', length: 0.6, barrel: [0, 1, 0], up: [1, 0, 0], grip: [0, 14, -0.5] },
  fuel_tank: { url: '/models/weapons/flamethrower-fuel-tank.bbmodel', length: 0.45, barrel: [0, 1, 0], up: [1, 0, 0], grip: [2.5, 11.5, 0] },
  // Rounds in flight (nose → +X in the display model) and the ZCoin.
  proj_grenade40: { url: '/models/weapons/grenade-launcher-round.bbmodel', length: 0.22, barrel: [0, 0, -1], up: [0, 1, 0], grip: [0, 4, 0] },
  proj_rocket: { url: '/models/weapons/rocket-missile.bbmodel', length: 0.9, barrel: [0, 1, 0], up: [1, 0, 0], grip: [0, 16, 0] },
  proj_bolt: { url: '/models/weapons/arrow.bbmodel', length: 0.6, barrel: [0, 1, 0], up: [1, 0, 0], grip: [0, 16, 0] },
  medkit: { url: '/models/tools/first-aid-kit.bbmodel', length: 0.35, barrel: [1, 0, 0], up: [0, 1, 0], grip: [0, 5.5, 0] },
  zcoin: { url: '/models/materias/gold-coin-z.bbmodel', length: 0.05, barrel: [1, 0, 0], up: [0, 1, 0], grip: [0, 7, 0] },
  grenade: { url: '/models/weapons/frag-grenade.bbmodel', length: 0.16, barrel: [0, 0, -1], up: [0, 1, 0], grip: [0, 5, 0] },
};

WEAPON_SPECS.flashlight = { url: '/models/tools/flashlight.bbmodel', length: 0.22, barrel: [0, 0, -1], up: [0, 1, 0], grip: [0, 2, 0] };

// Food and resources: inventory icons (and held/ground models).
for (const [item, file] of Object.entries({ potato: 'potato', potato_cooked: 'potato-cooked', raw_mutton: 'raw-mutton', raw_porkchop: 'raw-porkchop', cooked_mutton: 'cooked-mutton', cooked_porkchop: 'cooked-porkchop', nuclear_cell: 'nuclear-power-cell', coal_carton: 'coal-in-old-carton' })) {
  WEAPON_SPECS[item] = { url: `/models/materias/${file}.bbmodel`, length: 0.2, barrel: [1, 0, 0], up: [0, 1, 0], grip: [0, 0, 0] };
}

// Armour pieces: loaded for their inventory icons only (worn models come from armor-models.ts).
for (const a of ARMOR_SPECS) WEAPON_SPECS[a.item] = { url: a.model, length: 0.45, barrel: [1, 0, 0], up: [0, 1, 0], grip: [0, 0, 0] };

/** Where the fist closes, relative to the hand locator (which sits at the bottom of the arm). */
const HAND_GRIP = new Vector3(0, 2 / BB_UNITS_PER_METER, -0.2 / BB_UNITS_PER_METER);
/** In the pose they are fitted in, guns point straight ahead and slightly down at the ground. */
const AIM_DIR = new Vector3(0, -0.08, -1).normalize();

export interface WeaponVisual {
  itemId: string;
  object: Group;
  /** Transform relative to the right-hand bone. */
  attach: Matrix4;
  /** Contact points in the weapon's model space; used by the patrol idle pose. */
  twoHandGrip?: { grip: Vector3; support: Vector3; up: Vector3; triggerHand?: 'left' | 'right' };
  /** Real-size model, muzzle → +X and top → +Y, centred on the grip (icons, thrown grenades). */
  display: Group;
  /** The model's own clips (reload…), and the clip played on reload. */
  clips: CharacterTemplate['clips'];
  reloadClip: string | null;
  /** Muzzle / ejection port in the weapon object's local space (null if not a gun). */
  muzzle: Vector3 | null;
  eject: Vector3 | null;
}

export type WeaponLibrary = Map<string, WeaponVisual>;

function frame(forward: Vector3, up: Vector3): Matrix4 {
  const f = forward.clone().normalize();
  const side = new Vector3().crossVectors(f, up).normalize();
  const u = new Vector3().crossVectors(side, f).normalize();
  return new Matrix4().makeBasis(f, u, side);
}

/**
 * Fits a weapon to the character: poses a throwaway avatar in the weapon's idle stance, then
 * solves the hand-local transform that puts the grip in the fist with the muzzle pointing
 * forward and the top facing up. Walk/attack clips then carry the gun along with the hand.
 */
function fitToHand(character: CharacterTemplate, spec: WeaponSpec, stance: Stance, weaponRoot: Group): Matrix4 {
  const avatar = new Avatar(character, true);
  avatar.setStance(stance);
  for (let i = 0; i < 3; i++) avatar.update(0, 0, 0, 0, EntityFlags.Grounded, 0.25, 0);
  avatar.root.updateMatrixWorld(true);
  const hand = avatar.root.getObjectByName('hand_right');
  if (!hand) throw new Error('character has no hand_right bone');

  const scale = ((spec.muzzle ? HELD_GUN_SCALE : 1) * spec.length) / Math.max(1e-3, measureAlong(weaponRoot, new Vector3(...spec.barrel)));

  const handWorld = hand.matrixWorld.clone();
  const gripWorld = HAND_GRIP.clone().applyMatrix4(handWorld);
  // Fitting pose faces −Z, so +Z is backwards.
  if (spec.muzzle) gripWorld.add(new Vector3(0, HELD_GUN_OFFSET.up, HELD_GUN_OFFSET.back));
  const rot = frame(AIM_DIR, new Vector3(0, 1, 0)).multiply(frame(new Vector3(...spec.barrel), new Vector3(...spec.up)).transpose());
  const gripLocal = new Vector3(...spec.grip).multiplyScalar(1 / BB_UNITS_PER_METER);
  const world = new Matrix4()
    .makeTranslation(gripWorld.x, gripWorld.y, gripWorld.z)
    .multiply(rot)
    .multiply(new Matrix4().makeScale(scale, scale, scale))
    .multiply(new Matrix4().makeTranslation(-gripLocal.x, -gripLocal.y, -gripLocal.z));
  return handWorld.invert().multiply(world);
}

function displayModel(spec: WeaponSpec, root: Group): Group {
  const scale = spec.length / Math.max(1e-3, measureAlong(root, new Vector3(...spec.barrel)));
  const grip = new Vector3(...spec.grip).multiplyScalar(1 / BB_UNITS_PER_METER);
  const inner = root.clone(true);
  inner.matrixAutoUpdate = false;
  inner.matrix
    .copy(frame(new Vector3(1, 0, 0), new Vector3(0, 1, 0)).multiply(frame(new Vector3(...spec.barrel), new Vector3(...spec.up)).transpose()))
    .multiply(new Matrix4().makeScale(scale, scale, scale))
    .multiply(new Matrix4().makeTranslation(-grip.x, -grip.y, -grip.z));
  const outer = new Group();
  outer.add(inner);
  for (const key of ['muzzle', 'eject'] as const) {
    const point = spec[key];
    if (!point) continue;
    const marker = new Group();
    marker.name = `weapon-${key}`;
    marker.position.set(...point).multiplyScalar(1 / BB_UNITS_PER_METER).applyMatrix4(inner.matrix);
    outer.add(marker);
  }
  return outer;
}

/** Extent of all mesh vertices projected on an axis (metres at character scale). */
function measureAlong(root: Group, axis: Vector3): number {
  axis.normalize();
  let lo = Infinity;
  let hi = -Infinity;
  const p = new Vector3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const geo = (o as { geometry?: { getAttribute(n: string): { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number } } }).geometry;
    if (!geo) return;
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const d = p.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(o.matrixWorld).dot(axis);
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
  });
  return hi > lo ? hi - lo : 0;
}

/** Downloads and fits every weapon model; part of the pre-game loading step. */
export async function loadWeapons(character: CharacterTemplate, onProgress?: (p: number) => void): Promise<WeaponLibrary> {
  const ids = Object.keys(WEAPON_SPECS);
  const progress = new Array<number>(ids.length).fill(0);
  const report = () => onProgress?.(progress.reduce((a, b) => a + b, 0) / ids.length);
  const lib: WeaponLibrary = new Map();
  const ownedRoots: Group[] = [];
  const results = await Promise.allSettled(
    ids.map(async (itemId, i) => {
      const spec = WEAPON_SPECS[itemId]!;
      const raw = JSON.parse(
        await fetchWithProgress(spec.url, (p) => {
          progress[i] = p;
          report();
        }),
      ) as RawModel;
      const built = await buildBBModel(raw);
      ownedRoots.push(built.root);
      const stance = ITEMS[itemId]?.stance ?? 'rifle';
      const local = (p?: Vec3) => (p ? new Vector3(...p).multiplyScalar(1 / BB_UNITS_PER_METER) : null);
      lib.set(itemId, {
        itemId,
        object: built.root,
        attach: fitToHand(character, spec, stance, built.root),
        ...(spec.support ? { twoHandGrip: { grip: local(spec.grip)!, support: local(spec.support)!, up: new Vector3(...spec.up), triggerHand: spec.patrolTriggerHand ?? 'right' } } : {}),
        display: displayModel(spec, built.root),
        clips: built.clips,
        reloadClip: spec.reloadClip && built.clips.has(spec.reloadClip) ? spec.reloadClip : null,
        muzzle: local(spec.muzzle),
        eject: local(spec.eject),
      });
    }),
  );
  const failure = results.find((r) => r.status === 'rejected');
  if (failure?.status === 'rejected') {
    const resources = new ResourceDisposer();
    for (const root of ownedRoots) resources.object(root);
    throw failure.reason;
  }
  return lib;
}
