import { untexturedGlb } from './test-glb';
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { AnimationMixer, Vector3, type Object3D } from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { EntityFlags as F } from '@zion/shared';
import { Avatar } from './avatars';
import { buildBBModel, mirrorCharacter, survivorTemplate, type CharacterTemplate, type RawModel } from './character-model';
import { parseHumanAssets } from './human-rig';
import { buildMixamoMotion } from './mixamo-body';
import { builtinWeaponVisual, fittedSpec, heldWeaponVisual, type WeaponLibrary } from './weapons';

/**
 * Third-person guns with the real AK and Glock models: the gun stays in the hand on every
 * skeleton, and changes of stance (spawning, raising a pistol, reloading, landing a jump) move
 * it smoothly instead of jumping between poses from one frame to the next.
 */
const root = '../../../../../';
let survivor: CharacterTemplate;
let mixamo: CharacterTemplate;
const lib: WeaponLibrary = new Map();

beforeAll(async () => {
  const glb = await readFile(new URL(`${root}models/characters/zion-survivor.glb`, import.meta.url));
  const assets = await parseHumanAssets(untexturedGlb(glb));
  const raw = JSON.parse(await readFile(new URL(`${root}models/characters/teen-wasteland-survivor.bbmodel`, import.meta.url), 'utf8')) as RawModel;
  raw.textures = [];
  survivor = survivorTemplate(mirrorCharacter(await buildBBModel(raw)), assets);
  const fbx = await readFile(new URL('../../../public/models/characters/mocap/walking.fbx', import.meta.url));
  const src = new FBXLoader().parse(fbx.buffer.slice(fbx.byteOffset, fbx.byteOffset + fbx.byteLength), '');
  const mixer = new AnimationMixer(src);
  mixer.clipAction(src.animations[0]!).play();
  mixamo = { ...survivor, mixamo: buildMixamoMotion(assets, src, src.animations[0]!, mixer) };
  for (const [id, file] of [['ak47', 'ak47-rifle'], ['gl18', 'glock-18'], ['katana', 'katana']] as const) {
    const wraw = JSON.parse(await readFile(new URL(`${root}models/weapons/${file}.bbmodel`, import.meta.url), 'utf8')) as RawModel;
    wraw.textures = [];
    const built = await buildBBModel(wraw);
    lib.set(id, heldWeaponVisual(id, fittedSpec(builtinWeaponVisual(id)!, built), built, survivor));
  }
}, 60_000);

/** Runs an avatar through steps of [seconds, flags, forward m/s, event]; reports the gun's grip and the right palm each frame. */
function run(template: CharacterTemplate, weapon: 'ak47' | 'gl18', steps: Array<[number, number, number, string?]>) {
  const a = new Avatar(template, true);
  a.setStance(weapon === 'ak47' ? 'rifle' : 'pistol');
  a.setWeapon(weapon, lib);
  const v = lib.get(weapon)!, out: Array<{ t: number; grip: Vector3; palm: Vector3 }> = [];
  const S = template.mixamo ? (n: string) => `mixamo_Right${n === 'hand' ? 'Hand' : 'HandMiddle1'}` : (n: string) => (n === 'hand' ? 'hand_R' : 'f_middle_01_R');
  let z = 0, t = 0;
  for (const [secs, flags, fwd, ev] of steps) {
    if (ev === 'reload') a.startReload(2.2);
    for (let i = 0; i < Math.round(secs * 60); i++) {
      const dt = 1 / 60;
      t += dt; z -= fwd * dt;
      const y = ev === 'jump' ? Math.max(0, 3 * i * dt - 5 * (i * dt) ** 2) : 0;
      a.update(0, y, z, 0, flags, dt, t);
      a.root.updateMatrixWorld(true);
      const held = (a as unknown as { weaponObjects: Map<string, { obj: Object3D }> }).weaponObjects.values().next().value!.obj;
      const at = (n: string) => a.root.getObjectByName(n)!.getWorldPosition(new Vector3());
      const here = new Vector3(0, y, z);
      out.push({ t, grip: v.aim!.grip.clone().applyMatrix4(held.matrixWorld).sub(here), palm: at(S('finger')).lerp(at(S('hand')), .3).sub(here) });
    }
  }
  return out;
}

/** The largest sudden change of the grip's velocity (second difference, m per frame²) in a time window. */
function jerk(frames: Array<{ t: number; grip: Vector3 }>, from: number, to: number): number {
  let max = 0;
  for (let i = 2; i < frames.length; i++) {
    if (frames[i]!.t < from || frames[i]!.t > to) continue;
    max = Math.max(max, frames[i]!.grip.clone().sub(frames[i - 1]!.grip.clone().multiplyScalar(2)).add(frames[i - 2]!.grip).length());
  }
  return max;
}

const G = F.Grounded;

describe('guns in third person', () => {
  it.each(['ak47', 'gl18'] as const)('the Mixamo skeleton keeps the %s in its hand while walking, aiming and running', (weapon) => {
    const frames = run(mixamo, weapon, [[2.5, G, 0], [1.5, G, 1.4], [1, G | F.Aiming, 1.4], [1, G, 2.5]]);
    for (const f of frames.slice(150)) expect(f.palm.distanceTo(f.grip)).toBeLessThan(.06);
  });

  it('starts a drawn pistol in its recording (no jump once the body has faded in)', () => {
    expect(jerk(run(survivor, 'gl18', [[2, G, 0]]), .1, 2)).toBeLessThan(.06);
  });

  it('raises a pistol from the high hold onto the aim without bending the body double', () => {
    const frames = run(survivor, 'gl18', [[2.5, G, 0], [1, G | F.Aiming, 0]]);
    const lowest = Math.min(...frames.filter((f) => f.t > 2.5).map((f) => f.grip.y));
    // Through the raise the gun stays above the belt; it ends at eye level.
    // (Heights for the real-size survivor, eyes at 1.62 m.)
    expect(lowest).toBeGreaterThan(.88);
    expect(frames.at(-1)!.grip.y).toBeGreaterThan(1.16);
  });

  it('fades between posing methods: a pistol reload starts without a jump', () => {
    expect(jerk(run(survivor, 'gl18', [[2.5, G, 0], [1, G, 0, 'reload']]), 2.5, 3.5)).toBeLessThan(.06);
  });

  it('lands a jump without dropping the gun into the landing crouch in one frame', () => {
    const frames = run(survivor, 'ak47', [[2.5, G, 0], [.6, 0, 2, 'jump'], [1, G, 0]]);
    // (Touching down itself is a sharp stop; it used to be a 0.6 m jump of the hips.)
    expect(jerk(frames, 3.05, 3.4)).toBeLessThan(.2);
  });

  it('a rifle starting to walk turns the trunk over a few frames, not at the crossfade halfway', () => {
    expect(jerk(run(survivor, 'ak47', [[2.5, G, 0], [1, G, 1.4]]), 2.5, 3.5)).toBeLessThan(.06);
  });

  it('returns from blade swings to standing smoothly, feet included, and finishes a standing turn without a snap', () => {
    const a = new Avatar(survivor, true);
    a.setStance('melee'); a.setWeapon('katana', lib);
    let t = 0, yaw = 0, worst = 0;
    const hist: Record<string, Vector3[]> = {};
    const frame = (measure: boolean) => {
      t += 1 / 60;
      a.update(0, 0, 0, yaw, G, 1 / 60, t);
      a.root.updateMatrixWorld(true);
      for (const n of ['foot_L', 'foot_R', 'hand_R', 'hand_L']) {
        const h = (hist[n] ??= []), p = a.root.getObjectByName(n)!.getWorldPosition(new Vector3());
        h.push(p);
        if (measure && h.length > 2 && n.startsWith('foot')) worst = Math.max(worst, p.clone().sub(h.at(-2)!.clone().multiplyScalar(2)).add(h.at(-3)!).length());
      }
    };
    for (let i = 0; i < 150; i++) frame(false);
    // Three combo steps, each ending back in the stand (a foot used to hang in the air, then drop).
    for (let s = 0; s < 3; s++) { a.slash(); for (let i = 0; i < 70; i++) frame(true); }
    for (let i = 0; i < 60; i++) frame(true);
    // The view swings 70° and stops: the feet step round, then settle.
    for (let i = 0; i < 20; i++) { yaw += 1.2 / 20; frame(true); }
    for (let i = 0; i < 120; i++) frame(true);
    expect(worst).toBeLessThan(.12);
    expect(a.root.getObjectByName('foot_L')!.getWorldPosition(new Vector3()).y).toBeLessThan(.25);
  });
});
