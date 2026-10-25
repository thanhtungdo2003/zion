import { ITEMS, WEAPON_BY_ITEM, weaponSpec } from '@zion/shared';

/**
 * How each kind of gun is reloaded: when each part moves (the model's own clips, by name), when it
 * is heard, and where the hands go. Times are shares of the reload (0…1), so a script fits any
 * reload length; a tube loaded shell by shell runs its script once per shell.
 */
export type ReloadKind = 'mag' | 'pistol' | 'bolt' | 'bolt-mag' | 'shell' | 'break' | 'm79' | 'drum' | 'revolver' | 'belt' | 'rocket' | 'crossbow';

/** Part sounds (public/sounds/parts). */
export const PART_SOUNDS = {
  partBarrelsOpen: '/sounds/parts/barrels-open.mp3',
  partBarrelsClose: '/sounds/parts/barrels-close.mp3',
  partRoundInsert: '/sounds/parts/round-40mm-insert.mp3',
  partCylinderSpin: '/sounds/parts/cylinder-spin.mp3',
  partMagOut: '/sounds/parts/mag-out.mp3',
  partMagIn: '/sounds/parts/mag-in.mp3',
  partMagSlap: '/sounds/parts/mag-slap.mp3',
  partButton: '/sounds/parts/button-press.mp3',
  partChargeBack: '/sounds/parts/charge-back.mp3',
  partBoltCarriage: '/sounds/parts/bolt-carriage.mp3',
  partGunAim: '/sounds/parts/gun-aim.mp3',
  partSlideRack: '/sounds/parts/slide-rack.mp3',
  partShellInsert: '/sounds/parts/shell-insert.mp3',
  partActionRelease: '/sounds/parts/action-release.mp3',
  partReloadGeneric: '/sounds/parts/reload-generic.mp3',
  partDryFire: '/sounds/parts/dry-fire.wav',
  partSelector: '/sounds/parts/selector.wav',
  partBoltUp: '/sounds/parts/bolt-up.wav',
  partBoltDown: '/sounds/parts/bolt-down.wav',
  partBoltForward: '/sounds/parts/bolt-forward.wav',
  partChargeRelease: '/sounds/parts/charge-release.wav',
  partSlideRelease: '/sounds/parts/slide-release.wav',
  partHammerCock: '/sounds/parts/hammer-cock.wav',
  partCylinderOpen: '/sounds/parts/cylinder-open.wav',
  partCylinderClose: '/sounds/parts/cylinder-close.wav',
  partEjectShells: '/sounds/parts/eject-shells.wav',
  partCasingDrop: '/sounds/parts/casing-drop.wav',
  partShellDrop: '/sounds/parts/shell-drop.wav',
  partFeedOpen: '/sounds/parts/feed-cover-open.wav',
  partFeedClose: '/sounds/parts/feed-cover-close.wav',
  partBeltLay: '/sounds/parts/belt-lay.wav',
  partPinPull: '/sounds/parts/pin-pull.wav',
  partSpoon: '/sounds/parts/spoon-release.wav',
  partDetonator: '/sounds/parts/detonator-click.wav',
} as const;
export type PartSound = keyof typeof PART_SOUNDS;

/** Where a hand goes: a part of the gun (followed while it moves), or a place by the body. */
export type HandTarget = 'guard' | 'mag' | 'magwell' | 'pouch' | 'charge' | 'bolt' | 'slide' | 'pump' | 'breech' | 'cylinder' | 'port' | 'feed' | 'muzzle';
export type HandShape = 'ready' | 'fist' | 'pinch' | 'open';

export interface ReloadSound { at: number; sound: PartSound; rate?: number; volume?: number }
/**
 * A model clip (first name the model has) over [at, until]: played forward over `open`, held,
 * then played backwards over `close` (a breech opened, then shut).
 */
export interface ReloadClip {
  clips: readonly string[]; at: number; until: number; open: number; close?: number;
  /** Swapped while out (a magazine): the moved part is not seen between going out and coming back. */
  swap?: boolean;
}
export interface ReloadHandKey { at: number; side: 'L' | 'R'; target: HandTarget; shape: HandShape }
export interface ReloadScript { sounds: readonly ReloadSound[]; clips: readonly ReloadClip[]; hands: readonly ReloadHandKey[] }

const MAG_CLIP = ['magazine.release', 'ammo-box.release'];
const CHARGE_CLIP = ['charging-handle.rack', 'cocking-handle.rack', 'bolt.rack', 'bolt-carriage.rack'];

export const RELOAD_SCRIPTS: Record<ReloadKind, ReloadScript> = {
  // Box magazine: release button, mag out, a fresh one from the pouch, in, a slap, then the charging handle.
  mag: {
    sounds: [{ at: .06, sound: 'partButton', volume: .5 }, { at: .1, sound: 'partMagOut' }, { at: .52, sound: 'partMagIn' }, { at: .6, sound: 'partMagSlap', volume: .7 }, { at: .76, sound: 'partChargeBack' }, { at: .9, sound: 'partChargeRelease', volume: .8 }],
    clips: [{ clips: MAG_CLIP, at: .08, until: .62, open: .1, close: .08, swap: true }, { clips: CHARGE_CLIP, at: .76, until: .94, open: .1, close: .06 }],
    hands: [{ at: 0, side: 'L', target: 'guard', shape: 'ready' }, { at: .08, side: 'L', target: 'mag', shape: 'fist' }, { at: .2, side: 'L', target: 'mag', shape: 'fist' }, { at: .32, side: 'L', target: 'pouch', shape: 'fist' },
      { at: .4, side: 'L', target: 'pouch', shape: 'fist' }, { at: .52, side: 'L', target: 'mag', shape: 'fist' }, { at: .6, side: 'L', target: 'magwell', shape: 'open' },
      { at: .72, side: 'L', target: 'charge', shape: 'pinch' }, { at: .86, side: 'L', target: 'charge', shape: 'pinch' }, { at: 1, side: 'L', target: 'guard', shape: 'ready' }],
  },
  // Pistol: mag out, a new one in, the slide racked.
  pistol: {
    sounds: [{ at: .06, sound: 'partButton', volume: .5 }, { at: .1, sound: 'partMagOut' }, { at: .48, sound: 'partMagIn' }, { at: .55, sound: 'partMagSlap', volume: .6 }, { at: .72, sound: 'partSlideRack' }, { at: .86, sound: 'partSlideRelease', volume: .7 }],
    clips: [{ clips: MAG_CLIP, at: .08, until: .56, open: .1, close: .08, swap: true }],
    hands: [{ at: 0, side: 'L', target: 'guard', shape: 'ready' }, { at: .1, side: 'L', target: 'mag', shape: 'fist' }, { at: .26, side: 'L', target: 'pouch', shape: 'fist' }, { at: .36, side: 'L', target: 'pouch', shape: 'fist' },
      { at: .48, side: 'L', target: 'mag', shape: 'fist' }, { at: .56, side: 'L', target: 'magwell', shape: 'open' }, { at: .7, side: 'L', target: 'slide', shape: 'pinch' }, { at: .84, side: 'L', target: 'slide', shape: 'pinch' }, { at: 1, side: 'L', target: 'guard', shape: 'ready' }],
  },
  // Bolt action with stripper clip: the right hand works the bolt, the left feeds the rounds.
  bolt: {
    sounds: [{ at: .06, sound: 'partBoltUp' }, { at: .14, sound: 'partBoltCarriage' }, { at: .22, sound: 'partCasingDrop', volume: .5 }, { at: .36, sound: 'partShellInsert', rate: 1.3 }, { at: .48, sound: 'partShellInsert', rate: 1.25 }, { at: .6, sound: 'partShellInsert', rate: 1.3 },
      { at: .78, sound: 'partBoltForward' }, { at: .88, sound: 'partBoltDown' }],
    clips: [{ clips: ['bolt-handle.lift'], at: .04, until: .92, open: .06, close: .06 }, { clips: ['bolt.rack', 'bolt-carriage.rack'], at: .12, until: .84, open: .08, close: .08 }],
    hands: [{ at: 0, side: 'R', target: 'bolt', shape: 'pinch' }, { at: .3, side: 'L', target: 'pouch', shape: 'pinch' }, { at: .38, side: 'L', target: 'port', shape: 'pinch' }, { at: .62, side: 'L', target: 'port', shape: 'pinch' },
      { at: .74, side: 'L', target: 'guard', shape: 'ready' }, { at: .92, side: 'R', target: 'bolt', shape: 'pinch' }],
  },
  // Bolt action with a box magazine (AWM).
  'bolt-mag': {
    sounds: [{ at: .05, sound: 'partBoltUp' }, { at: .12, sound: 'partBoltCarriage' }, { at: .2, sound: 'partCasingDrop', volume: .5 }, { at: .28, sound: 'partMagOut' }, { at: .58, sound: 'partMagIn' }, { at: .64, sound: 'partMagSlap', volume: .6 },
      { at: .8, sound: 'partBoltForward' }, { at: .9, sound: 'partBoltDown' }],
    clips: [{ clips: ['bolt-handle.lift'], at: .03, until: .94, open: .05, close: .05 }, { clips: ['bolt-carriage.rack', 'bolt.rack'], at: .1, until: .86, open: .07, close: .07 }, { clips: MAG_CLIP, at: .26, until: .64, open: .08, close: .06, swap: true }],
    hands: [{ at: 0, side: 'R', target: 'bolt', shape: 'pinch' }, { at: .26, side: 'L', target: 'mag', shape: 'fist' }, { at: .38, side: 'L', target: 'pouch', shape: 'fist' }, { at: .5, side: 'L', target: 'magwell', shape: 'fist' }, { at: .64, side: 'L', target: 'magwell', shape: 'open' },
      { at: .74, side: 'L', target: 'guard', shape: 'ready' }, { at: .94, side: 'R', target: 'bolt', shape: 'pinch' }],
  },
  // Pump shotgun, one shell per run (the script runs once per shell).
  shell: {
    sounds: [{ at: .55, sound: 'partShellInsert' }],
    clips: [],
    hands: [{ at: 0, side: 'L', target: 'guard', shape: 'ready' }, { at: .22, side: 'L', target: 'pouch', shape: 'pinch' }, { at: .45, side: 'L', target: 'port', shape: 'pinch' }, { at: .62, side: 'L', target: 'port', shape: 'open' }, { at: 1, side: 'L', target: 'guard', shape: 'ready' }],
  },
  // Break-open double barrel: lever, barrels down, empties out, two shells, shut.
  break: {
    sounds: [{ at: .06, sound: 'partButton', volume: .6 }, { at: .1, sound: 'partBarrelsOpen' }, { at: .22, sound: 'partShellDrop' }, { at: .44, sound: 'partShellInsert' }, { at: .6, sound: 'partShellInsert', rate: 1.05 }, { at: .84, sound: 'partBarrelsClose' }],
    clips: [{ clips: ['top-lever.swing'], at: .05, until: .9, open: .05, close: .04 }, { clips: ['barrels.open', 'barrel.open'], at: .1, until: .9, open: .1, close: .08 }],
    hands: [{ at: 0, side: 'L', target: 'guard', shape: 'ready' }, { at: .1, side: 'L', target: 'breech', shape: 'fist' }, { at: .3, side: 'L', target: 'pouch', shape: 'pinch' }, { at: .44, side: 'L', target: 'breech', shape: 'pinch' },
      { at: .52, side: 'L', target: 'pouch', shape: 'pinch' }, { at: .6, side: 'L', target: 'breech', shape: 'pinch' }, { at: .78, side: 'L', target: 'guard', shape: 'fist' }, { at: 1, side: 'L', target: 'guard', shape: 'ready' }],
  },
  // M79: latch, barrel down, round in, shut.
  m79: {
    sounds: [{ at: .06, sound: 'partButton', volume: .6 }, { at: .12, sound: 'partBarrelsOpen', rate: .9 }, { at: .26, sound: 'partShellDrop', rate: .8 }, { at: .56, sound: 'partRoundInsert' }, { at: .84, sound: 'partBarrelsClose', rate: .9 }],
    clips: [{ clips: ['barrel-latch.swing'], at: .05, until: .9, open: .05, close: .04 }, { clips: ['barrel.open', 'barrels.open'], at: .12, until: .9, open: .1, close: .08 }],
    hands: [{ at: 0, side: 'L', target: 'guard', shape: 'ready' }, { at: .12, side: 'L', target: 'breech', shape: 'fist' }, { at: .34, side: 'L', target: 'pouch', shape: 'fist' }, { at: .54, side: 'L', target: 'breech', shape: 'fist' }, { at: .78, side: 'L', target: 'guard', shape: 'fist' }, { at: 1, side: 'L', target: 'guard', shape: 'ready' }],
  },
  // Six-shot launcher: the cylinder turned, rounds pushed in, wound back.
  drum: {
    sounds: [{ at: .06, sound: 'partCylinderOpen' }, { at: .26, sound: 'partRoundInsert' }, { at: .44, sound: 'partRoundInsert', rate: 1.05 }, { at: .62, sound: 'partRoundInsert', rate: .95 }, { at: .8, sound: 'partCylinderSpin', volume: .6, rate: 1.6 }, { at: .92, sound: 'partCylinderClose' }],
    clips: [{ clips: ['cylinder.spin'], at: .78, until: .9, open: .12 }],
    hands: [{ at: 0, side: 'L', target: 'guard', shape: 'ready' }, { at: .14, side: 'L', target: 'pouch', shape: 'fist' }, { at: .24, side: 'L', target: 'cylinder', shape: 'fist' }, { at: .34, side: 'L', target: 'pouch', shape: 'fist' }, { at: .44, side: 'L', target: 'cylinder', shape: 'fist' },
      { at: .52, side: 'L', target: 'pouch', shape: 'fist' }, { at: .62, side: 'L', target: 'cylinder', shape: 'fist' }, { at: .78, side: 'L', target: 'cylinder', shape: 'open' }, { at: 1, side: 'L', target: 'guard', shape: 'ready' }],
  },
  // Revolver: cylinder out, empties knocked out, rounds in, cylinder snapped shut.
  revolver: {
    sounds: [{ at: .05, sound: 'partButton', volume: .5 }, { at: .1, sound: 'partCylinderOpen' }, { at: .22, sound: 'partEjectShells' }, { at: .46, sound: 'partShellInsert', rate: 1.4, volume: .7 }, { at: .58, sound: 'partShellInsert', rate: 1.35, volume: .7 },
      { at: .74, sound: 'partCylinderSpin', volume: .4, rate: 2 }, { at: .86, sound: 'partCylinderClose' }],
    clips: [{ clips: ['cylinder.spin'], at: .72, until: .82, open: .1 }],
    hands: [{ at: 0, side: 'L', target: 'guard', shape: 'ready' }, { at: .1, side: 'L', target: 'cylinder', shape: 'pinch' }, { at: .22, side: 'L', target: 'cylinder', shape: 'open' }, { at: .34, side: 'L', target: 'pouch', shape: 'pinch' },
      { at: .46, side: 'L', target: 'cylinder', shape: 'pinch' }, { at: .52, side: 'L', target: 'pouch', shape: 'pinch' }, { at: .58, side: 'L', target: 'cylinder', shape: 'pinch' }, { at: .84, side: 'L', target: 'cylinder', shape: 'fist' }, { at: 1, side: 'L', target: 'guard', shape: 'ready' }],
  },
  // Belt-fed machine gun: cover up, box out, new box, belt laid, cover down, charged.
  belt: {
    sounds: [{ at: .05, sound: 'partFeedOpen' }, { at: .16, sound: 'partMagOut' }, { at: .42, sound: 'partMagIn' }, { at: .52, sound: 'partBeltLay' }, { at: .66, sound: 'partFeedClose' }, { at: .8, sound: 'partChargeBack' }, { at: .92, sound: 'partChargeRelease' }],
    clips: [{ clips: ['feed-cover.open'], at: .04, until: .7, open: .08, close: .05 }, { clips: MAG_CLIP, at: .14, until: .46, open: .08, close: .06, swap: true }, { clips: CHARGE_CLIP, at: .78, until: .96, open: .1, close: .06 }],
    hands: [{ at: 0, side: 'L', target: 'feed', shape: 'pinch' }, { at: .14, side: 'L', target: 'mag', shape: 'fist' }, { at: .28, side: 'L', target: 'pouch', shape: 'fist' }, { at: .42, side: 'L', target: 'magwell', shape: 'fist' },
      { at: .52, side: 'L', target: 'feed', shape: 'pinch' }, { at: .66, side: 'L', target: 'feed', shape: 'open' }, { at: .78, side: 'L', target: 'charge', shape: 'fist' }, { at: .92, side: 'L', target: 'charge', shape: 'fist' }, { at: 1, side: 'L', target: 'guard', shape: 'ready' }],
  },
  // Rocket launcher: a rocket pushed into the muzzle, the hammer cocked.
  rocket: {
    sounds: [{ at: .38, sound: 'partRoundInsert', rate: .75 }, { at: .5, sound: 'partMagIn', rate: .7 }, { at: .82, sound: 'partHammerCock' }],
    clips: [{ clips: ['hammer.cock'], at: .8, until: .9, open: .1 }],
    hands: [{ at: 0, side: 'L', target: 'guard', shape: 'ready' }, { at: .16, side: 'L', target: 'pouch', shape: 'fist' }, { at: .38, side: 'L', target: 'muzzle', shape: 'fist' }, { at: .52, side: 'L', target: 'muzzle', shape: 'open' }, { at: .78, side: 'L', target: 'breech', shape: 'pinch' }, { at: 1, side: 'L', target: 'guard', shape: 'ready' }],
  },
  // Crossbow: the string drawn back, a bolt laid on.
  crossbow: {
    sounds: [{ at: .12, sound: 'partChargeBack', rate: .75 }, { at: .42, sound: 'partBoltForward', volume: .5, rate: 1.4 }, { at: .68, sound: 'partShellInsert', rate: .85 }],
    clips: [],
    hands: [{ at: 0, side: 'L', target: 'guard', shape: 'ready' }, { at: .1, side: 'L', target: 'port', shape: 'fist' }, { at: .4, side: 'L', target: 'port', shape: 'fist' }, { at: .52, side: 'L', target: 'pouch', shape: 'pinch' }, { at: .68, side: 'L', target: 'port', shape: 'pinch' }, { at: 1, side: 'L', target: 'guard', shape: 'ready' }],
  },
};

const BY_ITEM: Record<string, ReloadKind> = {
  deagle: 'pistol', gl18: 'pistol', kar98k: 'bolt', remington700: 'bolt', awm: 'bolt-mag', shotgun: 'shell', double_barrel: 'break', m79: 'm79',
  grenade_launcher: 'drum', revolver: 'revolver', pkm: 'belt', rocket_launcher: 'rocket', crossbow: 'crossbow',
};

/** The reload of a gun (by item): its own kind, else by category (custom guns too); null for none (flamethrower). */
export function reloadKindOf(itemId: string | null | undefined): ReloadKind | null {
  if (!itemId) return null;
  const own = BY_ITEM[itemId];
  if (own) return own;
  const spec = weaponSpec(WEAPON_BY_ITEM[itemId] ?? 0);
  if (spec?.kind !== 'gun' || spec.fire === 'flame') return null;
  if (spec.shellReload) return 'shell';
  const category = ITEMS[itemId]?.category;
  return category === 'pistol' ? 'pistol' : 'mag';
}

export function reloadScriptOf(itemId: string | null | undefined): ReloadScript | null {
  const kind = reloadKindOf(itemId);
  return kind ? RELOAD_SCRIPTS[kind] : null;
}
