import { Box3, Group, Matrix4, Mesh, type SkinnedMesh, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { bake, loadGlbScene } from './armor-models';
import { ATTACHMENT_SLOTS, attachmentDef, type Attachments } from '@zion/shared';
import { cachedFetch } from '@/lib/preload';
import { loadCustomWeapons } from '../custom-weapons';
import { loadGearFit } from '../gear-fit';
import { loadHandStudio } from '../hand-studio';
import { ResourceDisposer } from './resources';
import { ARMOR_SPECS, EntityFlags } from '@zion/shared';
import { ITEMS, type Stance } from '../inventory/items';
import { Avatar } from './avatars';
import type { StrikeAxes } from './melee-edge';
import type { HandPreset, HandShapeCurl } from './human-rig';
import { BB_UNITS_PER_METER, buildBBModel, fetchWithProgress, type CharacterTemplate, type RawModel } from './character-model';

type Vec3 = [number, number, number];

/** First-person hand studio of one gun: hand shapes, and per reload action the hand's shift and shape. */
export interface FpHandsSpec {
  shapes?: Record<string, HandShapeCurl>;
  actions?: Record<string, { offset?: Vec3; shape?: HandPreset }>;
}

/**
 * How each weapon model is authored and how it should sit in the hand. Axes/points are in the
 * weapon's own Blockbench pixels: `barrel` = direction the muzzle points, `up` = top of the gun,
 * `grip` = where the right hand closes. `length` is the real-world length of the longest side.
 */
export interface WeaponSpec {
  url: string;
  length: number;
  barrel: Vec3;
  up: Vec3;
  grip: Vec3;
  /** Direction from the handle towards the sharp edge or striking face. */
  edge?: Vec3;
  /** Centre of the blade/head in authored pixels, used to measure the swing. */
  strikePoint?: Vec3;
  emitter?: Vec3;
  /** Left palm under the handguard, for the two-handed lobby pose. */
  support?: Vec3;
  /** Optional model-authored handle axes and radii in metres (before character scaling). */
  gripAxis?: Vec3;
  supportAxis?: Vec3;
  gripRadius?: number;
  supportRadius?: number;
  /** Trigger hand for the authored patrol pose (the lobby rig carries the stock on its left locator). */
  patrolTriggerHand?: 'left' | 'right';
  /** Muzzle tip and ejection port (optional for non-guns). */
  muzzle?: Vec3;
  eject?: Vec3;
  /** Name of the model's reload clip, if any. */
  reloadClip?: string;
  /** Clip played after every shot (a pump action racked), and the part the support hand rides on. */
  fireClip?: string;
  supportPart?: string;
  /** Iron sights: tops of the rear and front sight (the sight line the eye looks along). */
  sight?: { rear: Vec3; front: Vec3 };
  /**
   * Attachment points: an optic's base centre sits exactly here (on the rail's top face), a muzzle
   * device's rear face centre exactly on `muzzle` (the bore's front face).
   */
  rail?: Vec3;
  /** Attachments: point on the optical axis at the eyepiece, and the far end of a muzzle device. */
  eye?: Vec3;
  tip?: Vec3;
  /** Real length of an attachment along `barrel` (metres). */
  /** Model file format when the URL does not say (Studio uploads). */
  format?: 'glb' | 'bbmodel';
  /** A shipped model's points edited in the Studio: they win over the fitting embedded in the file. */
  studio?: boolean;
  /**
   * Studio size multiplier for the gun in the character's hand (third person) only, on top of the
   * length and any fitting in the file. First person has its own (`fpScale`).
   */
  size?: number;
  /** A GLB pack holding several items: the node of this one (and its turn to face +Z). */
  node?: string;
  nodeYaw?: number;
  /** First-person view: hip offset (x right, y up, z forward, metres) and eye relief when aiming. */
  fpHip?: Vec3;
  fpEyeRelief?: number;
  /** First-person view: shift of the support (left) hand from its grip point (display metres). */
  fpSupport?: Vec3;
  /** First-person view: shift of the firing (right) hand on its grip (display metres). */
  fpGrip?: Vec3;
  /** First-person hand studio: hand shapes and per-action hand shifts / shapes (see custom-weapons). */
  fpHands?: FpHandsSpec;
  /** First-person view: hip tilt, pitch and yaw (radians). */
  fpRot?: [number, number];
  /** First-person view only: size of the gun in view (1 = real size), about its grip. */
  fpScale?: number;
  /** Size of mounted optics / muzzle devices on this gun (1 = default). */
  opticScale?: number;
  muzzleScale?: number;
  /** Size of one particular attachment on this gun (wins over the slot size). */
  attachmentScale?: Record<string, number>;
  /** Shift of the attachment point for one particular attachment on this gun (model units). */
  attachmentOffset?: Record<string, Vec3>;
  /** Attachments: length once mounted on a gun (metres). Their `grip` is the pivot: the centre of
   * the face that touches the gun (an optic's base underside, a muzzle device's rear face). */
  mountLength?: number;
  /** Optic that always comes with this weapon (shown and aimed through when no other is fitted). */
  builtinOptic?: string;
  /**
   * A round shown loaded in the muzzle (muzzle-loaded launchers): the item whose model it is, its
   * length and how much of it sits inside the tube, in metres of the displayed gun.
   */
  round?: { item: string; length: number; inside: number };
}

/**
 * Adds a weapon made in the Studio to the visual table (before `loadWeapons`), so it is loaded,
 * held, aimed and iconised like a built-in one. `url` is the absolute model URL.
 */
export function registerWeaponVisual(itemId: string, url: string | null, format: 'glb' | 'bbmodel', model: Omit<WeaponSpec, 'url' | 'format'>, madeFor?: string): void {
  const base = BUILTIN_VISUALS.get(itemId);
  // A built-in's Studio points / uploaded model only hold for the shipped model they were made
  // for: once the game ships a new model for it, that model is used as shipped. Edits saved
  // before the Studio recorded that model (no `madeFor`) were made for the current one.
  if (base && madeFor !== undefined && madeFor !== base.url) { WEAPON_SPECS[itemId] = base; return; }
  // Built-ins edited in the Studio keep their bundled model (and its clips / extra points).
  // Points edited on the shipped model win over that file's own fitting; an uploaded model keeps
  // the fitting it was made with (the Studio's points for it start from that fitting).
  // Points saved from the Studio editor (`own`) win over an uploaded file's fitting as well, so the
  // game shows what the Studio showed.
  const own = (model as { own?: boolean }).own === true;
  WEAPON_SPECS[itemId] = base && !url ? { ...base, ...model, studio: true } : { ...model, url: url ?? base?.url ?? '', format, ...(own ? { studio: true } : {}) };
}

/** A built-in weapon's authoring data as shipped (Studio: defaults to edit from / reset to). */
export function builtinWeaponVisual(itemId: string): WeaponSpec | undefined {
  return BUILTIN_VISUALS.get(itemId);
}

/**
 * Size multiplier for guns held in the hand (stylised: real-size guns look tiny on the chunky
 * character). Grenades and inventory icons are unaffected.
 */
const HELD_GUN_SCALE = 1.5;
/** The survivor is a realistically proportioned person: guns at (almost) real size. */
const SURVIVOR_GUN_SCALE = 1.05;
/**
 * Extra placement of held guns relative to the grip, in metres: `back` pulls the gun towards the
 * shoulder (along the barrel), `up` raises it.
 */
const HELD_GUN_OFFSET = { back: 0.06, up: 0.025 };

const WEAPON_SPECS: Record<string, WeaponSpec> = {
  // Rifles and pistols with the sight line (iron sights) and optic rail they are aimed and dressed with.
  ak47: { url: '/models/weapons/ak47-rifle.bbmodel', length: 0.95, barrel: [0, 1, 0], up: [0, 0, 1], grip: [0, 16.5, -5], support: [0, 36, -1], muzzle: [0, 56, 0], eject: [2, 24, 1.5], reloadClip: 'reload', sight: { rear: [0, 32.5, 4.3], front: [0, 50.75, 4.5] }, rail: [0, 22, 3.5] },
  deagle: { url: '/models/weapons/desert-eagle.bbmodel', length: 0.27, barrel: [0, 0, -1], up: [0, 1, 0], grip: [0, 5, 4.5], muzzle: [0, 15, -13.5], eject: [1.5, 16, 0], reloadClip: 'reload', sight: { rear: [0, 18, 6.5], front: [0, 19, -11.5] }, rail: [0, 17, 4.207], attachmentScale: { red_dot: 0.65 } },
  kar98k: { url: '/models/weapons/mauser-kar98k.bbmodel', length: 1.116, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, -10.5, -2], support: [0, -7.176, 35], muzzle: [0, 0, 82.5], eject: [-1.725, -0.6, 11], sight: { rear: [0, 3.5, 28.25], front: [0, 3, 80.25] }, rail: [0, -0.5, 11] },
  mini14: { url: '/models/weapons/ruger-mini-14-gb.bbmodel', length: 0.987, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, -6, -2], support: [0, -5, 27.25], muzzle: [0, 0, 65.5], eject: [-1.5, -0.3, 8.5], sight: { rear: [0, 5, 3.75], front: [0, 3.5, 48] }, rail: [0, 2.5, 8.5] },
  scar_h: { url: '/models/weapons/scar-h-mk17.bbmodel', length: 0.963, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, -13, 5], support: [0, -14.94, 43], muzzle: [0, 0, 69.5], eject: [-3.144, 0.25, 25], sight: { rear: [0, 9, 3], front: [0, 9.75, 47] }, rail: [0, 5, 25.286] },
  // Imported GLBs: points are in the file's own units.
  uzi: { url: '/models/weapons/uzi-imi.glb', length: 0.47, barrel: [0, 0, -1], up: [0, 1, 0], grip: [0, -0.75, -0.399], support: [0, -0.25, -1.3], muzzle: [0, -0.26, -2.494], eject: [0.14, 0.02, -0.9], sight: { rear: [0, 0.13, 0.42], front: [0, 0.112, -1.64] }, rail: [0, 0.019, 0.04] },
  vector: { url: '/models/weapons/kriss-vector-gen1.bbmodel', length: 0.95, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, -6.5, 2.9], support: [0, -3.482, 34.75], muzzle: [0, 0, 75.5], eject: [-2.86, 0.85, 14.5], sight: { rear: [0, 9, 8.25], front: [0, 9, 36.25] }, rail: [0, 6.5, 21.279] },
  p90: { url: '/models/weapons/p90.glb', length: 0.5, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, 0.18, 0.46], support: [0, 0.18, 0.6], muzzle: [0, 0.415, 0.91], eject: [0, 0.12, 0.2], sight: { rear: [0, 0.715, 0.31], front: [0, 0.715, 0.68] }, rail: [0.007, 0.6341, 0.436], fpHip: [0.2, -0.2604, -0.3187], fpRot: [0, 0], attachmentOffset: { scope_2x: [0, 0.0799, 0] } },
  // Muzzle toward −Z (the thin flash hider end); the folding stock is the +Z end.
  scar_l: { url: '/models/weapons/fn-scar-l.glb', length: 0.9, barrel: [0, 0, -1], up: [0, 1, 0], grip: [0.205, 0.18, 0.27], support: [0.205, 0.29, -0.03], muzzle: [0.2, 0.35, -0.322], eject: [0.25, 0.38, 0.2], sight: { rear: [0.205, 0.475, 0.47], front: [0.205, 0.475, -0.11] }, rail: [0.203, 0.431, 0.3725], attachmentOffset: { scope_2x: [0, 0, -0.081], scope_4x: [0, 0, -0.128], nv_scope_6x: [0, 0, -0.115] } },
  // Sketchfab GLBs prepared by scripts/prepare-glb-guns.mjs (moving `magazine` and `bolt` groups):
  // points in the file's units. M16 and Beryl: muzzle +X.
  m16: { url: '/models/weapons/m16.glb', length: 1.0, barrel: [1, 0, 0], up: [0, 1, 0], grip: [-25, 1, 0], support: [35, 15, 0], muzzle: [111.4, 22.5, 0], eject: [-4, 22, 5], sight: { rear: [-21, 43, 0], front: [76, 43, 0] }, rail: [-8, 46.5, 0] },
  beryl: { url: '/models/weapons/beryl.glb', length: 0.94, barrel: [1, 0, 0], up: [0, 1, 0], grip: [-170, -8, 0], support: [120, 50, 0], muzzle: [556.7, 70, 0], eject: [-17, 68, 20], sight: { rear: [-60, 113, 0], front: [430, 105, 0] }, rail: [-69, 115, 0] },
  m762: { url: '/models/weapons/m762.glb', length: 0.92, barrel: [0, 0, 1], up: [0, 1, 0], grip: [7.3, -21, 57], support: [7.3, -12, 112], muzzle: [7.3, -8.7, 174.3], eject: [10, -7, 84], sight: { rear: [7.3, -1.5, 60], front: [7.3, -0.3, 145] }, rail: [7.3, -1.5, 75] },
  // Attachments (inventory icons, previews and mounting): `barrel` = toward the target, `grip` = mounting point.
  red_dot: { url: '/models/accessorys/red-dot-exps.bbmodel', length: 0.086, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, 0, 0], eye: [0, 9.5, -15], mountLength: 0.087 },
  nv_scope_6x: { url: '/models/accessorys/nv-scope-x6.bbmodel', length: 0.284, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, 0, 0], eye: [0, 16.672, -45.312], mountLength: 0.288 },
  scope_2x: { url: '/models/accessorys/scope-2x-fixed.bbmodel', length: 0.287, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, 0, 0], eye: [0, 12.8, -48.512], mountLength: 0.289 },
  scope_4x: { url: '/models/accessorys/scope-4x32.bbmodel', length: 0.305, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, 0, 0], eye: [0, 12.8, -49.472], mountLength: 0.307 },
  scope_8x: { url: '/models/accessorys/scope-8x40.bbmodel', length: 0.303, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, 0, 0], eye: [0, 12.8, -45.632], mountLength: 0.305 },
  scope_10x: { url: '/models/accessorys/scope-10x.bbmodel', length: 0.38125, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, 0, 0], eye: [0, 12.8, -61.84], mountLength: 0.38375 },
  holo_sight: { url: '/models/accessorys/holo-xps.bbmodel', length: 0.099, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, 0, 0], eye: [0, 12, -16.5], mountLength: 0.1 },
  suppressor_pistol: { url: '/models/accessorys/suppressor-compact.bbmodel', length: 0.168, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, 0, 0], tip: [0, 0, 54.125], mountLength: 0.171 },
  suppressor_rifle: { url: '/models/accessorys/suppressor-standard.bbmodel', length: 0.181, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, 0, 0], tip: [0, 0, 58.5], mountLength: 0.184 },
  badge_recruit: { url: '/models/materias/tanbinh-badge.bbmodel', length: 0.15, barrel: [1, 0, 0], up: [0, 1, 0], grip: [0, 0, 0] },
  badge_private: { url: '/models/materias/binhnhi-badge.bbmodel', length: 0.15, barrel: [1, 0, 0], up: [0, 1, 0], grip: [0, 0, 0] },
  badge_corporal: { url: '/models/materias/corporal-badge.bbmodel', length: 0.15, barrel: [1, 0, 0], up: [0, 1, 0], grip: [0, 0, 0] },
  badge_sergeant: { url: '/models/materias/sergeant-badge.bbmodel', length: 0.15, barrel: [1, 0, 0], up: [0, 1, 0], grip: [0, 0, 0] },
  badge_elite: { url: '/models/materias/elite-badge.bbmodel', length: 0.15, barrel: [1, 0, 0], up: [0, 1, 0], grip: [0, 0, 0] },
  pkm: { url: '/models/weapons/pkm-762x54r.bbmodel', length: 1.2, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, -12.5, 8.5], muzzle: [0, 0, 94.25], eject: [-2.8, -2, 15], sight: { rear: [0, 5.5, 28], front: [0.25, 7.5, 81.75] }, rail: [0, 3, 15] },
  ammo_pkm: { url: '/models/weapons/pkm-ammo-box.bbmodel', length: .28, barrel: [1, 0, 0], up: [0, 1, 0], grip: [0, 0, 0] },
  barrett: { url: '/models/weapons/barrett-m82a1.bbmodel', length: 1.773, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, -12.85, 1.55], support: [0, -4.05, 51], muzzle: [0, 0, 140], eject: [-3.65, -3, 18], sight: { rear: [0, 7, 14.28], front: [0, 7, 138] }, rail: [0, 5.5, 20.28], fpHip: [0.2, -0.4123, -0.2137] },
  ammo_50bmg: { url: '/models/weapons/bmg50-ammo-box.bbmodel', length: .3, barrel: [1, 0, 0], up: [0, 1, 0], grip: [0, 5, 0] },
  fire_axe: { url: '/models/weapons/fire-axe.bbmodel', length: .9, barrel: [0, 1, 0], up: [0, 0, 1], grip: [0, 6, 0], support: [0, 1.5, 0], edge: [1, 0, 0], strikePoint: [0, 27, 0] },
  // Remington 870P (ModelGen Gun Studio: its own fitting and pump / trigger clips).
  shotgun: { url: '/models/weapons/remington-870.bbmodel', length: 0.982, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, -7.8, 4.5], support: [0, -6.3, 38], muzzle: [0, 0, 62.7], eject: [-1.697, -1.2, 12], rail: [0, 3, 12], sight: { rear: [0, 3, 29], front: [0, 3, 59.5] }, fireClip: 'pump.pump', supportPart: 'pump' },
  gl18: { url: '/models/weapons/glock-18.bbmodel', length: 0.24, barrel: [0, 0, -1], up: [0, 1, 0], grip: [0, 4, 3.5], muzzle: [0.115, 9.604, -9.1], eject: [1.05, 10.677, -0.739], reloadClip: 'reload', sight: { rear: [0.046, 11.5, 3.866], front: [0.041, 12.5, -7.42] }, rail: [0.028, 11.052, 2.022], attachmentScale: { red_dot: 0.65 } },
  awm: { url: '/models/weapons/awm-338-lapua.bbmodel', length: 1.27, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, -10.2, -2.45], support: [0, -7.165, 36.75], muzzle: [0, 0, 90.6], eject: [-2.508, -0.35, 12.75], sight: { rear: [0, 5.1, 7.25], front: [0, 5.1, 88.6] }, rail: [0, 3.6, 13.25] },
  m4a1: { url: '/models/weapons/m4a1-sopmod.bbmodel', length: 0.83, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, -11.1, -0.15], support: [0, -2.6, 26.9], muzzle: [0, 0, 59], eject: [-1.27, 0.1, 9], sight: { rear: [0, 7, 18.77], front: [0, 7, 37.25] }, rail: [0, 4, 26.77] },
  aug: { url: '/models/weapons/steyr-aug-a3.bbmodel', length: 0.732, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, -8.25, -0.25], support: [0, -13.9, 16.7], muzzle: [0, 0, 36], eject: [-2.126, 0.75, 8], sight: { rear: [0, 10.05, -5.75], front: [0, 10.05, 34] }, rail: [0, 8.55, 0.25] },
  svd: { url: '/models/weapons/svd-dragunov-v2.bbmodel', length: 1.187, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, -7, 1], support: [0, -2.8, 38], muzzle: [0, 0, 92.5], eject: [-1.625, -0.9, 12], sight: { rear: [0, 4, 25], front: [0, 5.5, 80.375] }, rail: [0, 1.5, 12] },
  saiga12: { url: '/models/weapons/saiga-12k.bbmodel', length: 0.94, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, -12, 5.5], support: [0, -3.59, 42.5], muzzle: [0, 0, 68.25], eject: [-2.575, -2.25, 15], sight: { rear: [0, 8.5, 8.272], front: [0, 8.5, 56.75] }, rail: [0, 6.5, 16.272] },
  double_barrel: { url: '/models/weapons/sxs-double-barrel.bbmodel', length: 1.168, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, -7.5, 1], support: [0, -4.4, 23], muzzle: [0, 0, 76], eject: [-2.3, -1.25, 2.5], sight: { rear: [0, 4, -3.5], front: [0, 4, 74] } },
  revolver: { url: '/models/weapons/sw-model-10.bbmodel', length: 0.232, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, -7, 0], muzzle: [0, 0, 20.5], eject: [-1.584, -0.4, 5], sight: { rear: [0, 2.5, 2.25], front: [0, 2, 19] } },
  mp5: { url: '/models/weapons/mp5a3.bbmodel', length: 0.55, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, -11.041, 6.44], support: [0, -3.568, 33.5], muzzle: [0, 0, 46], eject: [-2.292, -0.5, 13.5], sight: { rear: [-0.188, 7, 3.75], front: [0, 8.375, 40] }, rail: [0, 3.5, 13.5] },
  ammo_57x28: { url: '/models/ammos/ammo-box-9mm-30rd.bbmodel', length: 0.2, barrel: [1, 0, 0], up: [0, 1, 0], grip: [0, 8, 0] },
  ammo_762x51: { url: '/models/weapons/ammo-box-762x54r.bbmodel', length: 0.3, barrel: [1, 0, 0], up: [0, 1, 0], grip: [5, 6.5, 0] },
  grenade_launcher: { url: '/models/weapons/milkor-mgl.bbmodel', length: 0.778, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, -11.507, 3.699], support: [0, -14.35, 29.5], muzzle: [0, 0, 52.75], eject: [-2.463, -1, 4.986], sight: { rear: [0, 11.5, 11.5], front: [0, 11.5, 21.5] }, rail: [0, 4, 4.986] },
  crossbow: { url: '/models/weapons/modern-crossbow.bbmodel', length: 0.85, barrel: [0, 1, 0], up: [0, 0, 1], grip: [0, 9.5, -4.5], muzzle: [0, 38, 0] },
  // RPG-7V (ModelGen Gun Studio): +Z forward, venturi at the back, trigger group under the barrel.
  // The PGO-7 optical sight always rides on the tube above the trigger group: its built-in sight.
  rocket_launcher: { url: '/models/weapons/rpg-7v.bbmodel', length: 0.95, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, -11.9, 55.5], support: [0, -4, 23], muzzle: [0, 0, 73.5], sight: { rear: [0, 5.375, 52], front: [0, 5.5, 68] }, rail: [0, 3.8, 56], builtinOptic: 'scope_pgo7', round: { item: 'rocket', length: .45, inside: .2 } },
  flamethrower: { url: '/models/weapons/m2-flamethrower.bbmodel', length: 1.159, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, -9.5, 5.25], muzzle: [0, 0, 95.5], eject: [-2.9, 0, 9], sight: { rear: [0, 5.5, 3], front: [0, 5.5, 93.5] } },
  // Blades: fitted like a gun (point forward); `muzzle` marks the tip for slash effects.
  machete: { url: '/models/weapons/machete.bbmodel', length: 0.65, barrel: [0, 1, 0], up: [1, 0, 0], grip: [0, 3, 0], edge: [-1, 0, 0], strikePoint: [0, 20, 0], fpHip: [0.3359, -0.235, -0.2537], fpSupport: [0, 0, 0], fpRot: [0.548, 0.0349] },
  baseball_bat: { url: '/models/weapons/baseball-bat.bbmodel', length: 0.85, barrel: [0, 1, 0], up: [1, 0, 0], grip: [0, 4, 0], support: [0, 1.4, 0], edge: [-1, 0, 0], strikePoint: [0, 26, 0], fpHip: [0.255, -0.215, -0.205], fpRot: [0.4538, 0] },
  crowbar: { url: '/models/weapons/crowbar.bbmodel', length: 0.7, barrel: [0, 1, 0], up: [1, 0, 0], grip: [0, 4, 0], edge: [-1, 0, 0], strikePoint: [0, 23, 0], fpHip: [0.3359, -0.27, -0.25], fpRot: [0.3595, 0.1012] },
  katana: { url: '/models/weapons/katana.bbmodel', length: 1, barrel: [0, 1, 0], up: [1, 0, 0], grip: [0, 5, 0], edge: [-1, 0, 0], strikePoint: [0, 32, 0], fpHip: [0.2988, -0.2559, -0.1437], fpRot: [0.3944, 0.2269] },
  // Polearm (Sketchfab GLB, shaft lying diagonally in the file): blade towards +barrel, its edge out along `edge`.
  quam: { url: '/models/weapons/polearm.glb', length: 1.95, barrel: [0.9705, -0.211, 0.1164], up: [-0.2312, -0.6796, 0.6962], grip: [-0.3616, 0.0718, -0.0366], support: [-0.7498, 0.1562, -0.0832], edge: [-0.2312, -0.6796, 0.6962], strikePoint: [0.774, -0.1751, 0.0995], fpHip: [0.4088, -0.329, -0.25], fpRot: [0.4014, -0.199] },
  // Low-poly pirate shovel (Sketchfab, GLB units): handle end at −Z, blade towards +Z, blade face across Y.
  shovel: { url: '/models/tools/shovel.glb', length: 1.15, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, -.01, -2.6], strikePoint: [0, -.05, 2.3], fpHip: [0.4115, -0.27, -0.25] },
  long_sledgehammer: { url: '/models/weapons/long-sledgehammer.bbmodel', length: 1.5, barrel: [0, 1, 0], up: [0, 0, 1], grip: [0, 7, 0], support: [0, 1.5, 0], edge: [1, 0, 0], strikePoint: [0, 43, 0] },
  // Ammo boxes are never held; they are loaded for their inventory icons (muzzle-less = no gun scaling).
  ammo_762: { url: '/models/ammos/ak-box-762x39.bbmodel', length: 0.2, barrel: [1, 0, 0], up: [0, 1, 0], grip: [0, 8, 0] },
  ammo_9mm: { url: '/models/ammos/ammo-box-9mm-30rd.bbmodel', length: 0.2, barrel: [1, 0, 0], up: [0, 1, 0], grip: [0, 8, 0] },
  ammo_12g: { url: '/models/ammos/shotgun-shell-box.bbmodel', length: 0.2, barrel: [1, 0, 0], up: [0, 1, 0], grip: [2, 4, 4] },
  ammo_300wm: { url: '/models/ammos/awm-300wm-box.bbmodel', length: 0.2, barrel: [1, 0, 0], up: [0, 1, 0], grip: [0, 7, 0] },
  ammo_556: { url: '/models/weapons/ammo-box-556-nato.bbmodel', length: 0.2, barrel: [1, 0, 0], up: [0, 1, 0], grip: [0.5, 6.5, 0] },
  ammo_762x54: { url: '/models/weapons/ammo-box-762x54r.bbmodel', length: 0.3, barrel: [1, 0, 0], up: [0, 1, 0], grip: [5, 6.5, 0] },
  ammo_357: { url: '/models/ammos/ammo-box-9mm-30rd.bbmodel', length: 0.2, barrel: [1, 0, 0], up: [0, 1, 0], grip: [0, 8, 0] },
  ammo_40mm: { url: '/models/weapons/grenade-40mm-retail-pack.bbmodel', length: 0.3, barrel: [1, 0, 0], up: [0, 1, 0], grip: [0, 6.5, 0.75] },
  rocket: { url: '/models/weapons/rpg32-rocket-v2.bbmodel', length: 0.96, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, 0, 72] },
  bolts: { url: '/models/weapons/arrow-quiver.bbmodel', length: 0.6, barrel: [0, 1, 0], up: [1, 0, 0], grip: [0, 14, -0.5] },
  fuel_tank: { url: '/models/weapons/flamethrower-fuel-tank.bbmodel', length: 0.45, barrel: [0, 1, 0], up: [1, 0, 0], grip: [2.5, 11.5, 0] },
  // Rounds in flight (nose → +X in the display model) and the ZCoin.
  proj_grenade40: { url: '/models/weapons/grenade-launcher-round.bbmodel', length: 0.22, barrel: [0, 0, -1], up: [0, 1, 0], grip: [0, 4, 0] },
  proj_rocket: { url: '/models/weapons/rpg32-rocket-v2.bbmodel', length: 0.96, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, 0, 72] },
  proj_bolt: { url: '/models/weapons/arrow.bbmodel', length: 0.6, barrel: [0, 1, 0], up: [1, 0, 0], grip: [0, 16, 0] },
  medkit: { url: '/models/tools/first-aid-kit.bbmodel', length: 0.35, barrel: [1, 0, 0], up: [0, 1, 0], grip: [0, 5.5, 0] },
  zcoin: { url: '/models/materias/gold-coin-z.bbmodel', length: 0.05, barrel: [1, 0, 0], up: [0, 1, 0], grip: [0, 7, 0] },
  grenade: { url: '/models/weapons/frag-grenade.bbmodel', length: 0.16, barrel: [0, 0, -1], up: [0, 1, 0], grip: [0, 5, 0] },
  flashbang: { url: '/models/weapons/flashbang-grenade.bbmodel', length: 0.13, barrel: [0, 0, -1], up: [0, 1, 0], grip: [0, 5, 0] },
  smoke_grenade: { url: '/models/weapons/smoke-grenade.bbmodel', length: 0.15, barrel: [0, 0, -1], up: [0, 1, 0], grip: [0, 5, 0] },
  c4: { url: '/models/weapons/remote-c4-bomb.bbmodel', length: .42, barrel: [1, 0, 0], up: [0, 1, 0], grip: [0, 0, 0] },
  c4_detonator: { url: '/models/weapons/c4-clacker-detonator.bbmodel', length: .1, barrel: [0, 0, -1], up: [0, 1, 0], grip: [0, 6, 0] },
  proj_c4: { url: '/models/weapons/c4-bomb.bbmodel', length: .28, barrel: [1, 0, 0], up: [0, 1, 0], grip: [-3, 0, 0] },
  // ModelGen Gun Studio models (zion_weapon / zion_attachment): +Z forward, +Y up, Blockbench pixels.
  m79: { url: '/models/weapons/m79-grenade-launcher.bbmodel', length: 0.739, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, -8, 1.5], support: [0, -6.7, 22.75], muzzle: [0, 0, 42], eject: [-2.525, -0.75, 7], sight: { rear: [0.188, 5, 18.688], front: [0, 5, 39.062] } },
  remington700: { url: '/models/weapons/remington-700.bbmodel', length: 1.09, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, -5.4, -0.4], muzzle: [0, 0, 73], eject: [-1.8, 0, 11], sight: { rear: [0, 4.6, 4.4], front: [0, 4.6, 71] }, rail: [0, 3.1, 10.4] },
  suppressor_sniper: { url: '/models/accessorys/suppressor-heavy.bbmodel', length: 0.181, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, 0, 0], tip: [0, 0, 58.5], mountLength: 0.184 },
  scope_pgo7: { url: '/models/accessorys/scope-pgo7.bbmodel', length: 0.275, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, 0, 0], eye: [0, 14.392, -49.472], mountLength: 0.278 },
  compensator: { url: '/models/accessorys/compensator-multiport.bbmodel', length: 0.061, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, 0, 0], tip: [0, 0, 19.75], mountLength: 0.063 },
  compensator_rifle: { url: '/models/accessorys/compensator-rifle.bbmodel', length: 0.059, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, 0, 0], tip: [0, 0, 19.5], mountLength: 0.063 },
};

// Base building: the pickaxe (held and swung like the axe) and the resources, blueprints and radio.
WEAPON_SPECS.pickaxe = { url: '/models/tools/pickaxe.bbmodel', length: .85, barrel: [0, 1, 0], up: [0, 0, 1], grip: [0, 5, 0], support: [0, 1.5, 0], edge: [1, 0, 0], strikePoint: [11, 26, 0] };
for (const [item, url, length] of [
  ['wood_log', '/models/materias/old-wooden-beam.bbmodel', 1], ['plank', '/models/materias/old-dusty-wood-board.bbmodel', 1], ['stone', '/models/materias/stone-chunk.bbmodel', .3],
  ['iron_ore', '/models/materias/iron-ore.bbmodel', .3], ['copper_ore', '/models/materias/copper-ore.bbmodel', .3], ['lead_ore', '/models/materias/lead-ore.bbmodel', .3],
  ['bp_wood_outpost', '/models/materias/blueprint-roll.bbmodel', .7], ['bp_stone_bunker', '/models/materias/blueprint-roll.bbmodel', .7], ['bp_metal_fortress', '/models/materias/blueprint-roll.bbmodel', .7],
  ['supply_radio', '/models/tools/supply-radio.bbmodel', .3],
] as const) WEAPON_SPECS[item] = { url, length, barrel: [1, 0, 0], up: [0, 1, 0], grip: [0, 0, 0] };

// The backpack (worn in the pack slot; the same model as on the character's back).
WEAPON_SPECS.military_backpack = { url: '/models/gear/military-backpack.glb', length: 0.55, barrel: [0, 1, 0], up: [0, 0, 1], grip: [0, 0, 0] };
WEAPON_SPECS.flashlight = { url: '/models/tools/flashlight.bbmodel', length: 0.22, barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, 2, 0], emitter: [0, 2, 9] };

// Food and resources: inventory icons (and held/ground models).
for (const [item, file] of Object.entries({ potato: 'potato', potato_cooked: 'potato-cooked', raw_mutton: 'raw-mutton', raw_porkchop: 'raw-porkchop', cooked_mutton: 'cooked-mutton', cooked_porkchop: 'cooked-porkchop', nuclear_cell: 'nuclear-power-cell', coal_carton: 'coal-in-old-carton' })) {
  WEAPON_SPECS[item] = { url: `/models/materias/${file}.bbmodel`, length: 0.2, barrel: [1, 0, 0], up: [0, 1, 0], grip: [0, 0, 0] };
}

// Armour pieces: loaded for their inventory icons only (worn models come from armor-models.ts).
for (const a of ARMOR_SPECS) WEAPON_SPECS[a.item] = { url: a.model.url, ...(a.model.node ? { node: a.model.node, nodeYaw: a.model.yaw ?? 0 } : {}), length: a.slot === 'chest' ? 0.55 : 0.3, barrel: [1, 0, 0], up: [0, 1, 0], grip: [0, 0, 0] };

/** The visual table before any Studio edits. */
const BUILTIN_VISUALS = new Map(Object.entries(WEAPON_SPECS).map(([id, spec]) => [id, structuredClone(spec)]));

/** Where the fist closes, relative to the hand locator (which sits at the bottom of the arm). */
const HAND_GRIP = new Vector3(0, 2 / BB_UNITS_PER_METER, -0.2 / BB_UNITS_PER_METER);
/** In the pose they are fitted in, guns point straight ahead and slightly down at the ground. */
const AIM_DIR = new Vector3(0, -0.08, -1).normalize();

export interface WeaponVisual {
  itemId: string;
  /** Scale guns were fitted at relative to their real size (the block characters hold them larger). */
  heldScale?: number;
  object: Group;
  /** Transform relative to the right-hand bone. */
  attach: Matrix4;
  offhandAttach?: Matrix4;
  offhandArm?: Object3D;
  /** Authored bore axes and grip, independent of the animated wrist orientation. */
  aim?: { barrel: Vector3; up: Vector3; grip: Vector3 };
  melee?: { held: StrikeAxes; display: StrikeAxes };
  firstPersonSupport?: { arm: Object3D; contact: Vector3 };
  /** The trigger (right) arm for the first-person view; its fist closes on the grip (display origin). */
  firstPersonTrigger?: { arm: Object3D };
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
  /** Authoring data, kept for mounting attachments. */
  spec?: WeaponSpec;
  /** Sight line in display space (muzzle +X, top +Y, metres): iron sights, or the mounted optic's axis. */
  sight?: { rear: Vector3; front: Vector3 } | null;
  /** The optic (attachment item id) this visual is dressed with, if any. */
  optic?: string;
}

export type WeaponLibrary = Map<string, WeaponVisual>;

/**
 * Skinned meshes (common in Sketchfab exports) become plain meshes in their bind pose. Skinned,
 * they would be scaled twice by the weapon's fitting (bones and mesh both carry it) and shrink to
 * nothing, and a clone (display / held copies) would still follow the original's bones.
 */
function unskin(scene: Object3D): void {
  scene.updateMatrixWorld(true);
  const skinned: SkinnedMesh[] = [];
  scene.traverse((o) => { if ((o as SkinnedMesh).isSkinnedMesh) skinned.push(o as SkinnedMesh); });
  const v = new Vector3();
  for (const sm of skinned) {
    const geo = sm.geometry.clone();
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) { sm.getVertexPosition(i, v); pos.setXYZ(i, v.x, v.y, v.z); }
    pos.needsUpdate = true;
    geo.deleteAttribute('skinIndex'); geo.deleteAttribute('skinWeight');
    geo.computeBoundingBox(); geo.computeBoundingSphere();
    const mesh = new Mesh(geo, sm.material);
    mesh.name = sm.name; mesh.castShadow = sm.castShadow; mesh.receiveShadow = sm.receiveShadow;
    mesh.position.copy(sm.position); mesh.quaternion.copy(sm.quaternion); mesh.scale.copy(sm.scale);
    sm.parent?.add(mesh); sm.removeFromParent();
  }
}

/** Loads a weapon model: Blockbench JSON, or an imported GLB whose own units are the authoring units. */
export async function loadWeaponModel(url: string, onProgress?: (p: number) => void, format?: 'glb' | 'bbmodel', node?: string, nodeYaw = 0): Promise<CharacterTemplate> {
  if (node) {
    const root = new Group(), piece = bake(await loadGlbScene(url), node, nodeYaw);
    onProgress?.(1);
    piece.scale.setScalar(1 / BB_UNITS_PER_METER);
    root.add(piece);
    return { root, boneNames: [], clips: new Map() };
  }
  if ((format ?? (url.split('?')[0]!.endsWith('.glb') ? 'glb' : 'bbmodel')) !== 'glb') return buildBBModel(JSON.parse(await fetchWithProgress(url, onProgress)) as RawModel);
  const res = await cachedFetch(url);
  if (!res.ok) throw new Error(`weapon model unavailable (${res.status})`);
  const gltf = await new GLTFLoader().parseAsync(await res.arrayBuffer(), '');
  onProgress?.(1);
  unskin(gltf.scene);
  const root = new Group();
  // Spec points are given in the file's units; Blockbench models use pixels (1/16 m) the same way.
  gltf.scene.scale.setScalar(1 / BB_UNITS_PER_METER);
  root.add(gltf.scene);
  const weapon = gltf.parser.json.extras?.zion_weapon ?? gltf.scene.userData.zion_weapon;
  return { root, boneNames: [], clips: new Map(), ...(weapon ? { weapon } : {}) };
}

/**
 * An accessory drawn in ModelGen's accessory studio carries its own fitting (`zion_attachment`):
 * it replaces the table's mount pivot, axes, eyepiece and sizes, so a new model seats on the rail
 * and lines up its optical axis without hand tuning.
 */
export function fittedSpec(spec: WeaponSpec, template: CharacterTemplate): WeaponSpec {
  // Points set in the Studio are what the game uses (the file's own fitting only fills in for
  // a weapon nobody has edited), so the game matches the Studio's preview.
  if (template.weapon && !spec.studio) {
    const gun = template.weapon;
    spec = { ...spec,
      ...(gun.barrel ? { barrel: gun.barrel } : {}), ...(gun.up ? { up: gun.up } : {}),
      ...(gun.grip ? { grip: gun.grip } : {}), ...(gun.support ? { support: gun.support } : {}),
      ...(gun.muzzle ? { muzzle: gun.muzzle } : {}), ...(gun.eject ? { eject: gun.eject } : {}),
      ...(gun.length ? { length: gun.length } : {}), ...(gun.rail ? { rail: gun.rail } : {}),
      ...(gun.sight ? { sight: gun.sight } : {}),
      ...(gun.gripAxis ? { gripAxis: gun.gripAxis } : {}), ...(gun.supportAxis ? { supportAxis: gun.supportAxis } : {}),
      ...(gun.gripRadius ? { gripRadius: gun.gripRadius } : {}), ...(gun.supportRadius ? { supportRadius: gun.supportRadius } : {}),
    };
  }
  const fit = template.attachment;
  if (!fit) return spec;
  return {
    ...spec,
    ...(fit.barrel ? { barrel: fit.barrel } : {}),
    ...(fit.up ? { up: fit.up } : {}),
    ...(fit.grip ? { grip: fit.grip } : {}),
    ...(fit.length ? { length: fit.length } : {}),
    ...(fit.mountLength ? { mountLength: fit.mountLength } : {}),
    ...(fit.eye ? { eye: fit.eye } : {}),
    ...(fit.muzzle ? { tip: fit.muzzle } : {}),
  };
}

/** Attachment size relative to their real length: drawn a little smaller so they sit in proportion on the guns. */
const OPTIC_SCALE = .8;
const MUZZLE_DEVICE_SCALE = .75;

/** Basis from an authored forward/up pair (forward → X, up → Y). */
function basis(forward: Vector3, up: Vector3): Matrix4 {
  return frame(forward, up);
}

/**
 * Transform placing an attachment model (its own metres) into a gun model (gun metres): its
 * mounting point on the gun's rail / muzzle, its forward along the barrel, its top up, at its real
 * size whatever scale the gun is drawn at.
 */
function mountTransform(gun: WeaponVisual, part: WeaponVisual, slot: 'optic' | 'muzzle'): Matrix4 | null {
  if (!gun.spec || !part.spec) return null;
  const at = slot === 'optic' ? gun.spec.rail : gun.spec.muzzle;
  if (!at) return null;
  const gunScale = gun.spec.length / Math.max(1e-3, measureAlong(gun.object, new Vector3(...gun.spec.barrel)));
  // Every attachment has one mounted size on any gun (its length on the gun, metres), taken from
  // the hand-tuned guns in the Studio; a gun may still scale one attachment (Studio, ×1 default).
  const partMeasured = Math.max(1e-3, measureAlong(part.object, new Vector3(...part.spec.barrel)));
  const length = part.spec.mountLength ?? part.spec.length * (slot === 'optic' ? OPTIC_SCALE : MUZZLE_DEVICE_SCALE);
  const rot = basis(new Vector3(...gun.spec.barrel), new Vector3(...gun.spec.up)).multiply(basis(new Vector3(...part.spec.barrel), new Vector3(...part.spec.up)).transpose());
  const tweak = gun.spec.attachmentScale?.[part.itemId] ?? (slot === 'optic' ? gun.spec.opticScale : gun.spec.muzzleScale) ?? 1;
  const k = length / partMeasured / gunScale * tweak;
  // The attachment's pivot (centre of its contact face) lands exactly on the gun's attachment
  // point, moved only by this combination's authored offset. Nothing is fitted at run time.
  const pivot = new Vector3(...part.spec.grip).multiplyScalar(1 / BB_UNITS_PER_METER);
  const offset = gun.spec.attachmentOffset?.[part.itemId] ?? [0, 0, 0];
  const anchor = new Vector3(at[0] + offset[0], at[1] + offset[1], at[2] + offset[2]).multiplyScalar(1 / BB_UNITS_PER_METER);
  return new Matrix4().makeTranslation(anchor.x, anchor.y, anchor.z).multiply(rot).multiply(new Matrix4().makeScale(k, k, k)).multiply(new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
}

/**
 * An attachment model placed on a gun model exactly as in game (Studio preview): `gunRoot` is the
 * gun's loaded model, the result goes into it. Null when the gun has no mount for that slot.
 */
export async function previewAttachment(gunSpec: WeaponSpec, gunRoot: Group, attachment: string): Promise<Group | null> {
  const tableSpec = WEAPON_SPECS[attachment];
  const slot = attachmentDef(attachment)?.slot === 'muzzle' ? 'muzzle' : 'optic';
  if (!tableSpec) return null;
  const partModel = await loadWeaponModel(tableSpec.url, undefined, tableSpec.format);
  const partSpec = fittedSpec(tableSpec, partModel);
  const partRoot = partModel.root;
  const visual = (itemId: string, spec: WeaponSpec, object: Group): WeaponVisual => ({ itemId, object, display: object, attach: new Matrix4(), clips: new Map(), reloadClip: null, muzzle: null, eject: null, spec });
  const transform = mountTransform(visual('gun', gunSpec, gunRoot), visual(attachment, partSpec, partRoot), slot);
  return transform ? mounted(visual(attachment, partSpec, partRoot), transform) : null;
}

function mounted(part: WeaponVisual, transform: Matrix4): Group {
  const holder = new Group();
  holder.name = `attachment-${part.itemId}`;
  holder.matrixAutoUpdate = false;
  holder.matrix.copy(transform);
  holder.add(part.object.clone(true));
  return holder;
}

const dressed = new WeakMap<WeaponLibrary, Map<string, WeaponVisual>>();

/**
 * A gun dressed with its attachments: the optic on the rail, the muzzle device on the muzzle, the
 * muzzle marker moved to the device's end and the sight line moved to the optic's axis. Cached per
 * combination; the bare gun is returned unchanged when nothing is mounted.
 */
/** A weapon's attachments plus the optic it always carries (the rocket launcher's PGO-7). */
export function withBuiltinOptic(itemId: string | null, attachments: Attachments | undefined): Attachments | undefined {
  const builtin = itemId ? WEAPON_SPECS[itemId]?.builtinOptic : undefined;
  return builtin && !attachments?.optic ? { ...attachments, optic: builtin } : attachments;
}

/** Iron sight groups of a ModelGen gun (and their merged meshes). */
const IRON_SIGHT = /^(rear|front)-sight(-leaf|-base)?(__pivot)?(_mesh)?$/;

export function dressWeapon(lib: WeaponLibrary | null, itemId: string, given: Attachments | undefined): WeaponVisual | undefined {
  const attachments = withBuiltinOptic(itemId, given);
  const base = lib?.get(itemId);
  if (!lib || !base || !attachments || !ATTACHMENT_SLOTS.some((slot) => attachments[slot])) return base;
  const key = `${itemId}|${attachments.optic ?? ''}|${attachments.muzzle ?? ''}`;
  let cache = dressed.get(lib);
  if (!cache) dressed.set(lib, cache = new Map());
  const hit = cache.get(key);
  if (hit) return hit;
  const object = base.object.clone(true);
  const display = base.display.clone(true);
  const inner = display.children[0]!;
  let muzzle = base.muzzle?.clone() ?? null;
  let sight = base.sight ? { rear: base.sight.rear.clone(), front: base.sight.front.clone() } : null;
  for (const slot of ATTACHMENT_SLOTS) {
    const id = attachments[slot];
    const part = id ? lib.get(id) : undefined;
    const transform = part ? mountTransform(base, part, slot) : null;
    if (!part || !transform) continue;
    object.add(mounted(part, transform));
    inner.add(mounted(part, transform));
    const forward = new Vector3(...part.spec!.barrel).transformDirection(transform);
    if (slot === 'muzzle' && part.spec?.tip) muzzle = new Vector3(...part.spec.tip).multiplyScalar(1 / BB_UNITS_PER_METER).applyMatrix4(transform);
    if (slot === 'optic' && part.spec?.eye) {
      const eye = new Vector3(...part.spec.eye).multiplyScalar(1 / BB_UNITS_PER_METER).applyMatrix4(transform);
      sight = { rear: eye.clone().applyMatrix4(inner.matrix), front: eye.clone().addScaledVector(forward, .2).applyMatrix4(inner.matrix) };
    }
  }
  // With an optic on the rail the iron sights are folded away (flip-up sights) — they would stand
  // in the optic's sight picture otherwise.
  if (attachments.optic && sight !== base.sight) {
    for (const root of [object, display]) root.traverse((o) => { if (IRON_SIGHT.test(o.name)) o.visible = false; });
  }
  const marker = display.getObjectByName('weapon-muzzle');
  if (marker && muzzle) marker.position.copy(muzzle).applyMatrix4(inner.matrix);
  const visual: WeaponVisual = { ...base, object, display, muzzle, sight, ...(attachments.optic ? { optic: attachments.optic } : {}) };
  cache.set(key, visual);
  return visual;
}

/** A single, owned display model for the handbook; uses the in-game orientation table. */
export async function loadItemDisplayModel(itemId: string, attachments?: Attachments): Promise<Group> {
  const spec = WEAPON_SPECS[itemId];
  if (!spec) throw new Error(`No display model for ${itemId}`);
  const root = (await loadWeaponModel(spec.url, undefined, spec.format)).root;
  const display = displayModel(spec, root);
  const parts = ATTACHMENT_SLOTS.map((slot) => attachments?.[slot]).filter((id): id is string => !!id && !!WEAPON_SPECS[id]);
  if (!parts.length) return display;
  // A throwaway library: the gun plus its parts, dressed exactly like in game.
  const visual = (id: string, object: Group, shown: Group): WeaponVisual => ({ itemId: id, object, display: shown, attach: new Matrix4(), clips: new Map(), reloadClip: null, muzzle: WEAPON_SPECS[id]!.muzzle ? new Vector3(...WEAPON_SPECS[id]!.muzzle!).multiplyScalar(1 / BB_UNITS_PER_METER) : null, eject: null, spec: WEAPON_SPECS[id]! });
  const lib: WeaponLibrary = new Map([[itemId, visual(itemId, root, display)]]);
  for (const id of parts) { const part = (await loadWeaponModel(WEAPON_SPECS[id]!.url)).root; lib.set(id, visual(id, part, part)); }
  return dressWeapon(lib, itemId, attachments)!.display;
}

/** Held guns: real size for the survivor, larger on the stylised block character. */
function heldGunScale(character: CharacterTemplate): number {
  return character.human ? SURVIVOR_GUN_SCALE : HELD_GUN_SCALE;
}

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
export function fitToHand(character: CharacterTemplate, spec: WeaponSpec, stance: Stance, weaponRoot: Group, side: 'left' | 'right' = 'right'): Matrix4 {
  const avatar = new Avatar(character, true, { body: false });
  avatar.setStance(stance);
  for (let i = 0; i < 3; i++) avatar.update(0, 0, 0, 0, EntityFlags.Grounded, 0.25, 0);
  avatar.root.updateMatrixWorld(true);
  const hand = avatar.root.getObjectByName(`hand_${side}`);
  if (!hand) throw new Error('character has no hand_right bone');

  const scale = ((spec.muzzle ? heldGunScale(character) : 1) * spec.length * (spec.size ?? 1)) / Math.max(1e-3, measureAlong(weaponRoot, new Vector3(...spec.barrel)));

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
  for (const key of ['muzzle', 'eject', 'emitter', 'rail'] as const) {
    const point = spec[key];
    if (!point) continue;
    const marker = new Group();
    marker.name = `weapon-${key}`;
    marker.position.set(...point).multiplyScalar(1 / BB_UNITS_PER_METER).applyMatrix4(inner.matrix);
    outer.add(marker);
    if (key === 'emitter') {
      const direction = new Group(); direction.name = 'weapon-light-direction';
      direction.position.copy(marker.position).add(new Vector3(1, 0, 0)); outer.add(direction);
    }
  }
  return outer;
}

/** Extent of all mesh vertices projected on an axis (metres at character scale). */
/**
 * Puts a launcher's round in its muzzle (a group `weapon-round`, hidden while unloaded): the
 * round's model along the barrel, its tail `inside` metres down the tube. Left out of the gun's
 * measured length, so the gun keeps its size.
 */
async function loadRound(root: Group, spec: WeaponSpec, round: NonNullable<WeaponSpec['round']>): Promise<void> {
  const roundSpec = WEAPON_SPECS[round.item];
  if (!roundSpec) return;
  const model = (await loadWeaponModel(roundSpec.url, undefined, roundSpec.format)).root;
  const barrel = new Vector3(...spec.barrel).normalize();
  // Display metres per unit of the gun's own frame.
  const metres = spec.length / Math.max(1e-3, measureAlong(root, barrel.clone()));
  const along = new Vector3(...roundSpec.barrel).normalize();
  const box = new Box3().setFromObject(model, true);
  const size = Math.max(1e-3, box.getSize(new Vector3()).dot(new Vector3(Math.abs(along.x), Math.abs(along.y), Math.abs(along.z))));
  const tail = box.getCenter(new Vector3()).addScaledVector(along, -size / 2);
  const scale = round.length / metres / size;
  const holder = new Group();
  holder.name = 'weapon-round';
  holder.userData.noMeasure = true;
  holder.quaternion.setFromUnitVectors(along, barrel);
  holder.scale.setScalar(scale);
  holder.position.copy(new Vector3(...spec.muzzle!).multiplyScalar(1 / BB_UNITS_PER_METER))
    .addScaledVector(barrel, -round.inside / metres)
    .sub(tail.multiplyScalar(scale).applyQuaternion(holder.quaternion));
  holder.add(model);
  root.add(holder);
}

function measureAlong(root: Group, axis: Vector3): number {
  axis.normalize();
  let lo = Infinity;
  let hi = -Infinity;
  const p = new Vector3(), toRoot = new Matrix4();
  root.updateMatrixWorld(true);
  // Measured in the model's own frame, whatever it is parented to (the Studio rotates it for display).
  const parentInverse = root.parent ? new Matrix4().copy(root.parent.matrixWorld).invert() : new Matrix4();
  root.traverse((o) => {
    for (let p: Object3D | null = o; p && p !== root; p = p.parent) if (p.userData.noMeasure) return;
    const geo = (o as { geometry?: { getAttribute(n: string): { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number } } }).geometry;
    if (!geo) return;
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const d = p.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(toRoot.multiplyMatrices(parentInverse, o.matrixWorld)).dot(axis);
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
  });
  return hi > lo ? hi - lo : 0;
}

/**
 * The character's arms for the first-person view: the firing hand on the grip and the support
 * hand on the handguard (rifles), round the firing hand (pistols), or on a second grip point
 * (two-handed melee). `fpSupport` (Studio) shifts the support hand.
 */
export function firstPersonArms(character: CharacterTemplate, itemId: string, spec: WeaponSpec, displayTransform: Matrix4): Pick<WeaponVisual, 'firstPersonSupport' | 'firstPersonTrigger'> {
  const left = character.root.getObjectByName('arm_left'), right = character.root.getObjectByName('arm_right');
  const local = (p: Vec3) => new Vector3(...p).multiplyScalar(1 / BB_UNITS_PER_METER);
  const gun = !!spec.muzzle, melee = !!spec.edge || ITEMS[itemId]?.category === 'melee';
  if (!gun && !melee) return {};
  let contact: Vector3 | null = null;
  // Pistols: the support hand wraps the firing hand from the left, under the slide.
  if (gun && ITEMS[itemId]?.stance === 'pistol' && !spec.support) contact = new Vector3(.005, -.045, -.045);
  // The palm cups the handguard from underneath (a little below the authored point).
  else if (spec.support) contact = local(spec.support).applyMatrix4(displayTransform);
  else if (gun) contact = new Vector3(Math.max(.08, local(spec.muzzle!).applyMatrix4(displayTransform).x * .38), -.025, 0);
  if (contact && spec.fpSupport) contact.add(new Vector3(...spec.fpSupport));
  return {
    ...(left && contact ? { firstPersonSupport: { arm: left, contact } } : {}),
    ...(right ? { firstPersonTrigger: { arm: right } } : {}),
  };
}

/**
 * A weapon visual straight from an authoring spec and a loaded model, without the character fit
 * (Studio previews: the model on its own and the first-person view).
 */
export function standaloneVisual(itemId: string, spec: WeaponSpec, root: Group, character?: CharacterTemplate): WeaponVisual {
  const display = displayModel(spec, root);
  const toDisplay = display.children[0]!.matrix;
  const local = (p?: Vec3) => (p ? new Vector3(...p).multiplyScalar(1 / BB_UNITS_PER_METER) : null);
  return {
    itemId, object: root, display, attach: new Matrix4(), clips: new Map(), reloadClip: null,
    muzzle: local(spec.muzzle), eject: local(spec.eject), spec,
    sight: spec.sight ? { rear: local(spec.sight.rear)!.applyMatrix4(toDisplay), front: local(spec.sight.front)!.applyMatrix4(toDisplay) } : null,
    ...(character ? firstPersonArms(character, itemId, spec, toDisplay) : {}),
  };
}

/** Downloads and fits every weapon model; part of the pre-game loading step. */
export async function loadWeapons(character: CharacterTemplate, onProgress?: (p: number) => void): Promise<WeaponLibrary> {
  // The Studio's weapons and gear fitting, before anything is built or dressed.
  await Promise.all([loadCustomWeapons(), loadGearFit(), loadHandStudio()]);
  const ids = Object.keys(WEAPON_SPECS);
  const progress = new Array<number>(ids.length).fill(0);
  const report = () => onProgress?.(progress.reduce((a, b) => a + b, 0) / ids.length);
  const lib: WeaponLibrary = new Map();
  const ownedRoots: Group[] = [];
  const results = await Promise.allSettled(
    ids.map(async (itemId, i) => {
      const tableSpec = WEAPON_SPECS[itemId]!;
      const built = await loadWeaponModel(tableSpec.url, (p) => {
        progress[i] = p;
        report();
      }, tableSpec.format, tableSpec.node, tableSpec.nodeYaw);
      const spec = fittedSpec(tableSpec, built);
      if (spec.round && spec.muzzle) await loadRound(built.root, spec, spec.round);
      if (spec.emitter) {
        const lens = new Group(); lens.name = 'weapon-emitter';
        lens.position.set(...spec.emitter).multiplyScalar(1 / BB_UNITS_PER_METER);
        const direction = new Group(); direction.name = 'weapon-light-direction';
        direction.position.copy(lens.position).add(new Vector3(...spec.barrel));
        built.root.add(lens, direction);
      }
      ownedRoots.push(built.root);
      lib.set(itemId, heldWeaponVisual(itemId, spec, built, character));
    }),
  );
  const failure = results.find((r) => r.status === 'rejected');
  if (failure?.status === 'rejected') {
    const resources = new ResourceDisposer();
    for (const root of ownedRoots) resources.object(root);
    throw failure.reason;
  }
  // The bundle is an inventory display only; the player always holds the clacker.
  const c4 = lib.get('c4'), remote = lib.get('c4_detonator');
  if (c4 && remote) {
    c4.object = remote.object;
    c4.attach = remote.attach;
    c4.clips = remote.clips;
  }
  return lib;
}

/** A loaded weapon model fitted to the character's hand (and its display / first-person data). */
export function heldWeaponVisual(itemId: string, spec: WeaponSpec, built: CharacterTemplate, character: CharacterTemplate): WeaponVisual {
  const stance = ITEMS[itemId]?.stance ?? 'rifle';
  const local = (p?: Vec3) => (p ? new Vector3(...p).multiplyScalar(1 / BB_UNITS_PER_METER) : null);
  const display = displayModel(spec, built.root);
  const heldAxes = spec.edge ? {
    axis: new Vector3(...spec.barrel).normalize(), edge: new Vector3(...spec.edge),
    grip: local(spec.grip)!, tip: local(spec.strikePoint ?? spec.grip)!,
    ...(itemId === 'fire_axe' || itemId === 'pickaxe' ? { swingOffset: Math.PI } : {}),
    idleDown: itemId === 'fire_axe' || itemId === 'pickaxe' || itemId === 'long_sledgehammer',
  } : null;
  const displayTransform = display.children[0]!.matrix;
  return {
    itemId,
    object: built.root,
    attach: fitToHand(character, spec, stance, built.root),
    ...(spec.muzzle ? { heldScale: heldGunScale(character) } : {}),
    ...(ITEMS[itemId]?.category === 'tool' ? { offhandAttach: fitToHand(character, spec, stance, built.root, 'left') } : {}),
    ...(ITEMS[itemId]?.category === 'tool' && character.root.getObjectByName('arm_left') ? { offhandArm: character.root.getObjectByName('arm_left')! } : {}),
    ...(spec.muzzle ? { aim: { barrel: new Vector3(...spec.barrel), up: new Vector3(...spec.up), grip: local(spec.grip)! } } : {}),
    ...(spec.support ? { twoHandGrip: { grip: local(spec.grip)!, support: local(spec.support)!, up: new Vector3(...spec.up), triggerHand: spec.patrolTriggerHand ?? 'right' } } : {}),
    ...(heldAxes ? { melee: { held: heldAxes, display: {
      axis: heldAxes.axis.clone().transformDirection(displayTransform),
      edge: heldAxes.edge.clone().transformDirection(displayTransform),
      grip: heldAxes.grip.clone().applyMatrix4(displayTransform),
      tip: heldAxes.tip.clone().applyMatrix4(displayTransform),
      swingOffset: heldAxes.swingOffset,
      idleDown: heldAxes.idleDown,
    } } } : {}),
    display,
    ...firstPersonArms(character, itemId, spec, displayTransform),
    clips: built.clips,
    reloadClip: spec.reloadClip && built.clips.has(spec.reloadClip) ? spec.reloadClip : null,
    muzzle: local(spec.muzzle),
    eject: local(spec.eject),
    spec,
    sight: spec.sight ? { rear: local(spec.sight.rear)!.applyMatrix4(displayTransform), front: local(spec.sight.front)!.applyMatrix4(displayTransform) } : null,
  };
}
