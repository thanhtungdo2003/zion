import { untexturedGlb } from './test-glb';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { BoxGeometry, Frustum, Group, Matrix4, Mesh, PerspectiveCamera, Quaternion, Scene, Vector3 } from 'three';
import { DEFAULT_APPEARANCE, EntityFlags, randomAppearance } from '@zion/shared';
import { Avatar } from './avatars';
import { BB_UNITS_PER_METER, buildBBModel, mirrorCharacter, survivorTemplate, type CharacterTemplate, type RawModel } from './character-model';
import { HumanBody, SURVIVOR_SIZE, parseHumanAssets, type HumanAssets } from './human-rig';
import { builtinWeaponVisual, fittedSpec, fitToHand, standaloneVisual, type WeaponLibrary, type WeaponVisual } from './weapons';
import { rifleStockContact } from './grip-profile';
import { FirstPersonHands } from './fp-hands';
import { ViewModel } from './viewmodel';
import type { MocapPose } from './human-rig';

let assets: HumanAssets;
let template: CharacterTemplate;

beforeAll(async () => {
  const glb = await readFile(new URL('../../../../../models/characters/zion-survivor.glb', import.meta.url));
  assets = await parseHumanAssets(untexturedGlb(glb));
  const raw = JSON.parse(await readFile(new URL('../../../../../models/characters/teen-wasteland-survivor.bbmodel', import.meta.url), 'utf8')) as RawModel;
  raw.textures = [];
  template = survivorTemplate(mirrorCharacter(await buildBBModel(raw)), assets);
});

const bone = (avatar: Avatar, name: string) => {
  avatar.root.updateMatrixWorld();
  return avatar.root.getObjectByName(name)!.getWorldPosition(new Vector3());
};

function stand(avatar: Avatar, frames = 30, flags = EntityFlags.Grounded): void {
  for (let i = 0; i < frames; i++) { avatar.update(0, 0, 0, 0, flags, 1 / 30, i / 30); avatar.root.updateMatrixWorld(); }
}

/** A rifle facing forward with a grip and a handguard, as `loadWeapons` builds one. */
function rifle(): WeaponLibrary {
  const object = new Group();
  object.add(new Mesh(new BoxGeometry(.05, .08, .8)));
  const visual: WeaponVisual = {
    itemId: 'ak47', object, display: new Group(), attach: new Matrix4().makeRotationX(-Math.PI / 2), clips: new Map(), reloadClip: null,
    muzzle: new Vector3(0, 0, -.55), eject: new Vector3(.02, .03, -.05), heldScale: 1.05,
    aim: { barrel: new Vector3(0, 0, -1), up: new Vector3(0, 1, 0), grip: new Vector3(0, -.08, .05) },
    twoHandGrip: { grip: new Vector3(0, -.08, .05), support: new Vector3(0, -.03, -.3), up: new Vector3(0, 1, 0), triggerHand: 'right' },
  };
  return new Map([['ak47', visual]]);
}

async function realRifle(): Promise<WeaponVisual> {
  const raw = JSON.parse(await readFile(new URL('../../../../../models/weapons/ak47-rifle.bbmodel', import.meta.url), 'utf8')) as RawModel;
  raw.textures = [];
  const model = await buildBBModel(raw), spec = fittedSpec(builtinWeaponVisual('ak47')!, model);
  const grip = new Vector3(...spec.grip).multiplyScalar(1 / BB_UNITS_PER_METER);
  return { ...standaloneVisual('ak47', spec, model.root, template), attach: fitToHand(template, spec, 'rifle', model.root),
    aim: { barrel: new Vector3(...spec.barrel), up: new Vector3(...spec.up), grip },
    twoHandGrip: { grip, support: new Vector3(...spec.support!).multiplyScalar(1 / BB_UNITS_PER_METER), up: new Vector3(...spec.up) },
  };
}

describe('survivor model', () => {
  it('loads baked cloth weights and coverage matching surface preparation without changing animation clips', async () => {
    const glb = await readFile(new URL('../../../../../models/characters/zion-survivor.glb', import.meta.url));
    const rebuilt = await parseHumanAssets(untexturedGlb(glb), { rebuildSkin: true });
    for (const kind of ['bare', 'top'] as const) {
      expect(Array.from(assets.bodies[kind].getIndex()!.array)).toEqual(Array.from(rebuilt.bodies[kind].getIndex()!.array));
      expect(assets.bodies[kind].getAttribute('position')).toBe(assets.parts.get('body')!.geometry.getAttribute('position'));
    }
    const baked = assets.parts.get('top')!.geometry.getAttribute('skinWeight');
    const expected = rebuilt.parts.get('top')!.geometry.getAttribute('skinWeight');
    for (let i = 0; i < baked.count; i++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += baked.getComponent(i, k);
        expect(Math.abs(baked.getComponent(i, k) - expected.getComponent(i, k))).toBeLessThanOrEqual(2 / 255);
      }
      expect(sum).toBeCloseTo(1, 6);
    }
    expect([...assets.clips.keys()]).toEqual([...rebuilt.clips.keys()]);
  });

  it('corrects real rifle contacts without winding the support upper arm around its shoulder', async () => {
    const avatar = new Avatar(template, true), visual = await realRifle();
    avatar.setStance('rifle'); avatar.setWeapon('ak47', new Map([['ak47', visual]]));
    // Only the support-hand IK is measured: the chest turning the whole arm onto the aim is a
    // rigid rotation, not a contact correction.
    const runtime = (avatar as unknown as { human: { placeHand: (...args: unknown[]) => void } }).human;
    const attach = runtime.placeHand.bind(runtime);
    let corrections = 0, maxRoll = 0;
    runtime.placeHand = (...args) => {
      const upper = avatar.root.getObjectByName('upper_arm_L')!, elbow = avatar.root.getObjectByName('forearm_L')!;
      const shoulder = upper.getWorldPosition(new Vector3());
      const beforeDirection = elbow.getWorldPosition(new Vector3()).sub(shoulder).normalize();
      const beforeRotation = upper.getWorldQuaternion(new Quaternion());
      attach(...args);
      const afterDirection = elbow.getWorldPosition(new Vector3()).sub(shoulder).normalize();
      const transported = new Quaternion().setFromUnitVectors(beforeDirection, afterDirection).multiply(beforeRotation);
      maxRoll = Math.max(maxRoll, transported.angleTo(upper.getWorldQuaternion(new Quaternion())));
      corrections++;
    };
    let z = 0;
    for (const flags of [0, EntityFlags.Aiming, EntityFlags.Sprinting, EntityFlags.Attacking]) {
      for (let frame = 0; frame < 180; frame++) {
        if (flags & EntityFlags.Sprinting) z -= .09;
        avatar.update(0, 0, z, Math.sin(frame / 60) * .25, EntityFlags.Grounded | flags, 1 / 60, frame / 60);
        avatar.root.updateMatrixWorld(true);
      }
    }
    expect(corrections).toBeGreaterThan(600);
    // A contact correction can swing the upper arm, but adding a half-turn of axial
    // roll crushes the skin blended between the shoulder and upper-arm joints.
    expect(maxRoll).toBeLessThan(.12);
  });
  it('lowers the gun for running, fires at chest height and raises it only for ADS', () => {
    const avatar = new Avatar(template, true);
    avatar.setStance('rifle'); avatar.setWeapon('ak47', rifle());
    stand(avatar, 90);
    // The bore line's height against the eyes: well below them at the ready, up to them in ADS.
    const sightGap = () => { const o = new Vector3(), d = new Vector3(); avatar.weaponBore(o, d); return bone(avatar, 'spine_006').y + .1 - o.y; };
    const readyGap = sightGap();
    const direction = () => { const d = new Vector3(); avatar.weaponBore(new Vector3(), d); return d; };
    let z = 0;
    for (let i = 0; i < 120; i++) {
      z -= .08;
      avatar.update(0, 0, z, 0, EntityFlags.Grounded | EntityFlags.Sprinting, 1 / 60, i / 60);
      avatar.root.updateMatrixWorld(true);
    }
    // The recorded low carry (Rifle Idle) points the muzzle about 20° down.
    expect(direction().y).toBeLessThan(-.3);
    const loweredMuzzle = new Vector3(); avatar.weaponPoint('muzzle', loweredMuzzle);
    for (let i = 0; i < 90; i++) {
      z -= .04;
      avatar.update(0, 0, z, 0, EntityFlags.Grounded | EntityFlags.Attacking, 1 / 60, i / 60);
      avatar.root.updateMatrixWorld(true);
    }
    expect(Math.abs(direction().y)).toBeLessThan(.01);
    const firingMuzzle = new Vector3(); avatar.weaponPoint('muzzle', firingMuzzle);
    expect(firingMuzzle.y).toBeGreaterThan(loweredMuzzle.y + .15);
    stand(avatar, 90, EntityFlags.Grounded | EntityFlags.Aiming);
    // The ready carry is at chest height (stock in the armpit); sighting brings the gun up to the eye.
    expect(sightGap()).toBeLessThan(readyGap - .02);
  });

  it('keeps the support elbow outside the torso throughout real-rifle sprint strides', async () => {
    const avatar = new Avatar(template, true), visual = await realRifle();
    avatar.setStance('rifle'); avatar.setWeapon('ak47', new Map([['ak47', visual]]));
    stand(avatar, 90);
    let z = 0;
    for (let frame = 0; frame < 360; frame++) {
      z -= .1;
      avatar.update(0, 0, z, Math.sin(frame / 90) * .4, EntityFlags.Grounded | EntityFlags.Sprinting, 1 / 60, frame / 60);
      avatar.root.updateMatrixWorld(true);
      if (frame < 60) continue;
      const local = (name: string) => avatar.root.worldToLocal(bone(avatar, name));
      const shoulderCenter = local('upper_arm_L').lerp(local('upper_arm_R'), .5);
      const elbow = local('forearm_L').sub(shoulderCenter);
      // Conservative chest cross-section: the elbow must remain beside or ahead of it.
      expect((elbow.x / .16) ** 2 + (elbow.z / .12) ** 2).toBeGreaterThan(1);
    }
  });

  it('plays the supplied crawl at source cadence through moving turns with one body/leg clock', () => {
    const avatar = new Avatar(template, true);
    const flags = EntityFlags.Grounded | EntityFlags.Prone;
    stand(avatar, 180, flags);
    const state = () => (avatar as unknown as { mocap: MocapPose }).mocap;
    const clip = assets.clips.get('prone_forward')!;
    expect(clip.stride / clip.duration).toBeCloseTo(1.15, 3);
    let x = 0, z = 0, previous: Vector3 | null = null, maxStep = 0;
    for (let i = 0; i < 300; i++) {
      const yaw = Math.sin(i / 90) * .4;
      x -= Math.sin(yaw) * 1.15 / 60; z -= Math.cos(yaw) * 1.15 / 60;
      avatar.update(x, 0, z, yaw, flags, 1 / 60, i / 60);
      avatar.root.updateMatrixWorld(true);
      expect(state().clip).toBe('prone_forward');
      expect(state().legs).toHaveLength(0);
      if (i > 60) {
        const hips = bone(avatar, 'spine').sub(new Vector3(x, 0, z));
        if (previous) maxStep = Math.max(maxStep, hips.distanceTo(previous));
        previous = hips;
        expect(state().layers!.find(layer => layer.clip === 'prone_forward')!.rate).toBeCloseTo(1, 2);
      }
    }
    expect(maxStep).toBeLessThan(.04);
  });

  it('points the gun at the true aim (not the head-capped one) before a shot may leave', () => {
    const avatar = new Avatar(template, true);
    avatar.setStance('rifle'); avatar.setWeapon('ak47', rifle()); stand(avatar, 60);
    const yaw = 1.3, want = new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), d = new Vector3();
    avatar.attackIntent = true;
    let ready = -1;
    for (let i = 0; i < 60; i++) {
      avatar.update(0, 0, 0, yaw, EntityFlags.Grounded, 1 / 60, i / 60); avatar.root.updateMatrixWorld(true);
      if (avatar.gunReady() && ready < 0) ready = i;
      // Whenever the gate is open, the bore really is on the cursor's direction.
      if (avatar.gunReady()) { avatar.weaponBore(new Vector3(), d); expect(d.angleTo(want)).toBeLessThan(.08); }
    }
    // The body turned a 75° flick within a fraction of a second.
    expect(ready).toBeGreaterThan(0); expect(ready).toBeLessThan(30);
  });

  it('keeps a non-ADS rifle ready through walking and jumping without stretching either arm', () => {
    const avatar = new Avatar(template, true);
    avatar.setStance('rifle'); avatar.setWeapon('ak47', rifle()); stand(avatar, 90);
    const lengths = (s: string) => [bone(avatar, `upper_arm_${s}`).distanceTo(bone(avatar, `forearm_${s}`)), bone(avatar, `forearm_${s}`).distanceTo(bone(avatar, `hand_${s}`))];
    const rest = { L: lengths('L'), R: lengths('R') };
    let z = 0;
    for (let i = 0; i < 120; i++) {
      z -= .04;
      const air = i >= 40 && i < 80;
      const y = air ? Math.sin((i - 40) / 40 * Math.PI) * .7 : 0;
      avatar.update(0, y, z, 0, (air ? 0 : EntityFlags.Grounded) | EntityFlags.Attacking, 1 / 60, i / 60);
      avatar.root.updateMatrixWorld(true);
      const direction = new Vector3();
      expect(avatar.weaponBore(new Vector3(), direction)).toBe(true);
      expect(direction.dot(new Vector3(0, 0, -1))).toBeGreaterThan(.999);
      for (const s of ['L', 'R'] as const) lengths(s).forEach((v, k) => expect(v).toBeCloseTo(rest[s][k]!, 5));
    }
  });
  it('loads every part on one skeleton with the derived haircuts and first-person arms', () => {
    expect(assets.bones.length).toBe(162);
    expect([...assets.parts.keys()].sort()).toEqual(['belt', 'body', 'eyes', 'feet', 'gloves', 'hair', 'infected', 'legs', 'top']);
    expect([...assets.hair.keys()].sort()).toEqual(['buzz', 'crop', 'side_part', 'undercut']);
    expect(assets.arms.getIndex()!.count).toBeGreaterThan(3000);
    expect(assets.parts.get('body')!.geometry.morphAttributes.position).toHaveLength(3);
  });

  it('stands on its feet with the hands hanging at the sides', () => {
    const avatar = new Avatar(template, true);
    stand(avatar);
    for (const s of ['L', 'R']) {
      const foot = bone(avatar, `foot_${s}`), toe = bone(avatar, `toe_${s}`), hand = bone(avatar, `hand_${s}`);
      expect(foot.y).toBeGreaterThan(.06); expect(foot.y).toBeLessThan(.18 * SURVIVOR_SIZE);
      expect(toe.y).toBeLessThan(.07);
      // Right is +X once facing −Z; the hands hang beside the hips.
      expect(Math.sign(hand.x)).toBe(s === 'R' ? 1 : -1);
      expect(hand.y).toBeGreaterThan(.7 * SURVIVOR_SIZE); expect(hand.y).toBeLessThan(1.05 * SURVIVOR_SIZE);
    }
    expect(bone(avatar, 'spine_006').y).toBeGreaterThan(1.5 * SURVIVOR_SIZE);
  });

  it('closes the trigger hand on the grip and the other on the handguard, fingers round them', () => {
    const avatar = new Avatar(template, true);
    const lib = rifle();
    avatar.setStance('rifle');
    avatar.setWeapon('ak47', lib);
    stand(avatar);
    // Posing the survivor may bring the gun in: read it after.
    avatar.root.updateMatrixWorld(true);
    const held = (avatar as unknown as { weaponObjects: Map<string, { obj: Group }> }).weaponObjects.values().next().value!.obj;
    const grip = new Vector3(0, -.08, .05).applyMatrix4(held.matrixWorld);
    const guard = new Vector3(0, -.03, -.3).applyMatrix4(held.matrixWorld);
    const palm = (s: string) => bone(avatar, `f_middle_01_${s}`).lerp(bone(avatar, `hand_${s}`), .3);
    // The palm proxy sits a handle radius off the grip's centre line.
    expect(palm('R').distanceTo(grip)).toBeLessThan(.065);
    expect(palm('L').distanceTo(guard)).toBeLessThan(.08);
    // Middle finger tip of the trigger hand ends near the grip, not sticking out.
    expect(bone(avatar, 'f_middle_03_R').distanceTo(grip)).toBeLessThan(.065);
  });

  it('bends the knees through a walk and tucks in a roll', () => {
    const avatar = new Avatar(template, true);
    let maxKnee = 0;
    for (let i = 0; i < 60; i++) {
      avatar.update(0, 0, -i * .05, 0, EntityFlags.Grounded, 1 / 30, i / 30);
      const hip = bone(avatar, 'thigh_L'), knee = bone(avatar, 'shin_L'), ankle = bone(avatar, 'foot_L');
      const bend = Math.PI - knee.clone().sub(hip).angleTo(knee.clone().sub(ankle));
      maxKnee = Math.max(maxKnee, bend);
      expect(Number.isFinite(bend)).toBe(true);
    }
    expect(maxKnee).toBeGreaterThan(.25);
    const roller = new Avatar(template, true);
    stand(roller, 5);
    let tucked = 0;
    for (let i = 0; i < 20; i++) {
      roller.update(0, 0, -i * .2, 0, EntityFlags.Grounded | EntityFlags.Rolling, 1 / 30, i / 30, { rollTicks: 20 - i, rollYaw: 0 });
      const hip = bone(roller, 'thigh_R'), knee = bone(roller, 'shin_R'), ankle = bone(roller, 'foot_R');
      tucked = Math.max(tucked, Math.PI - knee.clone().sub(hip).angleTo(knee.clone().sub(ankle)));
    }
    expect(tucked).toBeGreaterThan(1.6);
  });

  it('moves the support hand to the hip pouch and back during a reload', () => {
    const avatar = new Avatar(template, true);
    avatar.setStance('rifle');
    avatar.setWeapon('ak47', rifle());
    stand(avatar, 40, EntityFlags.Grounded | EntityFlags.Aiming);
    const start = bone(avatar, 'hand_L');
    avatar.startReload(2);
    let low = Infinity;
    for (let i = 0; i < 60; i++) { avatar.update(0, 0, 0, 0, EntityFlags.Grounded | EntityFlags.Aiming, 1 / 30, i / 30); low = Math.min(low, bone(avatar, 'hand_L').y); }
    expect(low).toBeLessThan(start.y - .15);
    stand(avatar, 20, EntityFlags.Grounded | EntityFlags.Aiming);
    expect(bone(avatar, 'hand_L').distanceTo(start)).toBeLessThan(.1);
  });

  it.each([0, EntityFlags.Crouching, EntityFlags.Prone])('plays the supplied reload over moving legs without changing bone lengths (posture %s)', (posture) => {
    const avatar = new Avatar(template, true), reference = new Avatar(template, true);
    const flags = EntityFlags.Grounded | posture;
    for (const a of [avatar, reference]) { a.setStance('rifle'); a.setWeapon('ak47', rifle()); stand(a, 180, flags); }
    const state = () => (avatar as unknown as { mocap: MocapPose }).mocap;
    const lengths = (s: string) => [bone(avatar, `upper_arm_${s}`).distanceTo(bone(avatar, `forearm_${s}`)), bone(avatar, `forearm_${s}`).distanceTo(bone(avatar, `hand_${s}`))];
    const initial = { L: lengths('L'), R: lengths('R') };
    avatar.startReload(2);
    let supportDeparture = 0, kneeLow = Infinity, kneeHigh = -Infinity;
    for (let i = 1; i <= 120; i++) {
      const z = -i * (posture === EntityFlags.Prone ? .01 : .03);
      for (const a of [avatar, reference]) { a.update(0, 0, z, 0, flags, 1 / 60, i / 60); a.root.updateMatrixWorld(true); }
      for (const s of ['L', 'R'] as const) lengths(s).forEach((v, k) => expect(v).toBeCloseTo(initial[s][k]!, 5));
      if (i === 60) {
        expect(state().action?.clip).toBe('rifle_reload');
        expect(state().action?.weight).toBe(1);
        expect(state().action?.time).toBeCloseTo(assets.clips.get('rifle_reload')!.duration / 2, 5);
        expect(avatar.root.getObjectByName('thigh_L')!.quaternion.angleTo(reference.root.getObjectByName('thigh_L')!.quaternion)).toBeLessThan(1e-6);
      }
      const held = (avatar as unknown as { weaponObjects: Map<string, { obj: Group }> }).weaponObjects.values().next().value!.obj;
      const palm = assets.hands.R.palm.clone().applyMatrix4(avatar.root.getObjectByName('hand_R')!.matrixWorld);
      expect(palm.distanceTo(new Vector3(0, -.08, .05).applyMatrix4(held.matrixWorld))).toBeLessThan(.04);
      supportDeparture = Math.max(supportDeparture, bone(avatar, 'hand_L').distanceTo(bone(reference, 'hand_L')));
      const knee = bone(avatar, 'shin_L').z - z;
      kneeLow = Math.min(kneeLow, knee); kneeHigh = Math.max(kneeHigh, knee);
    }
    expect(supportDeparture).toBeGreaterThan(.1);
    expect(kneeHigh - kneeLow).toBeGreaterThan(.02);
    avatar.update(0, 0, -4, 0, flags, 1 / 60, 2.1); avatar.root.updateMatrixWorld(true);
    expect(state().action).toBeNull();
  });

  it('cancels recorded reloading when switching weapons or entering a hand interaction', () => {
    const avatar = new Avatar(template, true);
    avatar.setStance('rifle'); avatar.setWeapon('ak47', rifle()); stand(avatar);
    const action = () => (avatar as unknown as { mocap: MocapPose | null }).mocap?.action;
    avatar.startReload(2); stand(avatar, 10); expect(action()?.clip).toBe('rifle_reload');
    avatar.setWeapon(null, rifle()); stand(avatar, 1); expect(action()).toBeFalsy();
    avatar.setWeapon('ak47', rifle()); stand(avatar);
    avatar.startReload(2); stand(avatar, 10); expect(action()?.clip).toBe('rifle_reload');
    stand(avatar, 1, EntityFlags.Grounded | EntityFlags.Climbing);
    stand(avatar, 30); expect(action()).toBeFalsy();
  });

  it('uses the recorded support-hand motion in first person and returns to the authored handguard', () => {
    const camera = new PerspectiveCamera(75, 16 / 9, .02, 100), view = new ViewModel(camera);
    const library = rifle(), visual = library.get('ak47')!;
    visual.firstPersonSupport = { arm: new Group(), contact: new Vector3(.3, -.03, 0) };
    view.setBody(assets); view.set('ak47', library);
    const state = { visible: true, moving: false, sprint: false, reloading: false, yaw: 0, pitch: 0 };
    const step = (reloading: boolean) => { view.update(1 / 60, { ...state, reloading }); camera.updateMatrixWorld(true); };
    for (let i = 0; i < 40; i++) step(false);
    const pos = (n: string) => camera.getObjectByName('first-person-hands')!.getObjectByName(n)!.getWorldPosition(new Vector3());
    const start = pos('hand_L'), upper = pos('upper_arm_L').distanceTo(pos('forearm_L')), lower = pos('forearm_L').distanceTo(pos('hand_L'));
    view.reload(2);
    let departure = 0;
    for (let i = 0; i < 120; i++) {
      step(true);
      departure = Math.max(departure, pos('hand_L').distanceTo(start));
      expect(pos('upper_arm_L').distanceTo(pos('forearm_L'))).toBeCloseTo(upper, 5);
      expect(pos('forearm_L').distanceTo(pos('hand_L'))).toBeCloseTo(lower, 5);
    }
    expect(departure).toBeGreaterThan(.1);
    for (let i = 0; i < 90; i++) step(false);
    expect(pos('hand_L').distanceTo(start)).toBeLessThan(.02);
    view.dispose();
  });

  it('applies any look: height, haircut, outfit and proportions', () => {
    const avatar = new Avatar(template, true);
    stand(avatar, 2);
    const head = bone(avatar, 'spine_006').y;
    avatar.setAppearance({ ...DEFAULT_APPEARANCE, height: 100, hair: 'bald', top: 'none' });
    stand(avatar, 2);
    expect(bone(avatar, 'spine_006').y).toBeGreaterThan(head * 1.05);
    const meshes: Mesh[] = [];
    avatar.root.traverse((o) => { if (o instanceof Mesh && o.name.startsWith('survivor-')) meshes.push(o); });
    expect(meshes.find((m) => m.name === 'survivor-hair')!.visible).toBe(false);
    expect(meshes.find((m) => m.name === 'survivor-top')!.visible).toBe(false);
    for (let seed = 1; seed < 20; seed++) {
      avatar.setAppearance(randomAppearance(seed));
      stand(avatar, 2);
      expect(bone(avatar, 'toe_R').y).toBeLessThan(.09);
    }
  });

  it('carries the recorded clips and plays them while running, sprinting and jumping', () => {
    expect([...assets.clips.keys()].sort()).toEqual(['climb_down', 'climb_up', 'crouch_backward', 'crouch_forward', 'crouch_left', 'crouch_right', 'crouch_to_prone', 'fast_run', 'hammer', 'hang_to_crouch', 'jog_forward', 'jump', 'long_melee_slash', 'long_melee_slash_2', 'melee_walk', 'pistol_draw', 'pistol_hip', 'pistol_hold', 'pistol_shoot', 'prone_forward', 'prone_rifle', 'prone_turn_left', 'prone_turn_right', 'punch_1', 'punch_2', 'punch_hook', 'rifle_aim_idle', 'rifle_idle', 'rifle_kneel_idle', 'rifle_reload', 'rifle_run', 'rifle_sprint_backward', 'rifle_sprint_forward', 'rifle_start_run', 'roll', 'roll_armed', 'run_left', 'run_right', 'stand', 'stand_to_crouch', 'sword_combo', 'sword_slash', 'sword_thrust_slash', 'turn_left', 'turn_right', 'walk_backward', 'walk_forward', 'walk_left', 'walk_right']);
    const avatar = new Avatar(template, true);
    const mocap = () => (avatar as unknown as { mocap: { clip: string; weight: number } | null }).mocap;
    const run = (z0: number, step: number, flags: number, n = 40) => { for (let i = 0; i < n; i++) { avatar.update(0, 0, z0 + i * step, 0, flags, 1 / 30, i / 30); avatar.root.updateMatrixWorld(); } };
    run(0, -.2, EntityFlags.Grounded | EntityFlags.Sprinting);
    expect(mocap()?.clip).toBe('fast_run');
    expect(mocap()!.weight).toBeGreaterThan(.9);
    expect(Number.isFinite(bone(avatar, 'toe_R').y)).toBe(true);
    avatar.setWeapon('ak47', rifle()); avatar.setStance('rifle');
    run(-8, -.2, EntityFlags.Grounded | EntityFlags.Sprinting, 70);
    expect(mocap()?.clip).toBe('rifle_sprint_forward');
    // Moving away from the view backpedals with the recorded backward steps (no turning round).
    run(-16, .2, EntityFlags.Grounded);
    expect(mocap()?.clip).toBe('rifle_sprint_backward');
  });

  it('aims, walks with a blade and rolls with recorded clips, and stops without a jump', () => {
    const avatar = new Avatar(template, true);
    const mocap = () => (avatar as unknown as { mocap: { clip: string; weight: number } | null }).mocap;
    avatar.setStance('rifle'); avatar.setWeapon('ak47', rifle());
    stand(avatar, 30, EntityFlags.Grounded | EntityFlags.Aiming);
    expect(mocap()?.clip).toBe('rifle_aim_idle');
    // Sprinting, then stopping: the hands never jump from one frame to the next.
    let z = 0, last = bone(avatar, 'hand_R'), jump = 0;
    for (let i = 0; i < 70; i++) {
      if (i < 35) z -= .2;
      avatar.update(0, 0, z, 0, EntityFlags.Grounded | (i < 35 ? EntityFlags.Sprinting : 0), 1 / 30, i / 30);
      avatar.root.updateMatrixWorld();
      const h = bone(avatar, 'hand_R').sub(new Vector3(0, 0, z));
      if (i >= 35) jump = Math.max(jump, h.distanceTo(last));
      last = h;
    }
    // In a match the rifle settles into the ready stance, not the lobby's relaxed idle.
    expect(mocap()?.clip).toBe('rifle_aim_idle');
    expect(jump).toBeLessThan(.1);
    const roller = new Avatar(template, true);
    stand(roller, 5);
    let lowest = Infinity;
    for (let i = 0; i < 20; i++) {
      roller.update(0, 0, -i * .2, 0, EntityFlags.Grounded | EntityFlags.Rolling, 1 / 30, i / 30, { rollTicks: 20 - i, rollYaw: 0 });
      roller.root.updateMatrixWorld();
      lowest = Math.min(lowest, bone(roller, 'spine_006').y);
    }
    expect((roller as unknown as { mocap: { clip: string } | null }).mocap?.clip).toBe('roll');
    expect(lowest).toBeLessThan(.6);
  });

  it.each([30, 60, 144])('keeps walking phase continuous and body/feet synchronized at %s FPS', (fps) => {
    const avatar = new Avatar(template, true);
    stand(avatar);
    let z = 0, lastPhase = -Infinity;
    for (let i = 0; i < fps * 2; i++) {
      z -= 3.4 / fps;
      avatar.update(0, 0, z, 0, EntityFlags.Grounded, 1 / fps, i / fps);
      avatar.root.updateMatrixWorld(true);
      const pose = (avatar as unknown as { mocap: MocapPose }).mocap;
      expect(pose.clip).toBe('walk_forward');
      const legs = pose.legs!.find((l) => l.clip === pose.clip)!;
      expect(pose.time).toBe(legs.time);
      expect(pose.time).toBeGreaterThan(lastPhase);
      lastPhase = pose.time;
      expect(Number.isFinite(bone(avatar, 'toe_L').y)).toBe(true);
    }
    const duration = assets.clips.get('walk_forward')!.duration;
    const stride = assets.clips.get('walk_forward')!.stride;
    // Startup filtering contributes at most 15 cm; no cadence clamp or frame-rate-dependent drift.
    expect(lastPhase / duration * stride).toBeCloseTo(6.8, 0);
    avatar.update(1000, 0, 1000, 0, EntityFlags.Grounded, 1 / fps, 3);
    expect((avatar as unknown as { frame: { speed: number } }).frame.speed).toBe(0);
  });

  it('advances the same locomotion clocks while hidden and resumes the current phase on reveal', () => {
    const shown = new Avatar(template, true), hidden = new Avatar(template, true);
    stand(shown); stand(hidden);
    hidden.root.visible = false;
    for (let i = 1; i <= 120; i++) for (const avatar of [shown, hidden]) {
      avatar.update(0, 0, -i * 3.4 / 60, 0, EntityFlags.Grounded, 1 / 60, i / 60);
      avatar.root.updateMatrixWorld(true);
    }
    const pose = (a: Avatar) => (a as unknown as { mocap: MocapPose }).mocap;
    expect(pose(hidden).time).toBe(pose(shown).time);
    expect(pose(hidden).legs).toEqual(pose(shown).legs);
    hidden.root.visible = true;
    for (const avatar of [shown, hidden]) {
      avatar.update(0, 0, -121 * 3.4 / 60, 0, EntityFlags.Grounded, 1 / 60, 121 / 60);
      avatar.root.updateMatrixWorld(true);
    }
    expect(pose(hidden).time).toBe(pose(shown).time);
    const scene = new Scene(); shown.dispose(scene); hidden.dispose(scene);
  });

  it('shows both first-person hands: one round a grip, one resting in view', () => {
    const arms = new HumanBody(assets, { armsOnly: true });
    // The skin of the arms, and the shirt's sleeves over them (the skin under the sleeves left out).
    expect(arms.meshList.map((m) => m.name).sort()).toEqual(['survivor-body', ...(assets.parts.has('gloves') ? ['survivor-gloves'] : []), ...(assets.sleeves ? ['survivor-top'] : [])]);
    if (assets.sleeves) expect(arms.meshList.find((m) => m.name === 'survivor-body')!.geometry.getIndex()!.count).toBeLessThan(assets.arms.getIndex()!.count);
    const scene = new Scene(), camera = new PerspectiveCamera(75, 16 / 9, .02, 100);
    scene.add(camera);
    camera.position.set(3, 1.62, 2);
    camera.rotation.set(0, .7, 0);
    const hands = new FirstPersonHands(assets, camera);
    hands.visible = true;
    const at = (x: number, y: number, z: number) => { camera.updateMatrixWorld(true); return camera.localToWorld(new Vector3(x, y, z)); };
    const grip = at(.17, -.21, -.3);
    hands.request(() => ({
      R: { grasp: { center: grip, axis: new Vector3(0, 1, 0).transformDirection(camera.matrixWorld), approach: new Vector3(-1, 0, 0).transformDirection(camera.matrixWorld), radius: .017 } },
      L: { palm: at(-.18, -.23, -.4), preset: 'relaxed' },
    }));
    scene.updateMatrixWorld(true);
    const bone = (n: string) => hands.holder.getObjectByName(n)!.getWorldPosition(new Vector3());
    const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    // The fingers lie round the handle: their joints a finger's thickness off its centre line.
    const axis = new Vector3(0, 1, 0).transformDirection(camera.matrixWorld);
    const offAxis = (p: Vector3) => { const d = p.clone().sub(grip); return d.addScaledVector(axis, -d.dot(axis)).length(); };
    expect(bone('f_middle_01_R').distanceTo(grip)).toBeLessThan(.07);
    for (const f of ['f_middle_03_R', 'f_ring_03_R']) expect(offAxis(bone(f))).toBeLessThan(.035);
    for (const s of ['L', 'R']) expect(frustum.containsPoint(bone(`f_middle_02_${s}`))).toBe(true);
  });

  it('keeps walking legs under a stable aiming layer across many strides', () => {
    const avatar = new Avatar(template, true);
    avatar.setStance('rifle'); avatar.setWeapon('ak47', rifle());
    stand(avatar, 40, EntityFlags.Grounded | EntityFlags.Aiming);
    let low = Infinity, high = -Infinity, kneeLow = Infinity, kneeHigh = -Infinity;
    const origin = new Vector3(), direction = new Vector3();
    for (let i = 1; i <= 180; i++) {
      const z = -i * .07;
      avatar.update(0, 0, z, 0, EntityFlags.Grounded | EntityFlags.Aiming, 1 / 60, i / 60);
      expect(avatar.weaponBore(origin, direction)).toBe(true);
      if (i > 40) {
        low = Math.min(low, origin.y); high = Math.max(high, origin.y);
        expect(direction.dot(new Vector3(0, 0, -1))).toBeGreaterThan(.999);
        const knee = bone(avatar, 'shin_L').z - z;
        kneeLow = Math.min(kneeLow, knee); kneeHigh = Math.max(kneeHigh, knee);
        const shoulder = bone(avatar, 'upper_arm_R'), elbow = bone(avatar, 'forearm_R'), wrist = bone(avatar, 'hand_R');
        expect(shoulder.distanceTo(elbow) + elbow.distanceTo(wrist)).toBeLessThan(.8);
      }
    }
    // Rifle Run includes the supplied body's running bounce; the bore stays aligned throughout.
    expect(high - low).toBeLessThan(.16);
    expect(kneeHigh - kneeLow).toBeGreaterThan(.02);
  });

  it('stows on body hooks during interactions and restores the hand grip afterwards', () => {
    const avatar = new Avatar(template, true), lib = rifle();
    avatar.setStance('rifle'); avatar.setWeapon('ak47', lib);
    avatar.setBackWeapon('ak47', lib);
    stand(avatar);
    const hook = avatar.root.getObjectByName('carry-hook-back_right')!;
    expect(hook.parent!.name).toBe('spine_003');
    expect(hook.getObjectByName('stowed-weapon')).toBeDefined();
    avatar.healing = true;
    stand(avatar, 10);
    expect(avatar.root.getObjectByName('interaction-stowed-weapon')!.visible).toBe(true);
    expect(avatar.weaponBore(new Vector3(), new Vector3())).toBe(false);
    avatar.healing = false;
    stand(avatar, 20);
    expect(avatar.root.getObjectByName('interaction-stowed-weapon')!.visible).toBe(false);
    expect(avatar.weaponBore(new Vector3(), new Vector3())).toBe(true);
  });

  it('embeds the supplied FBX sources with their exact hashes and correct playback modes', async () => {
    const glb = await readFile(new URL('../../../../../models/characters/zion-survivor.glb', import.meta.url));
    const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8')) as {
      animations: Array<{ name: string; extras: { source: string; sha256: string; loop: boolean } }>;
    };
    for (const [id, source] of [
      ['fast_run', 'Fast Run.fbx'], ['rifle_idle', 'Rifle Idle.fbx'], ['rifle_aim_idle', 'Rifle Aiming Idle.fbx'],
      ['rifle_sprint_forward', 'Sprint Forward.fbx'], ['rifle_sprint_backward', 'Sprint Backward.fbx'], ['rifle_start_run', 'Rifle Start Run.fbx'],
      ['rifle_run', 'Rifle Run.fbx'], ['rifle_reload', 'Reloading.fbx'], ['run_left', 'Run Left.fbx'], ['run_right', 'Run Right.fbx'],
      ['rifle_kneel_idle', 'Rifle Kneel Idle.fbx'], ['prone_rifle', 'Prone Firing Rifle.fbx'],
      ['prone_forward', 'Prone Forward.fbx'], ['prone_turn_left', 'Prone Left Turn.fbx'],
      ['crouch_forward', 'Crouch Walking.fbx'], ['crouch_backward', 'Walk Crouching Backward.fbx'],
      ['crouch_left', 'Walk Crouching Left.fbx'], ['crouch_right', 'Walk Crouching Right.fbx'],
      ['stand_to_crouch', 'Stand To Crouch.fbx'], ['crouch_to_prone', 'Crouch To Prone.fbx'],
    ]) {
      const animation = json.animations.find((a) => a.name === id)!;
      const fbx = await readFile(new URL(`../../../../../models/characters/mocap/${id}.fbx`, import.meta.url));
      expect(animation.extras.source).toBe(source);
      expect(animation.extras.sha256).toBe(createHash('sha256').update(fbx).digest('hex'));
      expect(animation.extras.loop).toBe(!['rifle_reload', 'rifle_start_run', 'stand_to_crouch', 'crouch_to_prone'].includes(id));
    }
    expect(assets.clips.has('rifle_aim_walk')).toBe(false);
  });

  it('never plays Start Run, carries the ready rifle on the move and lowers it only to sprint', () => {
    const avatar = new Avatar(template, true);
    avatar.setStance('rifle'); avatar.setWeapon('ak47', rifle()); stand(avatar);
    const state = () => (avatar as unknown as { mocap: { clip: string; time: number; upper?: { clip: string; weight: number } } }).mocap;
    let z = 0, starts = 0, last = '';
    for (let i = 0; i < 300; i++) {
      z -= .08;
      avatar.update(0, 0, z, 0, EntityFlags.Grounded, 1 / 60, i / 60);
      avatar.root.updateMatrixWorld(true);
      if (state().clip !== last && state().clip === 'rifle_start_run') starts++;
      last = state().clip;
    }
    // Start Run opens by leaning back, which reads as the legs dragging the body.
    expect(starts).toBe(0); expect(state().clip).toBe('rifle_run');
    for (let i = 0; i < 60; i++) {
      z -= .1;
      avatar.update(0, 0, z, 0, EntityFlags.Grounded | EntityFlags.Sprinting, 1 / 60, i / 60);
      avatar.root.updateMatrixWorld(true);
    }
    expect(state().clip).toBe('rifle_sprint_forward');
    for (const step of [-.04, .04]) {
      for (let i = 0; i < 100; i++) {
        z += step;
        avatar.update(0, 0, z, 0, EntityFlags.Grounded | EntityFlags.Aiming, 1 / 60, i / 60);
        avatar.root.updateMatrixWorld(true);
      }
      expect(state().clip).toBe(step < 0 ? 'walk_forward' : 'walk_backward');
      const uppers = (state() as unknown as { uppers: Array<{ clip: string; weight: number }> }).uppers;
      expect(uppers.find((l) => l.clip === 'rifle_aim_idle')?.weight).toBeGreaterThan(.99);
    }
  });

  it('keeps both palms on their authored grips without stretching bones through aim changes', () => {
    const avatar = new Avatar(template, true);
    avatar.setStance('rifle'); avatar.setWeapon('ak47', rifle());
    stand(avatar, 60, EntityFlags.Grounded | EntityFlags.Aiming);
    const lengths = (s: string) => {
      const shoulder = bone(avatar, `upper_arm_${s}`), elbow = bone(avatar, `forearm_${s}`), wrist = bone(avatar, `hand_${s}`);
      return [shoulder.distanceTo(elbow), elbow.distanceTo(wrist)];
    };
    const rest = { L: lengths('L'), R: lengths('R') };
    for (const pitch of [-.8, -.3, 0, .45, .9]) {
      avatar.setAimPitch(pitch);
      for (let i = 0; i < 30; i++) {
        avatar.update(0, 0, -i * .04, .4, EntityFlags.Grounded | EntityFlags.Aiming, 1 / 60, i / 60);
        avatar.root.updateMatrixWorld(true);
        for (const s of ['L', 'R'] as const) lengths(s).forEach((v, k) => expect(v).toBeCloseTo(rest[s][k]!, 5));
        const held = (avatar as unknown as { weaponObjects: Map<string, { obj: Group }> }).weaponObjects.values().next().value!.obj;
        for (const [s, p] of [['R', new Vector3(0, -.08, .05)], ['L', new Vector3(0, -.03, -.3)]] as const) {
          const palm = assets.hands[s].palm.clone().applyMatrix4(avatar.root.getObjectByName(`hand_${s}`)!.matrixWorld);
          expect(palm.distanceTo(p.clone().applyMatrix4(held.matrixWorld))).toBeLessThan(.04);
        }
      }
    }
  });

  it('uses directional recordings for standing and crouching, and keeps kneeling/prone at their real heights', () => {
    const avatar = new Avatar(template, true);
    avatar.setStance('rifle'); avatar.setWeapon('ak47', rifle()); stand(avatar);
    const state = () => (avatar as unknown as { mocap: { clip: string; time: number; layers: Array<{ weight: number }> } }).mocap;
    let x = 0, z = 0;
    const move = (vx: number, vz: number, flags: number, n = 100) => {
      for (let i = 0; i < n; i++) {
        x += vx / 60; z += vz / 60;
        avatar.update(x, 0, z, 0, EntityFlags.Grounded | flags, 1 / 60, i / 60);
        avatar.root.updateMatrixWorld(true);
        expect(state().layers.reduce((s, l) => s + l.weight, 0)).toBeLessThanOrEqual(1.00001);
        expect(Number.isFinite(bone(avatar, 'hand_R').y)).toBe(true);
      }
    };
    const A = EntityFlags.Aiming, C = EntityFlags.Crouching, P = EntityFlags.Prone;
    move(-3, 0, A); expect(state().clip).toBe('walk_left');
    move(3, 0, A); expect(state().clip).toBe('walk_right');
    move(0, 0, C | A, 200); expect(state().clip).toBe('rifle_kneel_idle');
    expect(bone(avatar, 'spine_006').y).toBeGreaterThan(.7); expect(bone(avatar, 'spine_006').y).toBeLessThan(1.5);
    // Aiming keeps facing the camera, so the directional recordings play...
    for (const [vx, vz, id] of [[0, -1.2, 'forward'], [0, 1.2, 'backward'], [-1.2, 0, 'left'], [1.2, 0, 'right']] as const) {
      move(vx, vz, C | A); expect(state().clip).toBe(`crouch_${id}`);
    }
    // ...moving freely sideways turns into the travel; backwards still backpedals.
    move(0, 1.2, C, 150); expect(state().clip).toBe('crouch_backward');
    move(1.2, 0, C, 150); expect(state().clip).toBe('crouch_forward');
    move(0, 0, P | A, 240); expect(state().clip).toBe('prone_rifle'); expect(state().time).toBe(0);
    expect(bone(avatar, 'spine_006').y).toBeGreaterThan(.1); expect(bone(avatar, 'spine_006').y).toBeLessThan(.65);
    move(0, -.6, P); expect(state().clip).toBe('prone_forward');
    const before = state().time;
    move(0, .6, P, 1); expect(state().time).toBeLessThan(before);
    move(0, 0, 0, 260); expect(state().clip).toBe('rifle_aim_idle');
    expect(bone(avatar, 'spine_006').y).toBeGreaterThan(1.8);
  });

  it('turns feet and torso with a stationary aiming camera and shares elevation through the chest', () => {
    const avatar = new Avatar(template, true);
    avatar.setStance('rifle'); avatar.setWeapon('ak47', rifle());
    const flags = EntityFlags.Grounded | EntityFlags.Aiming;
    stand(avatar, 60, flags);
    const chest = avatar.root.getObjectByName('spine_003')!;
    const start = chest.getWorldQuaternion(new Quaternion());
    for (let i = 0; i < 90; i++) {
      avatar.setAimPitch(.7); avatar.update(0, 0, 0, .8, flags, 1 / 60, i / 60); avatar.root.updateMatrixWorld(true);
    }
    expect(avatar.root.rotation.y).toBeCloseTo(.8, 3);
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -.8).multiply(chest.getWorldQuaternion(new Quaternion()));
    expect(rotation.angleTo(start)).toBeGreaterThan(.15);
    const forward = new Vector3(0, 0, 1).applyQuaternion(assets.restQ[assets.index.get('spine_003')!]!.clone().invert()).applyQuaternion(rotation);
    const initialForward = new Vector3(0, 0, 1).applyQuaternion(assets.restQ[assets.index.get('spine_003')!]!.clone().invert()).applyQuaternion(start);
    expect(forward.y).toBeGreaterThan(initialForward.y + .1);
    const bore = new Vector3();
    expect(avatar.weaponBore(new Vector3(), bore)).toBe(true);
    expect(bore.dot(new Vector3(-Math.sin(.8) * Math.cos(.7), Math.sin(.7), -Math.cos(.8) * Math.cos(.7)))).toBeGreaterThan(.999);
  });

  it('plays both crawl turns while gameplay owns heading, without an extra recorded root spin', () => {
    const avatar = new Avatar(template, true);
    avatar.setStance('rifle'); avatar.setWeapon('ak47', rifle());
    stand(avatar, 140, EntityFlags.Grounded | EntityFlags.Prone);
    const state = () => (avatar as unknown as { mocap: { clip: string } }).mocap;
    let yaw = 0;
    for (const sign of [1, -1]) {
      for (let i = 0; i < 70; i++) {
        yaw += sign / 60;
        avatar.update(0, 0, 0, yaw, EntityFlags.Grounded | EntityFlags.Prone, 1 / 60, i / 60);
        avatar.root.updateMatrixWorld(true);
      }
      expect(state().clip).toBe(sign > 0 ? 'prone_turn_left' : 'prone_turn_right');
      expect(Math.abs(avatar.root.rotation.y - yaw)).toBeLessThan(.2);
      expect(bone(avatar, 'spine_006').y).toBeLessThan(.65);
      const axis = bone(avatar, 'spine_004').sub(bone(avatar, 'spine'));
      const heading = Math.atan2(-axis.x, -axis.z);
      expect(Math.abs(Math.atan2(Math.sin(heading - avatar.root.rotation.y), Math.cos(heading - avatar.root.rotation.y)))).toBeLessThan(.25);
    }
  });

  it('keeps body and hands continuous through chained and interrupted stance transitions', () => {
    const avatar = new Avatar(template, true);
    avatar.setStance('rifle'); avatar.setWeapon('ak47', rifle());
    const A = EntityFlags.Aiming, C = EntityFlags.Crouching, P = EntityFlags.Prone;
    stand(avatar, 60, EntityFlags.Grounded | A);
    let head = bone(avatar, 'spine_006'), hand = bone(avatar, 'hand_L'), maxHead = 0, maxHand = 0, headAt = '', handAt = '';
    for (const [posture, frames] of [[C, 150], [P, 180], [0, 260], [C, 20], [0, 12], [P, 240], [C, 180], [0, 160]]) {
      for (let i = 0; i < frames!; i++) {
        avatar.update(0, 0, 0, 0, EntityFlags.Grounded | A | posture!, 1 / 60, i / 60);
        avatar.root.updateMatrixWorld(true);
        const nextHead = bone(avatar, 'spine_006'), nextHand = bone(avatar, 'hand_L');
        if (nextHead.distanceTo(head) > maxHead) { maxHead = nextHead.distanceTo(head); headAt = `${posture} frame ${i}: ${head.toArray()} -> ${nextHead.toArray()}`; }
        if (nextHand.distanceTo(hand) > maxHand) { maxHand = nextHand.distanceTo(hand); handAt = `${posture} frame ${i}: ${hand.toArray()} -> ${nextHand.toArray()}`; }
        head = nextHead; hand = nextHand;
      }
    }
    expect(maxHead, headAt).toBeLessThan(.14);
    expect(maxHand, handAt).toBeLessThan(.18);
  });

  it('steps immediately on departure, including slow steps and moving out of an unfinished stance change', () => {
    for (const [flags, vx, vz, leg] of [
      [0, 0, -4, 'walk_forward'], [EntityFlags.Sprinting, 0, -4, 'walk_forward'], [EntityFlags.Aiming, 0, -.1, 'walk_forward'],
      [EntityFlags.Aiming, -3, 0, 'walk_left'], [0, 0, 2, 'walk_backward'],
      [EntityFlags.Crouching, 0, -1, 'crouch_forward'], [EntityFlags.Prone, 0, -.5, 'prone_forward'],
    ] as const) {
      const avatar = new Avatar(template, true);
      avatar.setStance('rifle'); avatar.setWeapon('ak47', rifle());
      stand(avatar, 60);
      const before = avatar.root.getObjectByName('thigh_L')!.quaternion.clone();
      for (let i = 1; i <= 6; i++) {
        avatar.update(vx * i / 60, 0, vz * i / 60, 0, EntityFlags.Grounded | flags, 1 / 60, i / 60);
        avatar.root.updateMatrixWorld(true);
        const motion = (avatar as unknown as { mocap: MocapPose }).mocap;
        const step = flags & EntityFlags.Prone ? motion.layers!.find(layer => layer.clip === 'prone_forward')! : motion.legs![0]!;
        expect(step.clip).toBe(leg);
        expect(step.time).toBeGreaterThan(0);
        expect(step.weight).toBeGreaterThan(flags & EntityFlags.Prone ? .1 : .4);
        expect(motion.clip).not.toMatch(/to_crouch|to_prone/);
        if (i === 1) expect(avatar.root.getObjectByName('thigh_L')!.quaternion.angleTo(before)).toBeGreaterThan(.001);
      }
      expect(avatar.root.getObjectByName('thigh_L')!.quaternion.angleTo(before)).toBeGreaterThan(.005);
    }
  });

  it.each([false, true])('keeps the cheek seated on the real rifle stock at rest and through running strides (camera aligned: %s)', async (viewAligned) => {
    const visual = await realRifle(), grip = visual.aim!.grip;
    const avatar = new Avatar(template, true);
    avatar.viewAligned = viewAligned;
    avatar.setStance('rifle'); avatar.setWeapon('ak47', new Map([['ak47', visual]]));
    stand(avatar, 60, EntityFlags.Grounded | EntityFlags.Aiming);
    let z = 0;
    for (let i = 0; i < 100; i++) {
      if (i > 20) z -= 2.8 / 60;
      avatar.update(0, 0, z, 0, EntityFlags.Grounded | EntityFlags.Aiming, 1 / 60, i / 60); avatar.root.updateMatrixWorld(true);
      const runtime = avatar as unknown as { human: HumanBody; weaponObjects: Map<string, { obj: Group }> };
      const gun = [...runtime.weaponObjects.values()][0]!.obj;
      const scale = new Vector3().setFromMatrixScale(gun.matrixWorld);
      const stock = rifleStockContact(gun, grip.clone().multiply(scale), visual.aim!.barrel.clone().normalize(), visual.aim!.up.clone().normalize(), 1)!;
      expect(stock).not.toBeNull();
      const contact = stock.applyQuaternion(gun.getWorldQuaternion(new Quaternion())).add(gun.getWorldPosition(new Vector3()));
      expect(runtime.human.rifleCheek('R').distanceTo(contact)).toBeLessThan(.065);
      const head = avatar.root.getObjectByName('spine_006')!;
      const gaze = new Vector3(0, 0, 1).applyQuaternion(assets.restQ[assets.index.get('spine_006')!]!.clone().invert()).applyQuaternion(head.getWorldQuaternion(new Quaternion()));
      expect(gaze.dot(new Vector3(0, 0, -1))).toBeGreaterThan(.97);
      for (const [s, p] of [['R', grip], ['L', visual.twoHandGrip!.support]] as const) {
        const palm = assets.hands[s].palm.clone().applyMatrix4(avatar.root.getObjectByName(`hand_${s}`)!.matrixWorld);
        expect(palm.distanceTo(p.clone().applyMatrix4(gun.matrixWorld))).toBeLessThan(.04);
      }
    }
  });

  it('turns into camera-relative forward movement without the recording turning the hips/chest sideways', () => {
    const avatar = new Avatar(template, true);
    avatar.viewAligned = true;
    avatar.setStance('rifle'); avatar.setWeapon('ak47', rifle()); stand(avatar, 60);
    let x = 0, z = 0;
    for (const [yaw, speed] of [[.7, .1], [1.3, 3], [-2.9, 5.9]] as const) {
      for (let i = 0; i < 90; i++) {
        x -= Math.sin(yaw) * speed / 60; z -= Math.cos(yaw) * speed / 60;
        avatar.update(x, 0, z, yaw, EntityFlags.Grounded, 1 / 60, i / 60); avatar.root.updateMatrixWorld(true);
        // Moving freely the body turns smoothly into its travel (here along the camera).
        if (i > 45) expect(Math.abs(Math.atan2(Math.sin(avatar.root.rotation.y - yaw), Math.cos(avatar.root.rotation.y - yaw)))).toBeLessThan(.03);
        const state = (avatar as unknown as { mocap: MocapPose }).mocap;
        expect(state.legs?.[0]?.clip).not.toMatch(/^run_(left|right)$/);
        if (i > 30) for (const n of ['spine', 'spine_003']) {
          const forward = new Vector3(0, 0, 1).applyQuaternion(assets.restQ[assets.index.get(n)!]!.clone().invert()).applyQuaternion(avatar.root.getObjectByName(n)!.getWorldQuaternion(new Quaternion())).setY(0).normalize();
          expect(forward.dot(new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)))).toBeGreaterThan(.999);
        }
      }
    }
    const before = bone(avatar, 'hand_R');
    avatar.update(x, 0, z, -2.9, EntityFlags.Grounded, 1 / 60, 3); avatar.root.updateMatrixWorld(true);
    expect(bone(avatar, 'hand_R').distanceTo(before)).toBeLessThan(.1);
  });

  it('keeps the real rifle support wrist neutral in first-person hip fire, aim, running and recoil', async () => {
    const camera = new PerspectiveCamera(75, 16 / 9, .02, 100), view = new ViewModel(camera);
    const visual = await realRifle();
    view.setBody(assets); view.set('ak47', new Map([['ak47', visual]]));
    const f = assets.index.get('forearm_L')!, h = assets.index.get('hand_L')!;
    const rest = assets.restQ[f]!.clone().invert().multiply(assets.restQ[h]!);
    for (const [aiming, moving, sprint] of [[false, false, false], [true, false, false], [true, true, false], [false, true, true]]) {
      for (let i = 0; i < 90; i++) {
        camera.rotation.set(.2, i / 90, .04);
        if (i % 12 === 0) view.kick();
        view.update(1 / 60, { visible: true, moving: moving!, sprint: sprint!, aiming, reloading: false, yaw: i / 90, pitch: .2 });
        camera.updateMatrixWorld(true);
        const forearm = camera.getObjectByName('first-person-hands')!.getObjectByName('forearm_L')!;
        const hand = camera.getObjectByName('first-person-hands')!.getObjectByName('hand_L')!;
        const line = hand.getWorldPosition(new Vector3()).sub(forearm.getWorldPosition(new Vector3())).normalize();
        const neutral = new Vector3(0, 1, 0).applyQuaternion(hand.getWorldQuaternion(new Quaternion()).multiply(rest.clone().invert()));
        expect(line.angleTo(neutral)).toBeLessThan(35 * Math.PI / 180);
        const palm = assets.hands.L.palm.clone().applyMatrix4(hand.matrixWorld);
        const model = (view as unknown as { models: Map<string, Group> }).models.values().next().value!;
        expect(palm.distanceTo(visual.firstPersonSupport!.contact.clone().applyMatrix4(model.matrixWorld))).toBeLessThan(.06); // cradled from below: the palm sits a little under the contact
      }
    }
    view.dispose();
  });
});
