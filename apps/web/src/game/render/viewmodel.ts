import { Box3, BufferGeometry, CircleGeometry, DoubleSide, Euler, Float32BufferAttribute, Group, Matrix4, Mesh, MeshBasicMaterial, Quaternion, Raycaster, Vector3, type Camera, type Material, type Object3D } from 'three';
import { ITEMS, attachmentModifier, weaponOptic, type Attachments } from '@zion/shared';
import { dressWeapon, withBuiltinOptic, type WeaponLibrary, type WeaponVisual } from './weapons';
import { WeaponMechanics } from './weapon-mechanics';
import { reloadScriptOf, type HandTarget } from '../reload-scripts';
import { fitGripProfile } from './grip-profile';
import { RecoilSpring } from '../first-person-recoil';
import { MeleeEdge, type StrikeAxes } from './melee-edge';
import { aimOffhandLight, offhandLightPose } from './offhand-light';
import type { Appearance } from '@zion/shared';
import { FirstPersonHands, type FpHand } from './fp-hands';
import type { Grasp, HumanAssets } from './human-rig';
import { usesRifleReload } from './recorded-reload';
import { ReloadMagazine } from './reload-magazine';
import { handAnimationFor } from '../hand-studio';
import { sampleClip, sampleHandPoint, samplePos, samplePose, sampleRot, sampleScale } from './hand-animation';
import type { HandAnimation, HandKey } from '@zion/shared';

/**
 * First-person weapon held in front of the camera. Uses the weapon's display model (muzzle +X,
 * top +Y, centred on the grip) parented to the camera, with procedural sway, walk bob, recoil
 * and a reload dip so the view feels weighty without the third-person rig.
 */
export class ViewModel {
  setVisible(visible: boolean): void { this.root.visible = visible; }
  private readonly root = new Group();
  private readonly pivot = new Group();
  private readonly models = new Map<string, Group>();
  /** Per dressed model: its sight line and moving parts. */
  private readonly rigs = new Map<string, { visual: WeaponVisual; mechanics: WeaponMechanics }>();
  /** Per dressed model with a magnified optic: the lens the scope image is drawn on. */
  private readonly lenses = new Map<string, OpticLens>();
  private current: string | null = null;
  /** ADS speed and eye relief of the current setup. */
  private adsSpeed = 1;
  private eyeRelief = .3;
  private readonly hipQuat = new Quaternion();
  private readonly adsQuat = new Quaternion();
  private readonly adsPos = new Vector3();
  private readonly rear = new Vector3();
  private readonly front = new Vector3();
  private readonly euler = new Euler();
  /** Hip-fire position of the gun in front of the camera (x right, y up, z forward). */
  private readonly hip = new Vector3(0.2, -0.27, -0.25);
  /** Hip-fire tilt of the gun: pitch (up/down) and yaw (left/right), radians. */
  private hipTilt: [number, number] = [0, 0];
  private offhandId: string | null = null;
  private offhandModel: Group | null = null;
  private readonly offhandBase = new Matrix4();
  private readonly recoil = new RecoilSpring(22, .14);
  private bobPhase = 0;
  private bobAmount = 0;
  private bobSpeed = 2.7;
  private swayX = 0;
  private swayY = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  private dip = 0;
  private aimBlend = 0;
  private readonly target = new Vector3();
  private readonly direction = new Vector3();
  private readonly aimRotation = new Quaternion();
  private readonly forward = new Vector3(0, 0, -1);
  private readonly right = new Vector3(1, 0, 0);
  private readonly kickRotation = new Quaternion();
  /** Melee swing / grenade throw in progress: elapsed seconds, or −1 when idle. */
  private swingT = -1;
  private swingDir = 1;
  private swingRate = 1;
  private throwT = -1;
  private primeBlend = 0;
  /** A grenade held up with its pin pulled (set each frame by the engine). */
  primed = false;
  private readonly meleeEdge = new MeleeEdge();
  private strikeAxes: StrikeAxes | null = null;
  private readonly supportArms = new Map<string, Group>();
  /** 0..1 eased sprint pose (the gun swings across the body), so it never snaps in or out. */
  private sprintBlend = 0;
  /** 0..1 eased swimming: the weapon drops out of view and both arms take its place. */
  private swimBlend = 0;
  private swimPhase = 0;
  private readonly swimRoot = new Group();
  private swimArms: Array<{ arm: Group; toShoulder: Vector3; fist: Vector3; side: -1 | 1 }> = [];
  /** The survivor's own skinned hands (always shown, holding whatever is in hand). */
  private hands: FirstPersonHands | null = null;
  /** Per dressed model: where the support hand holds it (display space), and whether it is a pistol. */
  private readonly holds = new Map<string, { support: Vector3 | null; pistol: boolean }>();
  /** Reload in progress (seconds since it started, −1 idle) and its length. */
  private reloadT = -1;
  private readonly heldMagazine = new ReloadMagazine();
  private reloadDur = 1;
  /** Unarmed jab: seconds since it started, or −1. */
  private punchT = -1;
  /** The reload dip: smaller when the hands themselves show the magazine change. */
  private get dipScale(): number { return this.hands ? .45 : 1; }

  constructor(private readonly camera: Camera) {
    this.root.add(this.pivot);
    this.root.visible = false;
    camera.add(this.root);
    this.swimRoot.visible = false;
    camera.add(this.swimRoot);
  }

  /** Uses the survivor's skinned hands for every first-person pose (replacing the block arms). */
  setBody(assets: HumanAssets | null, look?: Appearance): void {
    this.hands?.dispose();
    this.hands = assets ? new FirstPersonHands(assets, this.camera) : null;
    if (look) this.hands?.setLook(look);
    for (const holder of this.supportArms.values()) holder.removeFromParent();
    this.supportArms.clear();
    for (const model of this.models.values()) model.getObjectByName('first-person-arm-right')?.removeFromParent();
  }

  /** The player's look on the first-person hands (skin tone, build). */
  setLook(look: Appearance): void { this.hands?.setLook(look); }

  /** Bare arms used for swimming strokes (the character's own arms, first-person scale). */
  setSwimArms(left: Object3D | null, right: Object3D | null): void {
    for (const a of this.swimArms) a.arm.removeFromParent();
    this.swimArms = [];
    for (const [source, hand, side] of [[left, 'hand_left', -1], [right, 'hand_right', 1]] as const) {
      if (!source) continue;
      const arm = firstPersonArm(source, hand, new Vector3(), new Vector3(0, 0, 1));
      const handBone = arm?.getObjectByName(hand);
      if (!arm || !handBone) continue;
      const toHand = handBone.position.clone();
      this.swimArms.push({ arm, toShoulder: toHand.clone().negate().normalize(), fist: toHand.clone().add(toHand.clone().normalize().multiplyScalar(-.1)).multiplyScalar(FP_ARM_SCALE), side });
      this.swimRoot.add(arm);
    }
  }

  /**
   * Breaststroke: hands meet in front, sweep out and back to the chest, then shoot forward again.
   * `t` is the stroke phase (0..1); each hand is posed with its forearm reaching to the shoulder.
   */
  private poseSwimArms(t: number, reach: number, rise: number): void {
    const keys: Array<[number, number, number, number]> = [
      [0, .05, -.13, -.52], [.3, .3, -.15, -.42], [.55, .17, -.27, -.24], [.8, .05, -.22, -.3], [1, .05, -.13, -.52],
    ];
    let i = 0;
    while (i < keys.length - 2 && t > keys[i + 1]![0]) i++;
    const [t0, x0, y0, z0] = keys[i]!, [t1, x1, y1, z1] = keys[i + 1]!;
    const k = ease((t - t0) / (t1 - t0));
    const hand = new Vector3(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, z0 + (z1 - z0) * k);
    // Treading water: a smaller, slower circle closer to the body.
    hand.set(hand.x * (.55 + .45 * reach), hand.y - (1 - reach) * .04, -.3 + (hand.z + .3) * (.5 + .5 * reach));
    hand.y -= rise;
    for (const a of this.swimArms) {
      const fist = new Vector3(hand.x * a.side, hand.y, hand.z);
      const shoulder = new Vector3(.24 * a.side, -.34, .12);
      a.arm.quaternion.setFromUnitVectors(a.toShoulder, shoulder.sub(fist).normalize());
      a.arm.position.copy(fist).sub(a.fist.clone().applyQuaternion(a.arm.quaternion));
    }
  }

  private readonly gripLocal = new Vector3();
  /** Each bare arm's fist on a world point (the ledge), its forearm running back to the shoulder. */
  private poseGripArms(left: Vector3, right: Vector3): void {
    this.swimRoot.updateWorldMatrix(true, false);
    for (const a of this.swimArms) {
      const fist = this.swimRoot.worldToLocal(this.gripLocal.copy(a.side < 0 ? left : right));
      const shoulder = new Vector3(.24 * a.side, -.34, .12);
      a.arm.quaternion.setFromUnitVectors(a.toShoulder, shoulder.sub(fist).normalize());
      a.arm.position.copy(fist).sub(a.fist.clone().applyQuaternion(a.arm.quaternion));
    }
  }

  set(itemId: string | null, weapons: WeaponLibrary | null, given?: Attachments): void {
    if (itemId === 'c4') itemId = 'c4_detonator';
    const attachments = withBuiltinOptic(itemId, given);
    // Each attachment combination is its own dressed model (cached).
    const key = itemId ? `${itemId}|${attachments?.optic ?? ''}|${attachments?.muzzle ?? ''}` : null;
    if (key === this.current) return;
    this.heldMagazine.clear();
    this.reloadT = -1;
    this.rig()?.mechanics.cancel();
    this.adsSpeed = attachmentModifier(attachments, 'adsSpeed');
    const optic = weaponOptic(itemId, given);
    this.eyeRelief = !optic ? (ITEM_PISTOLS.has(itemId ?? '') || ITEMS[itemId ?? '']?.category === 'pistol' ? .4 : .3) : optic.magnification && optic.magnification > 1 ? .2 : .27;
    // Studio weapons may set their own hip position and eye relief.
    const spec = itemId ? weapons?.get(itemId)?.spec : undefined;
    // The Studio's eye relief holds with iron sights and red dots alike (magnified lenses set their own below).
    if (spec?.fpEyeRelief && (optic?.magnification ?? 1) <= 1) this.eyeRelief = spec.fpEyeRelief;
    this.hip.set(...(spec?.fpHip ?? [0.2, -0.27, -0.25]));
    // With the survivor's own hands, the held item sits a little higher and further in, so the
    // hands closed round it stay in view.
    // (A hip position set in the Studio is kept as set: the Studio previews with the same hands.)
    if (this.hands && !spec?.fpHip) { this.hip.x = Math.min(this.hip.x, .17); this.hip.y = Math.max(this.hip.y, -.21); this.hip.z = Math.min(this.hip.z, -.3); }
    this.hipTilt = spec?.fpRot ?? [0, 0];
    if (this.current) this.models.get(this.current)!.visible = false;
    this.current = null;
    this.strikeAxes = null;
    this.meleeEdge.reset();
    this.aimBlend = 0;
    this.recoil.reset();
    const visual = itemId ? dressWeapon(weapons, itemId, attachments) : undefined;
    const display = visual?.display;
    if (!itemId || !key || !display || !visual) return;
    let model = this.models.get(key);
    if (!model) {
      model = display.clone(true);
      // Muzzle (+X) → camera forward (−Z).
      model.rotation.y = Math.PI / 2;
      model.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false;
        // Close to the eye the near plane cuts into the gun: its inside faces must show, or the
        // weapon looks hollow when aimed. Own copies, so models in the world stay single-sided.
        const solid = (m: Material) => { const c = m.clone(); c.side = DoubleSide; return c; };
        o.material = Array.isArray(o.material) ? o.material.map(solid) : solid(o.material);
      });
      this.pivot.add(model);
      this.models.set(key, model);
      this.rigs.set(key, { visual, mechanics: new WeaponMechanics(model, visual, itemId === 'kar98k' || itemId === 'awm' || itemId === 'remington700') });
      const support = weapons?.get(itemId)?.firstPersonSupport;
      const trigger = weapons?.get(itemId)?.firstPersonTrigger;
      const pistol = ITEM_PISTOLS.has(itemId);
      this.holds.set(key, { support: support?.contact.clone() ?? null, pistol: pistol || ITEMS[itemId]?.stance === 'pistol' });
      if (support && !this.hands) {
        // Support hand: under the handguard (rifles) or wrapped round the firing hand (pistols).
        const arm = firstPersonArm(support.arm, 'hand_left', support.contact.clone().add(new Vector3(0, -.02, 0)), pistol ? new Vector3(-.3, -.22, -.12) : new Vector3(-.35, -.13, -.16));
        if (arm) {
          const holder = new Group();
          holder.name = 'first-person-support'; holder.add(arm); model.add(holder);
          this.supportArms.set(key, holder);
        }
      }
      if (trigger && !this.hands) {
        // Firing hand on the grip, its forearm going back and down to the right.
        const arm = firstPersonArm(trigger.arm, 'hand_right', new Vector3(-.005, -.02, 0), new Vector3(-.34, -.24, .16));
        if (arm) { arm.name = 'first-person-arm-right'; model.add(arm); }
      }
    }
    // The Studio's first-person size (about the grip, the display's origin).
    model.scale.setScalar(spec?.fpScale ?? 1);
    this.baseScale = spec?.fpScale ?? 1;
    if (!this.lenses.has(key) && optic && ((optic.magnification ?? 1) > 1 || optic.reticle)) {
      const lens = opticLens(model, visual, optic.id, (optic.magnification ?? 1) > 1);
      if (lens) this.lenses.set(key, lens);
    }
    // A magnified optic is held close enough that its lens fills a comfortable part of the view.
    const lens = this.lenses.get(key);
    if (lens && (optic?.magnification ?? 1) > 1) this.eyeRelief = Math.min(.25, Math.max(.03, lens.radius / Math.tan(LENS_HALF_ANGLE)));
    model.visible = true;
    this.current = key;
    this.strikeAxes = weapons?.get(itemId)?.melee?.display ?? null;
  }

  /** Off-hand gear shares the action pivot, so its light follows its visible orientation. */
  setOffhand(itemId: string | null, weapons: WeaponLibrary | null): void {
    if (itemId === this.offhandId) return;
    this.offhandModel?.removeFromParent(); this.offhandModel = null; this.offhandId = null;
    const visual = itemId ? weapons?.get(itemId) : null;
    if (!visual) return;
    const obj = visual.display.clone(true);
    obj.name = 'first-person-offhand';
    obj.position.set(-.5, -.015, .025); obj.rotation.y = Math.PI / 2;
    if (visual.offhandArm) {
      const arm = visual.offhandArm.clone(true);
      arm.name = 'first-person-offhand-arm';
      arm.rotation.set(0, 0, 0); arm.scale.setScalar(.6);
      const hand = arm.getObjectByName('hand_left');
      if (hand) {
        arm.quaternion.setFromUnitVectors(hand.position.clone().negate().normalize(), new Vector3(-.15, -.22, 0).normalize());
        arm.position.copy(hand.position).multiplyScalar(-arm.scale.x).applyQuaternion(arm.quaternion);
        obj.add(arm);
      }
    }
    obj.traverse(o => { if (o instanceof Mesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
    obj.updateMatrix(); this.offhandBase.copy(obj.matrix);
    this.pivot.add(obj); this.offhandModel = obj; this.offhandId = itemId;
  }

  /** Points the held flashlight along the view direction. */
  aimOffhand(look: Vector3): void {
    aimOffhandLight(this.offhandModel, this.offhandBase, look);
  }

  offhandLightPose(origin: Vector3, direction: Vector3): boolean {
    return offhandLightPose(this.offhandModel, origin, direction);
  }

  /** Shows or hides the round loaded in a muzzle-loaded launcher's tube. */
  setLoaded(loaded: boolean): void {
    const round = this.current ? this.models.get(this.current)?.getObjectByName('weapon-round') : null;
    if (round) round.visible = loaded;
  }

  /** A shot: kicks the gun back and up and works its action. */
  kick(strength = 1): void {
    this.recoil.kick(strength * .065);
    this.rig()?.mechanics.fire();
  }


  private chargeSideOf = new Map<string, number>();
  /** Which side of the gun its charging handle (or AK bolt) is on: 1 right, −1 left, 0 middle / none. */
  private chargeSide(): number {
    const key = this.current ?? '';
    let side = this.chargeSideOf.get(key);
    if (side === undefined) {
      const model = this.current ? this.models.get(this.current) : undefined, mech = this.rig()?.mechanics;
      const at = mech?.partWorld(/charging|cocking/, new Vector3(), true) ?? mech?.partWorld(/^bolt$/, new Vector3(), true);
      // Display space: +X muzzle, +Y up, +Z the gun's right.
      const z = at && model ? model.worldToLocal(at.clone()).z : 0;
      side = z > .012 ? 1 : z < -.012 ? -1 : 0;
      this.chargeSideOf.set(key, side);
    }
    return side;
  }

  /** How far into the charging-handle part of a reload (0 outside, 1 in the middle of it). */
  private chargeWeight(): number {
    if (this.reloadT < 0) return 0;
    const keys = reloadScriptOf(this.rig()?.visual.itemId)?.hands.filter((k) => k.target === 'charge') ?? [];
    if (!keys.length) return 0;
    const a = keys[0]!.at - .08, b = keys[keys.length - 1]!.at + .06, r = this.reloadT / this.reloadDur;
    return r <= a || r >= b ? 0 : Math.sin(Math.PI * (r - a) / (b - a));
  }

  /** The whole reload: the gun turns its handle side up at once and holds it (0 → 1 → 0). */
  private reloadTilt(): number {
    if (this.reloadT < 0) return 0;
    const r = this.reloadT / this.reloadDur;
    return ease(Math.min(1, r / .07, (1 - r) / .1));
  }

  /** Jolts of the gun as the hands work its parts (sprung, so it feels its weight). */
  private jolt = { y: 0, z: 0, rx: 0, rz: 0, vy: 0, vz: 0, vrx: 0, vrz: 0 };
  private kickParts(from: number, to: number): void {
    const script = reloadScriptOf(this.rig()?.visual.itemId);
    if (!script || to <= from) return;
    const side = this.chargeSide() || -1, k = this.jolt;
    for (const e of script.sounds) {
      if (e.at <= from || e.at > to) continue;
      const n = e.sound.toLowerCase(), w = e.volume ?? 1;
      // Pulled out / racked back: the gun is dragged after the hand; pushed in / slapped / released:
      // it is knocked up and forward, then settles back.
      if (/casing|shelldrop|button|selector|aim|dry/.test(n)) continue;
      if (/magout|shellout|open|eject|clipout/.test(n)) { k.vy -= .55 * w; k.vrx -= 1.6 * w; }
      else if (/slap|magin|clipin|close|insert/.test(n)) { k.vy += .7 * w; k.vrx += 2.2 * w; k.vrz -= side * .8 * w; }
      else if (/rack|pull|back/.test(n)) { k.vz += .6 * w; k.vrz += side * 1.4 * w; k.vrx += .6 * w; }
      else if (/release|forward/.test(n)) { k.vz -= .7 * w; k.vrx -= 1.2 * w; }
      else { k.vy += .2 * w; k.vrx += .5 * w; }
    }
  }
  private stepKick(dt: number): void {
    const k = this.jolt, h = Math.min(dt, .05);
    // Heavy and a little underdamped: one overshoot, then still.
    const spring = (x: 'y' | 'z' | 'rx' | 'rz', v: 'vy' | 'vz' | 'vrx' | 'vrz') => { k[v] += (-170 * k[x] - 16 * k[v]) * h; k[x] += k[v] * h; };
    spring('y', 'vy'); spring('z', 'vz'); spring('rx', 'vrx'); spring('rz', 'vrz');
  }

  /** A shell-by-shell reload stopped (a shot): hands back on the gun. */
  stopReload(): void {
    this.reloadT = -1;
    this.rig()?.mechanics.cancel();
    if (this.animGame) { this.anim = null; this.animGame = false; this.animT = -1; }
  }

  /** A reload began: magazine / clip animation over its whole length. */
  reload(seconds: number): void {
    // A Hand Studio animation made for this weapon plays over the reload's length instead.
    const anim = this.studioAnim ? null : handAnimationFor(this.rig()?.visual.itemId);
    if (anim) { this.anim = anim; this.animGame = true; }
    this.rig()?.mechanics.reload(seconds, reloadScriptOf(this.rig()?.visual.itemId), !!anim);
    this.reloadT = 0;
    this.reloadDur = Math.max(.3, seconds);
  }

  /** Hand Studio animation playing: in game the weapon's reload; in the Studio a preview at a set time. */
  private anim: HandAnimation | null = null;
  private animT = -1;
  private animGame = false;
  private studioAnim = false;
  /** The Studio's first-person size of the gun in hand (an animation's gun scale multiplies it). */
  private baseScale = 1;

  /** Studio: shows an animation at a share `t` of its length (null: none, back to the game's own poses). */
  previewAnimation(anim: HandAnimation | null, t = 0): void {
    this.studioAnim = !!anim;
    this.anim = anim; this.animGame = false;
    this.animT = anim ? Math.min(1, Math.max(0, t)) : -1;
  }

  /** The gun in hand's moving parts and clips (Studio track choices). */
  get studioParts(): { parts: string[]; clips: string[] } {
    const m = this.rig()?.mechanics;
    return { parts: m?.partNames ?? [], clips: m?.clipNames ?? [] };
  }

  /** The gun in view (Studio: hand positions are captured in its frame). */
  get gunModel(): Group | null { return this.current ? this.models.get(this.current) ?? null : null; }
  /** The first-person arms (Studio: the hand bones shown and turned). */
  get firstPersonHands(): FirstPersonHands | null { return this.hands; }

  /** A hand bone's place and turn on the gun right now (gun metres, degrees): a Studio key from the current pose. */
  handOnGun(side: 'L' | 'R'): { pos: [number, number, number]; rot: [number, number, number] } | null {
    const model = this.gunModel, hand = this.hands?.rig.handBones(side).hand;
    if (!model || !hand) return null;
    model.updateWorldMatrix(true, false); hand.updateWorldMatrix(true, false);
    const p = new Vector3(), q = new Quaternion(), sc = new Vector3(), gq = new Quaternion();
    hand.matrixWorld.decompose(p, q, sc);
    model.matrixWorld.decompose(new Vector3(), gq, sc);
    const local = model.worldToLocal(p), e = new Euler().setFromQuaternion(gq.invert().multiply(q), 'XYZ');
    const r4 = (v: number) => Math.round(v * 10000) / 10000;
    return { pos: [r4(local.x), r4(local.y), r4(local.z)], rot: [e.x, e.y, e.z].map((v) => Math.round(v * 1800 / Math.PI) / 10) as [number, number, number] };
  }

  private get animOn(): boolean { return !!this.anim && this.animT >= 0; }

  /** Empty hands: a quick jab with the right fist. */
  punch(): void { this.punchT = 0; }

  /** Aimed through sights that line up with the screen centre (red dot / iron sights). */
  /** The current optic's lens (magnified optics only). */
  get lens(): OpticLens | null { return this.current ? this.lenses.get(this.current) ?? null : null; }

  /** The first-person gun and arms, to leave out of the scope image. */
  get object(): Object3D { return this.root; }
  /** Everything of the first-person view in front of the eye (gun and arms): left out of a scope's picture. */
  get scopeHidden(): Object3D[] { return [this.root, this.swimRoot, ...(this.hands ? [this.hands.holder] : [])]; }

  get aimed(): number { return this.aimBlend; }

  private rig() { return this.current ? this.rigs.get(this.current) : undefined; }

  weaponPoint(point: 'muzzle' | 'eject', out: Vector3): boolean {
    const marker = this.current ? this.models.get(this.current)?.getObjectByName(`weapon-${point}`) : null;
    if (!marker || !this.root.visible) return false;
    marker.getWorldPosition(out);
    return true;
  }

  weaponBore(origin: Vector3, direction: Vector3): boolean {
    if (!this.weaponPoint('muzzle', origin) || !this.current || !this.rig()?.visual.aim) return false;
    // Display models are fitted with their bore along +X, including muzzle attachments.
    const model = this.models.get(this.current)!;
    model.updateWorldMatrix(true, false);
    direction.set(1, 0, 0).transformDirection(model.matrixWorld);
    return true;
  }

  /** Converge the actual barrel on the crosshair, including camera rotation and tumble. */
  aimAt(worldTarget: Vector3): void {
    if (!this.current || this.aimBlend < 0.001) return;
    // Guns with a sight line are aimed by lining the sights up with the eye instead (update()).
    if (this.rig()?.visual.sight) return;
    this.root.worldToLocal(this.target.copy(worldTarget));
    this.direction.copy(this.target).normalize();
    this.aimRotation.setFromUnitVectors(this.forward, this.direction);
    const marker = this.models.get(this.current)?.getObjectByName('weapon-muzzle');
    if (marker) {
      const model = this.models.get(this.current)!;
      model.updateMatrix();
      // The bore can sit above the grip; account for that offset when converging.
      for (let i = 0; i < 3; i++) {
        this.direction.copy(marker.position).applyMatrix4(model.matrix).applyQuaternion(this.aimRotation);
        this.direction.subVectors(this.target, this.direction).normalize();
        this.aimRotation.setFromUnitVectors(this.forward, this.direction);
      }
    }
    // Convergence must retain the visible muzzle lift, including during sustained fire.
    this.aimRotation.multiply(this.kickRotation.setFromAxisAngle(this.right, this.recoil.offset));
    this.pivot.quaternion.slerp(this.aimRotation, this.aimBlend);
  }

  /** Studio: the reload frozen at a fraction of its length (hands at that action), or released. */
  private reloadHold: number | null = null;
  holdReload(at: number | null): void {
    this.reloadHold = at;
    if (at === null) { this.reloadT = -1; this.rig()?.mechanics.cancel(); return; }
    if (this.reloadT < 0) this.reload(2.2);
    this.reloadT = at * this.reloadDur;
  }

  /** Studio preview: start a swing / a reload on demand. */
  preview(action: 'swing' | 'reload'): void {
    if (action === 'swing') this.swing(1);
    else this.reload(2.2);
  }

  /** Melee: wind up over the shoulder, then a fast diagonal cut; variants alternate sides. */
  swing(variant: number, durationMs?: number): void {
    this.meleeEdge.reset();
    this.swingRate = durationMs ? 460 / durationMs : 1;
    this.swingT = 0;
    this.swingDir = variant % 2 === 0 ? -1 : 1;
  }

  /** Grenade: pull back, overarm release (the grenade leaves the hand), then a fresh one comes up. */
  throw(): void {
    this.throwT = 0;
  }

  update(dt: number, s: { visible: boolean; moving: boolean; sprint: boolean; reloading: boolean; yaw: number; pitch: number; firing?: boolean; aiming?: boolean; swimming?: boolean; rolling?: boolean; mantle?: { left: Vector3; right: Vector3 } | null }): void {
    this.rollBlend += ((s.rolling ? 1 : 0) - this.rollBlend) * (1 - Math.exp(-dt * 12));
    // Mantling: both hands come up onto the ledge and stay planted on it while the view rises.
    if (this.hands) this.hands.visible = s.visible;
    if (this.reloadHold !== null) this.reloadT = this.reloadHold * this.reloadDur;
    else if (this.reloadT >= 0) {
      const from = this.reloadT / this.reloadDur;
      if ((this.reloadT += dt) > this.reloadDur) this.reloadT = -1;
      if (!this.animGame) this.kickParts(from, this.reloadT < 0 ? 1 : this.reloadT / this.reloadDur);
    }
    this.stepKick(dt);
    if (this.animGame) {
      if (this.reloadT >= 0) this.animT = this.reloadT / this.reloadDur;
      else { this.anim = null; this.animGame = false; this.animT = -1; }
    }
    if (this.punchT >= 0 && (this.punchT += dt) > .36) this.punchT = -1;
    if (s.mantle && s.visible && this.hands) {
      this.root.visible = false;
      this.swimRoot.visible = false;
      const m = s.mantle;
      this.hands.request(() => this.ledgeHands(m.left, m.right));
      return;
    }
    if (s.mantle && s.visible && this.swimArms.length) {
      this.root.visible = false;
      this.swimRoot.visible = true;
      this.poseGripArms(s.mantle.left, s.mantle.right);
      return;
    }
    // Swimming: the weapon sinks out of view while the swimming arms come up, and back again.
    this.swimBlend += ((s.swimming ? 1 : 0) - this.swimBlend) * (1 - Math.exp(-dt * 6));
    const swim = this.swimBlend;
    this.swimPhase = (this.swimPhase + dt * (s.moving ? .9 : .45)) % 1;
    this.swimRoot.visible = s.visible && swim > .02 && this.swimArms.length > 0;
    if (this.swimRoot.visible) this.poseSwimArms(this.swimPhase, s.moving ? 1 : 0, (1 - ease(swim)) * .45);
    this.root.visible = s.visible && (this.current !== null || this.offhandId !== null) && swim < .98;
    this.sprintBlend += ((s.sprint && s.moving && !s.swimming && !s.aiming && !s.firing && !s.reloading ? 1 : 0) - this.sprintBlend) * (1 - Math.exp(-dt * 7));
    const sprinting = this.sprintBlend;
    const aiming = !s.reloading && !s.swimming && s.aiming ? 1 : 0;
    this.aimBlend += (aiming - this.aimBlend) * (1 - Math.exp(-dt * (aiming ? 14 * this.adsSpeed : 12)));
    const rig = this.rig();
    rig?.mechanics.update(dt);
    if (this.animOn && rig) {
      // The animation's part tracks: a part's own clip played to a point, or moved and turned.
      const gun = this.gunModel;
      for (const tr of this.anim!.tracks) if (tr.kind === 'part' && gun) {
        rig.mechanics.drive(tr.part, tr.clip, sampleClip(tr, this.animT), samplePos(tr, this.animT), sampleRot(tr, this.animT), gun);
      }
    }
    // Look sway: the gun lags slightly behind fast turns.
    let dyaw = s.yaw - this.lastYaw;
    dyaw -= Math.PI * 2 * Math.round(dyaw / (Math.PI * 2));
    const dpitch = s.pitch - this.lastPitch;
    this.lastYaw = s.yaw;
    this.lastPitch = s.pitch;
    const k = 1 - Math.exp(-dt * 10);
    this.swayX += (Math.max(-0.06, Math.min(0.06, dyaw * 0.6)) - this.swayX) * k;
    this.swayY += (Math.max(-0.05, Math.min(0.05, -dpitch * 0.6)) - this.swayY) * k;
    // Walk bob.
    // Bob grows and quickens continuously with the sprint blend: no jump between gaits.
    const targetBob = s.moving && !s.swimming ? 1 + .6 * sprinting : 0;
    this.bobAmount += (targetBob - this.bobAmount) * (1 - Math.exp(-dt * 6));
    // About 2.5 steps/s walking, 3.5 sprinting (two dips per bob cycle).
    this.bobSpeed += ((s.moving ? 8 + 3 * sprinting : 2.7) - this.bobSpeed) * (1 - Math.exp(-dt * 5));
    this.bobPhase += dt * this.bobSpeed;
    const bx = Math.sin(this.bobPhase) * 0.012 * this.bobAmount;
    const by = -Math.abs(Math.cos(this.bobPhase)) * 0.012 * this.bobAmount;
    let ax = 0, ay = 0, az = 0, rx = 0, ry = 0, rz = 0;
    // Recoil springs back; reload lowers the gun.
    this.recoil.update(dt);
    this.dip += ((s.reloading && !this.animGame ? 1 : 0) - this.dip) * (1 - Math.exp(-dt * 9));
    const sprintTilt = ease(sprinting);
    ay -= sprintTilt * .1;
    rx -= sprintTilt * .35;

    // Action offsets: position (x, y, z) and rotation (pitch, yaw, roll).
    if (this.swingT >= 0) {
      this.swingT += dt * this.swingRate;
      const d = this.swingDir;
      const WIND = 0.12, CUT = 0.14, BACK = 0.2;
      const t = this.swingT;
      if (t < WIND) {
        const k = ease(t / WIND);
        ax = 0.12 * k * d; ay = 0.14 * k; rx = 0.9 * k; ry = -0.5 * k * d; rz = -0.6 * k * d;
      } else if (t < WIND + CUT) {
        const k = ease((t - WIND) / CUT);
        ax = (0.12 - 0.42 * k) * d; ay = 0.14 - 0.3 * k; az = -0.12 * Math.sin(k * Math.PI);
        rx = 0.9 - 2.0 * k; ry = (-0.5 + 1.4 * k) * d; rz = (-0.6 + 1.5 * k) * d;
      } else if (t < WIND + CUT + BACK) {
        const k = 1 - ease((t - WIND - CUT) / BACK);
        ax = -0.3 * k * d; ay = -0.16 * k; rx = -1.1 * k; ry = 0.9 * k * d; rz = 0.9 * k * d;
      } else this.swingT = -1;
    }
    let hidden = false;
    // Pin pulled: the grenade raised and drawn back, ready to throw.
    this.primeBlend += ((this.primed && this.throwT < 0 ? 1 : 0) - this.primeBlend) * (1 - Math.exp(-dt * 10));
    if (this.throwT < 0 && this.primeBlend > .001) { const k = ease(this.primeBlend); ax += .06 * k; ay += .2 * k; az += .16 * k; rx += 1.0 * k; rz -= .3 * k; }
    // Reloading: from the first moment the gun rolls its handle's side up (handle on the right:
    // tilted left; on the left: tilted right), a little more and higher while the handle is worked;
    // each part pulled, pushed or racked jolts it on its spring.
    const tilt = this.animGame ? 0 : this.reloadTilt(), charging = this.animGame ? 0 : this.chargeWeight();
    if (tilt > 0 || charging > 0) { const side = this.chargeSide() || -1; ay += .05 * tilt + .06 * charging; rx += .06 * tilt + .07 * charging; rz += side * (.3 * tilt + .1 * charging); ax -= side * .03 * tilt; }
    { const k = this.jolt; ay += k.y * .05; az += k.z * .05; rx += k.rx * .05; rz += k.rz * .05; }
    // The animation's gun track: moved (camera metres), turned (degrees) and sized.
    let animScale = 1;
    if (this.animOn) for (const tr of this.anim!.tracks) if (tr.kind === 'gun') {
      const p = samplePos(tr, this.animT), q = sampleRot(tr, this.animT);
      if (p) { ax += p.x; ay += p.y; az += p.z; }
      if (q) { const e = new Euler().setFromQuaternion(q, 'XYZ'); rx += e.x; ry += e.y; rz += e.z; }
      animScale *= sampleScale(tr, this.animT) ?? 1;
    }
    if (this.throwT >= 0) {
      this.throwT += dt;
      const t = this.throwT;
      const PULL = 0.22, RELEASE = 0.12, GONE = 0.28, RAISE = 0.2;
      if (t < PULL) {
        const k = ease(t / PULL);
        ax = 0.06 * k; ay = 0.2 * k; az = 0.16 * k; rx = 1.0 * k; rz = -0.3 * k;
      } else if (t < PULL + RELEASE) {
        const k = ease((t - PULL) / RELEASE);
        ax = 0.06 - 0.1 * k; ay = 0.2 - 0.12 * k; az = 0.16 - 0.5 * k; rx = 1.0 - 1.8 * k; rz = -0.3 + 0.3 * k;
        hidden = k > 0.6;
      } else if (t < PULL + RELEASE + GONE) {
        hidden = true;
      } else if (t < PULL + RELEASE + GONE + RAISE) {
        const k = 1 - ease((t - PULL - RELEASE - GONE) / RAISE);
        ay = -0.25 * k; rx = -0.6 * k;
      } else this.throwT = -1;
    }
    if (hidden) this.root.visible = false;

    // Lowered while swimming (the weapon slung down out of view).
    ay -= ease(swim) * .5; rx -= ease(swim) * .9;
    const relaxed = 1 - this.aimBlend;
    const cant = rig?.mechanics.cant ?? 0, lift = rig?.mechanics.lift ?? 0;
    const supportArm = this.current ? this.supportArms.get(this.current) : null;
    if (supportArm) supportArm.visible = !s.reloading && !this.offhandId;
    const model = this.current ? this.models.get(this.current) : null;
    if (model && !this.strikeAxes) model.scale.setScalar(this.baseScale * animScale);
    const sight = rig?.visual.sight;
    if (sight && model) {
      // Hip pose, then the sight picture: rotate so the rear→front sight line runs straight down
      // the view axis and move the rear sight (or the optic's eyepiece) onto the eye.
      model.updateMatrix();
      this.root.position.set(this.hip.x + this.swayX + bx + ax, this.hip.y + this.swayY + by - this.dip * 0.12 * this.dipScale + ay + lift, this.hip.z + this.recoil.offset * .6 + az);
      this.hipQuat.setFromEuler(this.euler.set(this.hipTilt[0] + this.recoil.offset - this.dip * 0.5 * this.dipScale - sprintTilt * 0.25 + rx, this.hipTilt[1] + this.swayX * 1.5 + sprintTilt * 0.5 + ry, -this.swayX * 0.8 + this.dip * 0.3 * this.dipScale + rz + cant));
      this.rear.copy(sight.rear).applyMatrix4(model.matrix);
      this.front.copy(sight.front).applyMatrix4(model.matrix);
      this.adsQuat.setFromUnitVectors(this.direction.subVectors(this.front, this.rear).normalize(), this.forward);
      this.adsPos.copy(this.rear).applyQuaternion(this.adsQuat).negate();
      this.adsPos.z -= this.eyeRelief;
      // Recoil still shows through the sights: a little climb and push back, then recovery.
      this.adsPos.z += this.recoil.offset * .35; this.adsPos.y += lift;
      this.adsQuat.premultiply(this.kickRotation.setFromAxisAngle(this.right, this.recoil.offset * .6));
      if (cant) this.adsQuat.premultiply(this.kickRotation.setFromAxisAngle(this.forward, -cant));
      this.root.position.lerp(this.adsPos, this.aimBlend);
      this.pivot.quaternion.copy(this.hipQuat).slerp(this.adsQuat, this.aimBlend);
    } else {
      this.root.position.set((this.hip.x + this.swayX + bx) * relaxed + ax, this.hip.y + this.aimBlend * 0.02 + (this.swayY + by) * relaxed - this.dip * 0.12 * this.dipScale + ay + lift, this.hip.z - this.aimBlend * .18 + this.recoil.offset * .6 + az);
      this.pivot.rotation.set(this.hipTilt[0] * relaxed + this.recoil.offset - this.dip * 0.5 * this.dipScale - sprintTilt * 0.25 + rx, this.hipTilt[1] * relaxed + this.swayX * 1.5 + sprintTilt * 0.5 + ry, -this.swayX * 0.8 + this.dip * 0.3 * this.dipScale + rz + cant);
    }
    if (model && this.strikeAxes) {
      model.rotation.set(0, Math.PI / 2, 0);
      // Carried blades and clubs sway with the running steps (not during a swing).
      if (this.swingT < 0 && this.bobAmount > .01) {
        const b = this.bobAmount, ph = this.bobPhase;
        this.root.position.x += Math.sin(ph) * .022 * b; this.root.position.y -= Math.abs(Math.cos(ph)) * .02 * b;
        this.pivot.rotation.z += Math.sin(ph) * .07 * b; this.pivot.rotation.x += Math.abs(Math.cos(ph)) * .05 * b;
      }
      if (this.swingT >= 0) this.meleeEdge.pose(model, this.strikeAxes, this.root.parent!);
      else this.meleeEdge.rest(model, this.strikeAxes);
    }
    if (this.hands && s.visible) {
      const swimming = swim > .5, moving = s.moving, phase = this.bobPhase, bob = this.bobAmount;
      const thrown = hidden;
      // Guns with their own reload script move the hands by it (not the recorded rifle reload).
      const rifleReload = !!model && !swimming && !thrown && !this.animGame && usesRifleReload(this.rig()?.visual.itemId) && !reloadScriptOf(this.rig()?.visual.itemId);
      this.hands.setReload(rifleReload ? this.reloadT : -1, this.reloadDur);
      this.hands.request(() => (swimming ? this.swimHands() : this.heldHands(model ?? null, thrown, moving, phase, bob)), () => {
        this.heldMagazine.update(model ?? null, rifleReload && this.reloadT >= 0 ? this.reloadT / this.reloadDur : -1, this.hands!.palmMatrix('L'));
      });
    }
  }

  private rollBlend = 0;

  /**
   * The animation's hand tracks: each hand placed on the gun (on a part when the key names one,
   * following it), turned as keyed or only reaching there, its fingers turning between poses.
   * A hand without a track keeps the game's own hold.
   */
  private animHands(model: Group, out: { L: FpHand; R: FpHand }): void {
    const t = this.animT, mech = this.rig()?.mechanics, hold = this.current ? this.holds.get(this.current) : undefined;
    const gunQ = new Quaternion(); model.updateWorldMatrix(true, false); model.matrixWorld.decompose(new Vector3(), gunQ, new Vector3());
    const place = (k: HandKey): Vector3 | null => {
      if (!k.pos) return null;
      const node = k.part ? mech?.partNode(k.part) : null;
      if (!node) return model.localToWorld(new Vector3(...k.pos));
      node.updateWorldMatrix(true, false);
      return model.localToWorld(model.worldToLocal(node.getWorldPosition(new Vector3())).add(new Vector3(...k.pos)));
    };
    const animated = { L: false, R: false };
    for (const side of ['L', 'R'] as const) {
      const tr = this.anim!.tracks.find((x) => x.kind === (side === 'L' ? 'handL' : 'handR') && x.keys.length);
      if (!tr) continue;
      const at = sampleHandPoint(tr, t, place), turn = sampleRot(tr, t), pose = samplePose(tr, t);
      if (!at) continue;
      const preset = pose?.a ?? 'relaxed', to = pose?.b, u = pose?.u ?? 0;
      out[side] = turn ? { target: new Matrix4().compose(at, gunQ.clone().multiply(turn), new Vector3(1, 1, 1)), preset, to, u } : { palm: at, preset, to, u };
      animated[side] = true;
    }
    const R = out.R;
    // The recorded two-handed hold keeps the right arm; an animated left hand leaves it.
    if (animated.L && R && 'rifle' in R) R.rifle.support = null;
    // The right hand animated off the grip: the left (when not animated) holds the handguard.
    if (animated.R && !animated.L && !out.L && hold?.support) {
      out.L = { grasp: { center: model.localToWorld(hold.support.clone()), axis: new Vector3(1, 0, 0).transformDirection(model.matrixWorld), approach: new Vector3(0, 1, .35).normalize().transformDirection(model.matrixWorld), radius: .021 } };
    }
  }

  /**
   * First-person head bob in step with the run (metres / radians, camera space): a dip on each
   * footfall, a slight sideways sway and roll; mostly steadied while aiming down the sights.
   */
  get headBob(): { x: number; y: number; roll: number } {
    const b = this.bobAmount * (1 - .8 * this.aimBlend), ph = this.bobPhase;
    return { x: Math.sin(ph) * .012 * b, y: -Math.abs(Math.cos(ph)) * .03 * b, roll: Math.sin(ph) * .006 * b };
  }

  /** Both palms over a ledge (mantling), fingers curled round its edge. */
  private ledgeHands(left: Vector3, right: Vector3): { L: FpHand; R: FpHand } {
    const fwd = new Vector3(0, 0, -1).transformDirection(this.camera.matrixWorld).setY(0).normalize();
    const side = new Vector3(-fwd.z, 0, fwd.x);
    const approach = fwd.clone().multiplyScalar(.35).add(new Vector3(0, -1, 0)).normalize();
    return {
      L: { grasp: { center: left.clone().add(new Vector3(0, -.015, 0)), axis: side.clone(), approach, radius: .02 } },
      R: { grasp: { center: right.clone().add(new Vector3(0, -.015, 0)), axis: side.clone().negate(), approach: approach.clone(), radius: .02 } },
    };
  }

  /** Breaststroke: open hands sweeping round in front (the swim stroke's hand path). */
  private swimHands(): { L: FpHand; R: FpHand } {
    const t = this.swimPhase;
    const keys: Array<[number, number, number, number]> = [[0, .05, -.13, -.52], [.3, .3, -.15, -.42], [.55, .17, -.27, -.24], [.8, .05, -.22, -.3], [1, .05, -.13, -.52]];
    let i = 0;
    while (i < keys.length - 2 && t > keys[i + 1]![0]) i++;
    const [t0, x0, y0, z0] = keys[i]!, [t1, x1, y1, z1] = keys[i + 1]!;
    const k = ease((t - t0) / (t1 - t0));
    const at = (side: number) => this.camera.localToWorld(new Vector3((x0 + (x1 - x0) * k) * side, y0 + (y1 - y0) * k, z0 + (z1 - z0) * k));
    return { L: { palm: at(-1), preset: 'open' }, R: { palm: at(1), preset: 'open' } };
  }

  /**
   * Hands on what is held: the firing hand on the grip (or a blade's handle), the other on the
   * handguard or cupping the firing hand; during a reload the support hand swaps the magazine;
   * empty hands rest low in view, swinging with the steps, and jab when punching.
   */
  private heldHands(model: Group | null, thrown: boolean, moving: boolean, phase: number, bob: number): { L: FpHand; R: FpHand } {
    const cam = (x: number, y: number, z: number) => this.camera.localToWorld(new Vector3(x, y, z));
    const out: { L: FpHand; R: FpHand } = { L: null, R: null };
    const hold = this.current ? this.holds.get(this.current) : undefined;
    if (model && !thrown) {
      model.updateWorldMatrix(true, false);
      const W = (x: number, y: number, z: number) => model.localToWorld(new Vector3(x, y, z));
      const D = (x: number, y: number, z: number) => new Vector3(x, y, z).transformDirection(model.matrixWorld);
      const strike = this.strikeAxes;
      if (strike) {
        // A blade or club: the handle runs along the display's +X, the palm on its right.
        const axis = D(strike.axis.x, strike.axis.y, strike.axis.z);
        const approach = D(0, 0, -1);
        approach.addScaledVector(axis, -approach.dot(axis)).normalize();
        out.R = { grasp: { center: model.localToWorld(strike.grip.clone()), axis, approach, radius: .016 } };
        if (hold?.support) out.L = { grasp: { center: model.localToWorld(hold.support.clone()), axis: axis.clone(), approach: approach.clone(), radius: .016 } };
      } else if (this.rig()?.visual.aim || this.rig()?.visual.muzzle || hold?.support) {
        const basis = !hold?.pistol ? this.hands?.rifleGripBasis('R') : null;
        const supportBasis = !hold?.pistol ? this.hands?.rifleGripBasis('L') : null;
        const handle = basis ? D(basis.axis.x, basis.axis.y, basis.axis.z) : D(.34, .94, 0);
        const fp = this.rig()?.visual.spec;
        this.hands?.setShapes(fp?.fpHands?.shapes ?? null);
        const shift = fp?.fpGrip ?? [0, 0, 0];
        const grip: Grasp = fitGripProfile(model, { center: W(shift[0], shift[1], shift[2]), axis: handle, approach: basis ? D(basis.approach.x, basis.approach.y, basis.approach.z) : D(.35, 0, -1).normalize(), radius: this.rig()?.visual.spec?.gripRadius ?? .017, trigger: true });
        out.R = { grasp: grip };
        const guard: Grasp | null = hold?.pistol
          ? { center: W(-.004, -.032, -.032), axis: handle.clone(), approach: D(0, .25, 1).normalize(), radius: .03 }
          : hold?.support ? { center: model.localToWorld(hold.support.clone()), axis: supportBasis ? D(supportBasis.axis.x, supportBasis.axis.y, supportBasis.axis.z) : D(1, 0, 0), approach: supportBasis ? D(supportBasis.approach.x, supportBasis.approach.y, supportBasis.approach.z) : D(0, 1, .35).normalize(), radius: this.rig()?.visual.spec?.supportRadius ?? .021 } : null;
        out.L = guard ? { grasp: fitGripProfile(model, guard) } : null;
        const r = this.reloadT >= 0 ? this.reloadT / this.reloadDur : -1;
        const recordedReload = !!this.hands?.recordedReload;
        // Long guns: both arms from the recorded rifle hold, the gun in the recorded firing hand.
        if (!hold?.pistol && hold?.support) {
          const spec = this.rig()?.visual.spec;
          // The support hand rides the pump's fore-end as it is racked.
          const shift = this.rig()?.mechanics.supportShift(new Vector3());
          const support = shift && shift.lengthSq() > 0 ? model.worldToLocal(model.localToWorld(hold.support.clone()).add(shift)) : hold.support.clone();
          out.R = { rifle: { model, key: this.current ?? '', support, gripRadius: spec?.gripRadius, supportRadius: spec?.supportRadius, ...(spec?.fpGrip ? { grip: new Vector3(...spec.fpGrip) } : {}) } };
          // The support hand is placed with the arms; a non-recorded reload overrides it below.
          out.L = null;
        }
        // A bolt action worked after the shot: the right hand on the bolt handle, following it.
        const worked = this.rig()?.mechanics;
        if (worked?.boltWorked && hold?.support && guard && this.reloadT < 0) {
          const bolt = worked.partWorld(/bolt-handle/, new Vector3()) ?? worked.partWorld(/^bolt$|bolt-carriage/, new Vector3());
          if (bolt) { out.R = { palm: bolt, preset: 'pinch' }; out.L = { grasp: fitGripProfile(model, guard) }; }
        }
        const script = reloadScriptOf(this.rig()?.visual.itemId);
        if (guard && !recordedReload && script && !this.animGame && r > .01 && r < .99) {
          // The gun's own reload: each hand goes to the part it works (followed while that part
          // moves), a pouch below the view, or back to the handguard.
          const reach = hold?.support ?? new Vector3(.2, -.03, 0);
          const mech = this.rig()?.mechanics;
          const part = (re: RegExp, rest = false) => mech?.partWorld(re, new Vector3(), rest) ?? null;
          // Studio: each action's hand shift (model metres) and shape.
          const actions = fp?.fpHands?.actions;
          const at = (target: HandTarget): Vector3 => {
            const p = place(target), off = actions?.[target]?.offset;
            return off ? model.localToWorld(model.worldToLocal(p).add(new Vector3(...off))) : p;
          };
          const place = (target: HandTarget): Vector3 => {
            switch (target) {
              case 'guard': return guard.center.clone();
              case 'grip': return W(0, -.02, 0);
              case 'pouch': return cam(-.13, -.56, -.26);
              case 'mag': return part(/^(magazine|mag|ammo-box)$/) ?? W(reach.x * .3, -.1, 0);
              case 'magwell': return part(/^(magazine|mag|ammo-box)$/, true) ?? W(reach.x * .3, -.08, 0);
              case 'charge': return part(/charging|cocking/) ?? part(/^bolt$/) ?? W(.03, .045, .045);
              case 'bolt': return part(/bolt-handle/) ?? part(/^bolt$|bolt-carriage/) ?? W(-.02, .03, .045);
              case 'slide': return part(/slide/) ?? W(-.03, .04, 0);
              case 'pump': return part(/pump/) ?? guard.center.clone();
              case 'breech': return part(/barrels?__pivot|breech|hammer/) ?? W(.02, .02, 0);
              case 'cylinder': return part(/^cylinder$/) ?? W(.04, .01, 0);
              case 'port': return part(/^(magazine|mag)$/, true) ?? W(reach.x * .3, -.05, 0);
              case 'feed': return part(/feed-cover/) ?? W(.05, .06, 0);
              case 'muzzle': return model.getObjectByName('weapon-muzzle')?.getWorldPosition(new Vector3()) ?? W(.6, 0, 0);
            }
          };
          // A charging handle on the right of the gun (AK) is worked by the right hand; the left
          // one (and a central T-handle) by the left.
          const rightCharge = this.chargeSide() > 0;
          const hands = script.hands.map((k) => (k.target === 'charge' && rightCharge ? { ...k, side: 'R' as const } : k));
          const track = (side: 'L' | 'R') => {
            const keys = hands.filter((k) => k.side === side);
            if (!keys.length) return null;
            if (side === 'R') {
              // The right hand leaves the grip just for its moves and goes back to it.
              const first = keys[0]!.at, last = keys[keys.length - 1]!.at;
              if (r < first - .08 || r > last + .08) return null;
              keys.unshift({ at: first - .08, side, target: 'grip', shape: 'fist' }); keys.push({ at: last + .08, side, target: 'grip', shape: 'fist' });
            }
            if (side === 'L' && keys[keys.length - 1]!.at < 1) keys.push({ at: 1, side, target: 'guard', shape: 'ready' });
            if (keys[0]!.at > 0) keys.unshift({ at: 0, side, target: 'guard', shape: 'ready' });
            let i = 0;
            while (i < keys.length - 2 && r > keys[i + 1]!.at) i++;
            const k0 = keys[i]!, k1 = keys[i + 1] ?? k0;
            const u = k1 === k0 ? 1 : ease(Math.min(1, Math.max(0, (r - k0.at) / Math.max(1e-3, k1.at - k0.at))));
            const k = u < .5 ? k0 : k1;
            return { palm: at(k0.target).lerp(at(k1.target), u), preset: actions?.[k.target]?.shape ?? k.shape };
          };
          const left = track('L'), right = track('R');
          if (right) { out.R = right; out.L = left ?? { grasp: fitGripProfile(model, guard) }; }
          else if (left) out.L = left;
        } else if (guard && !recordedReload && !this.animGame && r > .04 && r < .97) {
          // Magazine change: down to the magazine, pull it, a fresh one from below the view, in,
          // a slap, then the charging handle, and back to the handguard.
          const reach = hold?.support ?? new Vector3(.2, -.03, 0);
          const mag = W(reach.x * .3, -.08, 0), out1 = cam(-.14, -.62, -.2), rack = W(.03, .045, .045);
          const keys: Array<[number, Vector3, 'fist' | 'open' | 'pinch' | 'ready']> = [
            [0, guard.center, 'ready'], [.12, mag, 'fist'], [.26, mag.clone().add(D(0, -.14, 0)), 'fist'], [.42, out1, 'fist'], [.5, out1, 'fist'],
            [.64, mag.clone().add(D(0, -.13, 0)), 'fist'], [.72, mag, 'fist'], [.76, mag.clone().add(D(0, .014, 0)), 'open'],
            [.84, rack, 'pinch'], [.9, rack.clone().add(D(-.07, 0, 0)), 'pinch'], [.95, rack, 'pinch'], [1, guard.center, 'ready'],
          ];
          let i = 0;
          while (i < keys.length - 2 && r > keys[i + 1]![0]) i++;
          const [t0, p0] = keys[i]!, [t1, p1, preset] = keys[i + 1]!;
          out.L = { palm: p0.clone().lerp(p1, ease((r - t0) / (t1 - t0))), preset };
        }
      } else {
        // Grenades, tools, the detonator: closed round in the right hand.
        out.R = { palm: W(0, 0, 0), preset: 'fist' };
      }
    } else if (thrown) {
      out.R = { palm: cam(.2, -.2, -.5), preset: 'open' };
    }
    if (model && !thrown && this.animOn) this.animHands(model, out);
    // Running: the arms pump forward and back in opposite phase, lifting a little on each step.
    // (Kept small: at a sprint the bob grows, and a free hand swinging far looks loose.)
    const swing = moving ? Math.sin(phase) * Math.min(1, bob) : 0, lift = moving ? Math.abs(Math.cos(phase)) * Math.min(1, bob) : 0;
    if (!out.R && !model) {
      // Empty hands: low in view, swinging with each step; a jab when punching.
      const p = this.punchT >= 0 ? Math.sin(Math.min(1, this.punchT / .36) * Math.PI) : 0;
      out.R = { palm: cam(.2 - .14 * p, -.3 + .14 * p + .015 * lift, -.42 - .045 * swing - .28 * p), preset: p > .05 ? 'fist' : moving ? 'ready' : 'relaxed' };
      // The other hand draws back as the punch goes out.
      if (!this.offhandModel) out.L = { palm: cam(-.2 + .03 * p, -.3 + .015 * lift, -.42 + .045 * swing + .08 * p), preset: p > .05 ? 'fist' : moving ? 'ready' : 'relaxed' };
    }
    // Both hands always in view: a free hand rests low at its side of the view.
    if (!out.R && !this.offhandModel && model) out.R = { palm: cam(.17, -.22, -.4), preset: 'relaxed' };
    const rifleHeld = !!out.R && 'rifle' in out.R;
    if (!out.L && !rifleHeld && !this.offhandModel && !(this.reloadT >= 0)) {
      // The free hand rests low at the side of the view, swings with the steps and pulls back
      // against a swing (the body's counter-rotation).
      const cut = this.swingT >= 0 ? Math.sin(Math.min(1, this.swingT / .46) * Math.PI) : 0;
      out.L = { palm: cam(-.28 + .05 * cut, -.29 + .015 * lift - .04 * cut, -.42 + .04 * swing + .12 * cut), preset: moving || cut > .1 ? 'ready' : 'relaxed' };
    }
    if (this.rollBlend > .01) {
      // Rolling: the hands tuck in low towards the chest.
      const k = ease(this.rollBlend);
      for (const side of ['L', 'R'] as const) {
        const h = out[side];
        if (h && 'palm' in h) h.palm.lerp(cam(side === 'L' ? -.12 : .12, -.45, -.25), k);
      }
    }
    if (this.offhandModel) {
      const off = this.offhandModel;
      off.updateWorldMatrix(true, false);
      out.L = { grasp: { center: off.localToWorld(new Vector3()), axis: new Vector3(1, 0, 0).transformDirection(off.matrixWorld), approach: new Vector3(0, 0, 1).transformDirection(off.matrixWorld), radius: .018 } };
    }
    return out;
  }

  dispose(): void {
    this.heldMagazine.clear();
    this.root.removeFromParent();
    this.swimRoot.removeFromParent();
    this.hands?.dispose();
  }
}

/** Scale of the character's chunky arm in the first-person view (its fist ≈ a real hand). */
const FP_ARM_SCALE = .5;

/**
 * One first-person arm: the character's arm at reduced, natural proportions (never stretched),
 * oriented along `back` (from the hand toward an off-screen shoulder) with the centre of its fist
 * at `fist`, so fingers lie along the gun instead of reaching over it.
 */
function firstPersonArm(source: Object3D, handName: string, fist: Vector3, back: Vector3): Group | null {
  const arm = source.clone(true) as Group;
  const hand = arm.getObjectByName(handName);
  if (!hand) return null;
  arm.position.set(0, 0, 0); arm.rotation.set(0, 0, 0); arm.scale.setScalar(FP_ARM_SCALE);
  const toHand = hand.position.clone();
  // The fist is the bottom of the arm mesh: centred about one fist-width above the hand locator.
  const fistLocal = toHand.clone().add(toHand.clone().normalize().multiplyScalar(-.1));
  arm.quaternion.setFromUnitVectors(toHand.clone().negate().normalize(), back.clone().normalize());
  arm.position.copy(fist).sub(fistLocal.multiplyScalar(FP_ARM_SCALE).applyQuaternion(arm.quaternion));
  arm.traverse((o) => { if (o instanceof Mesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
  return arm;
}

/** Handguns sit a little further from the eye. */
const ITEM_PISTOLS = new Set(['gl18', 'deagle', 'revolver']);

function ease(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

export interface OpticLens {
  /** The mesh the scope image is drawn on: the optic's `lens` group, or a generated disc. */
  mesh: Mesh;
  /** Lens radius in the first-person model's units. */
  radius: number;
}

/** Apparent half-size of a magnified optic's lens when aimed (≈ 48° across: the eyepiece close to the eye). */
const LENS_HALF_ANGLE = 24 * Math.PI / 180;

/**
 * The optic's lens in a dressed first-person model. Optics drawn in the Gun Studio carry clear
 * blocks in a group named `lens` (merged into the mesh `lens_mesh`). For magnified optics those
 * blocks only mark where the picture goes: the picture is drawn on a flat window cut to the
 * hollow of the eyepiece (see `eyepieceWindow`). Older optics have none: an invisible octagonal
 * disc is placed on the sight line at the eye point instead, sized to the optic's width.
 */
function opticLens(model: Group, visual: WeaponVisual, opticId: string, magnified: boolean): OpticLens | null {
  const optic = model.getObjectByName(`attachment-${opticId}`);
  if (!optic) return null;
  model.updateMatrixWorld(true);
  const toModel = new Matrix4().copy(model.matrixWorld).invert();
  const inModel = (mesh: Mesh) => {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    return mesh.geometry.boundingBox!.clone().applyMatrix4(new Matrix4().multiplyMatrices(toModel, mesh.matrixWorld));
  };
  const authored = optic.getObjectByName('lens_mesh');
  if (authored instanceof Mesh) {
    // Red dots / holos: their `lens` is the window's frame, so the dot is drawn on the opening inside it.
    const glass = visual.sight ? eyepieceWindow(model, optic, authored, visual.sight, !magnified) : null;
    if (glass) return glass;
    const size = inModel(authored).getSize(new Vector3()).toArray().sort((a, b) => a - b);
    // A lens is a thin disc (or two discs along the tube): its diameter is the middle extent.
    return { mesh: authored, radius: size[1]! / 2 };
  }
  if (!visual.sight) return null;
  const box = new Box3();
  optic.traverse((o) => { if (o instanceof Mesh) box.union(inModel(o)); });
  const rear = visual.sight.rear, front = visual.sight.front;
  const along = front.clone().sub(rear).normalize();
  const extent = box.getSize(new Vector3());
  // Width across the sight line (the model's lateral axis is the one least aligned with it).
  const lateral = Math.abs(along.z) < .5 ? extent.z : extent.x;
  const radius = Math.max(.004, lateral * .38);
  const disc = new Mesh(new CircleGeometry(radius, 8), new MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: DoubleSide }));
  disc.name = 'lens_mesh';
  disc.position.copy(rear);
  disc.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), along);
  disc.visible = false;
  disc.frustumCulled = false;
  model.add(disc);
  return { mesh: disc, radius };
}

/**
 * The window a magnified picture is drawn on: the inside outline of the eyepiece (an octagon for
 * the Gun Studio tubes), found by casting rays outward from the marker's centre across the tube,
 * flat on the eye side of the rear (ocular) marker. Null when the marker is not inside a tube.
 */
function eyepieceWindow(model: Group, optic: Object3D, marker: Mesh, sight: { rear: Vector3; front: Vector3 }, framed = false): OpticLens | null {
  const along = sight.front.clone().sub(sight.rear).normalize();
  const toModel = new Matrix4().copy(model.matrixWorld).invert();
  const markerToModel = new Matrix4().multiplyMatrices(toModel, marker.matrixWorld);
  const position = marker.geometry.getAttribute('position');
  if (!position) return null;
  // The marker's blocks nearest the eye (the ocular, when the objective is marked too).
  const points: Vector3[] = [];
  for (let i = 0; i < position.count; i++) points.push(new Vector3().fromBufferAttribute(position, i).applyMatrix4(markerToModel));
  const depth = points.map((p) => p.dot(along));
  const near = Math.min(...depth), far = Math.max(...depth);
  const extent = new Box3();
  let back = Infinity, front = -Infinity;
  points.forEach((p, i) => {
    if (depth[i]! > near + Math.max(.004, (far - near) * .3)) return;
    extent.expandByPoint(p); back = Math.min(back, depth[i]!); front = Math.max(front, depth[i]!);
  });
  if (extent.isEmpty()) return null;
  const centre = extent.getCenter(new Vector3()).addScaledVector(along, (back + front) / 2 - extent.getCenter(new Vector3()).dot(along));
  const reach = extent.getSize(new Vector3()).length();
  // Two axes across the sight line.
  const u = new Vector3(0, 1, 0).cross(along);
  if (u.lengthSq() < 1e-6) u.set(1, 0, 0).cross(along);
  u.normalize();
  const v = along.clone().cross(u).normalize();

  const walls: Mesh[] = [];
  optic.traverse((o) => { if (o instanceof Mesh && (framed || (o !== marker && o.name !== 'lens_mesh'))) walls.push(o); });
  const ray = new Raycaster();
  const toWorld = model.matrixWorld, scale = new Vector3().setFromMatrixScale(toWorld).x;
  const STEPS = 32;
  // One ring of rays across the sight line at a depth along it (null if any ray escapes).
  const slice = (from: Vector3, depth: number, targets: Object3D[] = walls): number[] | null => {
    const origin = from.clone().addScaledVector(along, depth - from.dot(along)).applyMatrix4(toWorld);
    const out: number[] = [];
    for (let k = 0; k < STEPS; k++) {
      const a = (k / STEPS) * Math.PI * 2;
      ray.set(origin, u.clone().multiplyScalar(Math.cos(a)).addScaledVector(v, Math.sin(a)).transformDirection(toWorld));
      ray.far = reach * scale;
      const hit = ray.intersectObjects(targets, false)[0];
      if (!hit) return null;
      out.push(hit.distance / scale);
    }
    return out;
  };
  // From the marker forward until the tube closes round the sight line (the marker may sit just
  // behind the eyepiece's rim); the narrowest of the rim's first slices is the opening.
  const cast = (from: Vector3): number[] | null => {
    const step = Math.max(front - back, reach * .02) / 2;
    for (let d = back + step / 2; d < back + reach * 4; d += step) {
      const ring = slice(from, d);
      if (!ring) continue;
      for (const e of [d + step, d + 2 * step]) slice(from, e)?.forEach((r, i) => { ring[i] = Math.min(ring[i]!, r); });
      return ring;
    }
    return null;
  };
  const outline = (from: Vector3, d: number[]) => d.map((r, k) => {
    const a = (k / STEPS) * Math.PI * 2;
    return from.clone().addScaledVector(u, Math.cos(a) * r).addScaledVector(v, Math.sin(a) * r);
  });
  let hits = cast(centre), from = centre;
  if (hits) {
    // Re-centre on the hollow (the marker may sit a little off the tube's axis): opposite rays
    // come out even once the centre is on the axis.
    for (let pass = 0; pass < 3; pass++) {
      const shift = new Vector3();
      for (let k = 0; k < STEPS / 2; k++) {
        const a = (k / STEPS) * Math.PI * 2, d = (hits[k]! - hits[k + STEPS / 2]!) / STEPS;
        shift.addScaledVector(u, Math.cos(a) * d).addScaledVector(v, Math.sin(a) * d);
      }
      const middle = from.clone().add(shift), again = cast(middle);
      if (!again) break;
      hits = again; from = middle;
    }
  } else {
    // A solid tube (no hollow to follow): the regular octagon the marker's square and 45° square
    // share. Its corners are where the marker's outline comes nearest the centre.
    const probe = new Mesh(marker.geometry, new MeshBasicMaterial({ side: DoubleSide }));
    probe.matrixWorld.copy(marker.matrixWorld);
    const star = slice(centre, (back + front) / 2, [probe]);
    probe.material.dispose();
    if (!star) return null;
    const corner = star.indexOf(Math.min(...star)), apothem = star[corner]! * Math.cos(Math.PI / 8);
    const flat = (corner / STEPS) * Math.PI * 2 + Math.PI / 8;
    hits = star.map((_, k) => {
      const off = ((((k / STEPS) * Math.PI * 2 - flat) % (Math.PI / 4)) + Math.PI / 4) % (Math.PI / 4);
      return apothem / Math.cos(Math.min(off, Math.PI / 4 - off));
    });
  }
  // Flat on the eye side of the ocular marker.
  from.addScaledVector(along, back - from.dot(along) - .0005);
  const rim = outline(from, hits);
  // A fan facing the eye; `rim` runs 0 at the centre to 1 on the outline (the lens' edge shading).
  const vertices: number[] = [], edge: number[] = [];
  for (let k = 0; k < STEPS; k++) {
    const a = rim[k]!, b = rim[(k + 1) % STEPS]!;
    vertices.push(from.x, from.y, from.z, b.x, b.y, b.z, a.x, a.y, a.z);
    edge.push(0, 1, 1);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('rim', new Float32BufferAttribute(edge, 1));
  const glass = new Mesh(geometry, new MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: DoubleSide }));
  glass.name = 'lens_window';
  glass.visible = false;
  glass.frustumCulled = false;
  // Drawn after the optic's clear glass (sorting goes by the mesh origin, which is the model's).
  glass.renderOrder = 10;
  model.add(glass);
  // Radius that fits inside the outline (the octagon's flats), so the whole window is in view.
  return { mesh: glass, radius: Math.min(...hits) };
}
