import { Group, Matrix4, Mesh, Quaternion, Vector3, type Camera } from 'three';
import type { WeaponLibrary } from './weapons';
import { RecoilSpring } from '../first-person-recoil';
import { MeleeEdge, type StrikeAxes } from './melee-edge';
import { aimOffhandLight, offhandLightPose } from './offhand-light';

/**
 * First-person weapon held in front of the camera. Uses the weapon's display model (muzzle +X,
 * top +Y, centred on the grip) parented to the camera, with procedural sway, walk bob, recoil
 * and a reload dip so the view feels weighty without the third-person rig.
 */
export class ViewModel {
  private readonly root = new Group();
  private readonly pivot = new Group();
  private readonly models = new Map<string, Group>();
  private current: string | null = null;
  private offhandId: string | null = null;
  private offhandModel: Group | null = null;
  private readonly offhandBase = new Matrix4();
  private readonly recoil = new RecoilSpring(22, .14);
  private bobPhase = 0;
  private bobAmount = 0;
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
  private readonly meleeEdge = new MeleeEdge();
  private strikeAxes: StrikeAxes | null = null;
  private readonly supportArms = new Map<string, Group>();

  constructor(camera: Camera) {
    this.root.add(this.pivot);
    this.root.visible = false;
    camera.add(this.root);
  }

  set(itemId: string | null, weapons: WeaponLibrary | null): void {
    if (itemId === 'c4') itemId = 'c4_detonator';
    if (itemId === this.current) return;
    if (this.current) this.models.get(this.current)!.visible = false;
    this.current = null;
    this.strikeAxes = null;
    this.meleeEdge.reset();
    this.aimBlend = 0;
    this.recoil.reset();
    const display = itemId ? weapons?.get(itemId)?.display : undefined;
    if (!itemId || !display) return;
    let model = this.models.get(itemId);
    if (!model) {
      model = display.clone(true);
      // Muzzle (+X) → camera forward (−Z).
      model.rotation.y = Math.PI / 2;
      model.traverse((o) => {
        if (o instanceof Mesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; }
      });
      this.pivot.add(model);
      this.models.set(itemId, model);
      const support = weapons?.get(itemId)?.firstPersonSupport;
      if (support) {
        const arm = support.arm.clone(true);
        arm.name = 'first-person-arm-left';
        arm.position.set(0, 0, 0); arm.rotation.set(0, 0, 0); arm.scale.setScalar(1);
        const hand = arm.getObjectByName('hand_left');
        if (hand) {
          const handLocal = hand.position.clone();
          // Display-model -Z points left once the weapon faces camera-forward.
          const shoulder = new Vector3(-.13, -.18, -.4);
          const direction = shoulder.sub(support.contact);
          arm.quaternion.setFromUnitVectors(handLocal.clone().negate().normalize(), direction.clone().normalize());
          arm.scale.setScalar(direction.length() / handLocal.length());
          arm.position.copy(support.contact).sub(handLocal.multiplyScalar(arm.scale.x).applyQuaternion(arm.quaternion));
          const holder = new Group();
          holder.name = 'first-person-support'; holder.add(arm); model.add(holder);
          holder.traverse(o => { if (o instanceof Mesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
          this.supportArms.set(itemId, holder);
        }
      }
    }
    model.visible = true;
    this.current = itemId;
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

  /** A shot: kicks the gun back and up. */
  kick(strength = 1): void {
    this.recoil.kick(strength * .065);
  }

  weaponPoint(point: 'muzzle' | 'eject', out: Vector3): boolean {
    const marker = this.current ? this.models.get(this.current)?.getObjectByName(`weapon-${point}`) : null;
    if (!marker || !this.root.visible) return false;
    marker.getWorldPosition(out);
    return true;
  }

  /** Converge the actual barrel on the crosshair, including camera rotation and tumble. */
  aimAt(worldTarget: Vector3): void {
    if (!this.current || this.aimBlend < 0.001) return;
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

  update(dt: number, s: { visible: boolean; moving: boolean; sprint: boolean; reloading: boolean; yaw: number; pitch: number; firing?: boolean; aiming?: boolean }): void {
    this.root.visible = s.visible && (this.current !== null || this.offhandId !== null);
    const aiming = !s.reloading && !s.sprint && s.aiming ? 1 : 0;
    this.aimBlend += (aiming - this.aimBlend) * (1 - Math.exp(-dt * (aiming ? 18 : 12)));
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
    const targetBob = s.moving ? (s.sprint ? 1.6 : 1) : 0;
    this.bobAmount += (targetBob - this.bobAmount) * (1 - Math.exp(-dt * 8));
    this.bobPhase += dt * (s.sprint ? 13 : 9) * (s.moving ? 1 : 0.3);
    const bx = Math.sin(this.bobPhase) * 0.012 * this.bobAmount;
    const by = -Math.abs(Math.cos(this.bobPhase)) * 0.012 * this.bobAmount;
    // Recoil springs back; reload lowers the gun.
    this.recoil.update(dt);
    this.dip += ((s.reloading ? 1 : 0) - this.dip) * (1 - Math.exp(-dt * 9));
    const sprintTilt = s.sprint && s.moving ? 1 : 0;

    // Action offsets: position (x, y, z) and rotation (pitch, yaw, roll).
    let ax = 0, ay = 0, az = 0, rx = 0, ry = 0, rz = 0;
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

    const relaxed = 1 - this.aimBlend;
    this.root.position.set((0.2 + this.swayX + bx) * relaxed + ax, -0.27 + this.aimBlend * 0.02 + (this.swayY + by) * relaxed - this.dip * 0.12 + ay, -0.25 - this.aimBlend * .18 + this.recoil.offset * .6 + az);
    const supportArm = this.current ? this.supportArms.get(this.current) : null;
    if (supportArm) supportArm.visible = !s.reloading && !this.offhandId;
    this.pivot.rotation.set(this.recoil.offset - this.dip * 0.5 - sprintTilt * 0.25 + rx, this.swayX * 1.5 + sprintTilt * 0.5 + ry, -this.swayX * 0.8 + this.dip * 0.3 + rz);
    const model = this.current ? this.models.get(this.current) : null;
    if (model && this.strikeAxes) {
      model.rotation.set(0, Math.PI / 2, 0);
      if (this.swingT >= 0) this.meleeEdge.pose(model, this.strikeAxes, this.root.parent!);
      else this.meleeEdge.rest(model, this.strikeAxes);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}

function ease(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}
